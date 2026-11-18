/**
 * Claude Code adapter (verified against Claude Code 2.1.308–2.1.327).
 *
 * Storage: JSONL transcripts under ~/.claude/projects/<project-slug>/<sessionId>.jsonl.
 * Core record types: user, assistant, system (subtypes incl. compact_boundary,
 * api_error), cost-state, ai-title. Extended builds add further record types
 * (attachment, api-request*, queue-operation, ...); only structural metadata
 * is ever taken from them, and most are ignored entirely.
 *
 * CRITICAL token-accounting fact (verified on 5,434 multi-record message
 * groups): one API response is split into multiple assistant records (one per
 * content block, `apiBlockIndex`), and EVERY split record repeats the full
 * `message.usage`. Records are therefore merged by `message.id` and usage is
 * counted exactly once per API message.
 *
 * Tool failures are agent-reported: user records carry tool_result blocks
 * with `is_error`, plus `toolUseResult` metadata (e.g. `interrupted`).
 * Interrupted calls are user actions, not tool failures → status 'unknown'.
 *
 * PRIVACY: user/assistant text, tool inputs/outputs, toolUseResult content
 * fields (stdout/stderr/file/structuredPatch/...), api-request-blob messages,
 * attachments, and last-prompt text are NEVER retained. ~/.claude.json and
 * .credentials.json are never opened (they hold account/auth data).
 */
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import type {
  AgentInstallation,
  ModelRef,
  SessionEvent,
  SessionRecord,
  ToolCall,
  TokenUsage,
} from '../core/types.ts';
import type { AgentAdapter, SessionMeta } from './adapter.ts';
import { HavrinError, errorMessage } from '../core/errors.ts';
import { fingerprint, sanitizeErrorMessage, sanitizeFreeText, sanitizeControlChars } from '../core/util.ts';
import { classifyCommand } from '../core/classify.ts';
import { homeDir, isDirectory, isReadableFile, whichSync } from '../core/fs.ts';

const MAX_TRANSCRIPT_BYTES = 128 * 1024 * 1024;
const MAX_PARSE_WARNINGS = 20;
const HEAD_BYTES = 64 * 1024;

export function claudeHome(): string {
  const override = process.env['HAVRIN_CLAUDE_HOME'];
  if (override && path.isAbsolute(override)) return override;
  const env = process.env['CLAUDE_CONFIG_DIR'];
  if (env && path.isAbsolute(env)) return env;
  return path.join(homeDir(), '.claude');
}

export function claudeProjectsDir(): string {
  return path.join(claudeHome(), 'projects');
}

function probeVersion(binary: string): string | undefined {
  try {
    const out = execFileSync(binary, ['--version'], {
      timeout: 8000,
      maxBuffer: 64 * 1024,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = /(\d+\.\d+\.\d+)/.exec(out);
    return m?.[1];
  } catch {
    return undefined;
  }
}

function walkTranscripts(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTranscripts(full, out);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isoToMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function parseUsage(value: unknown): TokenUsage | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const details = asRecord(rec['output_tokens_details']);
  return {
    input: asNumber(rec['input_tokens']) ?? 0,
    output: asNumber(rec['output_tokens']) ?? 0,
    reasoning: asNumber(details?.['thinking_tokens']) ?? 0,
    cacheRead: asNumber(rec['cache_read_input_tokens']) ?? 0,
    cacheWrite: asNumber(rec['cache_creation_input_tokens']) ?? 0,
  };
}

function modelRef(model: string): ModelRef {
  return { provider: model.startsWith('claude') ? 'anthropic' : 'other', model };
}

/** Merged assistant records for one API message (usage counted once). */
interface AssistantGroup {
  at: number;
  order: number;
  model?: string;
  tokens?: TokenUsage;
  tools: PendingTool[];
  textChars: number;
  reasoningChars: number;
  sidechain: boolean;
  synthetic: boolean;
}

interface PendingTool {
  id?: string;
  name: string;
  input: unknown;
  targetPath?: string;
  commandCategory?: ToolCall['commandCategory'];
}

interface ToolResultInfo {
  isError: boolean;
  interrupted: boolean;
}

/** Read the head of a transcript to find first timestamp/cwd without full parse. */
function readHead(file: string): { at?: number; cwd?: string; version?: string } {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.subarray(0, bytes).toString('utf8');
    const lines = text.split('\n').slice(0, 25);
    const out: { at?: number; cwd?: string; version?: string } = {};
    for (const line of lines) {
      if (!line.trim()) continue;
      let rec: Record<string, unknown> | undefined;
      try {
        rec = asRecord(JSON.parse(line));
      } catch {
        continue; // partial last line of the head window is expected
      }
      if (!rec) continue;
      if (out.at === undefined) {
        const at = isoToMs(rec['timestamp']);
        if (at !== undefined) out.at = at;
      }
      if (out.cwd === undefined) {
        const cwd = asString(rec['cwd']);
        if (cwd !== undefined) out.cwd = cwd;
      }
      if (out.version === undefined) {
        const version = asString(rec['version']);
        if (version !== undefined) out.version = version;
      }
      if (out.at !== undefined && out.cwd !== undefined && out.version !== undefined) break;
    }
    return out;
  } catch {
    return {};
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

const transcriptPathById = new Map<string, string>();

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude' as const;

  detect(): AgentInstallation {
    const issues: string[] = [];
    const binaryPath = whichSync('claude');
    const version = binaryPath ? probeVersion(binaryPath) : undefined;
    if (binaryPath && !version) issues.push('claude binary found but --version failed');

    const home = claudeHome();
    const projectsDir = claudeProjectsDir();
    const configPath = path.join(home, 'settings.json');
    const installation: AgentInstallation = { agent: 'claude', issues };
    if (binaryPath) installation.binaryPath = binaryPath;
    if (version) installation.version = version;
    if (isDirectory(home)) installation.dataDir = home;
    if (isReadableFile(configPath)) installation.configPath = configPath;

    if (!isDirectory(projectsDir)) {
      if (isDirectory(home)) {
        installation.layout = 'no-sessions';
        issues.push('Claude home exists but no projects directory was found.');
      }
      return installation;
    }
    installation.layout = 'jsonl-projects';
    const files: string[] = [];
    walkTranscripts(projectsDir, files);
    installation.sessionCount = files.length;
    return installation;
  }

  listSessions(installation: AgentInstallation): SessionMeta[] {
    if (installation.layout !== 'jsonl-projects') return [];
    transcriptPathById.clear();
    const files: string[] = [];
    walkTranscripts(claudeProjectsDir(), files);
    const metas: SessionMeta[] = [];
    const seen = new Map<string, number>(); // id → index in metas (dedupe)
    for (const file of files) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      const id = path.basename(file, '.jsonl');
      const head = readHead(file);
      const birthtime = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;
      const createdAt = Math.floor(head.at ?? birthtime);
      const meta: SessionMeta = {
        id,
        createdAt,
        // Floor to integer ms: Date.now() truncates, and a raw fractional
        // mtime can exceed the audit's `until` for just-written files.
        updatedAt: Math.floor(stat.mtimeMs),
        signature: `${stat.mtimeMs}:${stat.size}`,
      };
      if (head.cwd) meta.directory = head.cwd;
      const existing = seen.get(id);
      if (existing !== undefined) {
        // Duplicate session id across files: keep the most recently updated.
        const prev = metas[existing];
        if (prev && prev.updatedAt >= meta.updatedAt) continue;
        metas[existing] = meta;
        transcriptPathById.set(id, file);
        continue;
      }
      seen.set(id, metas.length);
      transcriptPathById.set(id, file);
      metas.push(meta);
    }
    metas.sort((a, b) => b.updatedAt - a.updatedAt);
    return metas;
  }

  readSession(installation: AgentInstallation, meta: SessionMeta): SessionRecord {
    if (installation.layout !== 'jsonl-projects') {
      throw new HavrinError('UNSUPPORTED', `Claude layout ${installation.layout ?? 'unknown'} is not supported`);
    }
    const file = transcriptPathById.get(meta.id) ?? this.findTranscript(meta.id);
    if (!file) throw new HavrinError('NO_DATA', `Transcript for session ${meta.id} not found`);

    const warnings: string[] = [];
    let partial = false;
    const warn = (msg: string) => {
      partial = true;
      if (warnings.length < MAX_PARSE_WARNINGS) warnings.push(msg);
    };

    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch (err) {
      throw new HavrinError('IO', `Cannot stat ${file}: ${errorMessage(err)}`);
    }
    if (stat.size > MAX_TRANSCRIPT_BYTES) {
      warn(`transcript exceeds ${MAX_TRANSCRIPT_BYTES} bytes; skipped for safety`);
      return this.emptyRecord(meta, file, partial, warnings);
    }
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      throw new HavrinError('IO', `Cannot read ${file}: ${errorMessage(err)}`);
    }

    const groups = new Map<string, AssistantGroup>();
    const results = new Map<string, ToolResultInfo>();
    const events: SessionEvent[] = [];
    let order = 0;
    let lastCostState: Record<string, unknown> | undefined;
    let lastTitle: string | undefined;
    let cwd: string | undefined;
    let version: string | undefined;
    let lastModel: string | undefined;
    let prevModel: string | undefined;

    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      let rec: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(line);
        const r = asRecord(parsed);
        if (!r) {
          warn(`line ${i + 1}: not an object`);
          continue;
        }
        rec = r;
      } catch {
        warn(`line ${i + 1}: invalid JSON`);
        continue;
      }
      const type = asString(rec['type']);
      if (!type) {
        warn(`line ${i + 1}: missing type`);
        continue;
      }
      const at = isoToMs(rec['timestamp']) ?? meta.createdAt;
      cwd = asString(rec['cwd']) ?? cwd;
      version = asString(rec['version']) ?? version;
      try {
        if (type === 'assistant') {
          const message = asRecord(rec['message']);
          if (!message) {
            warn(`line ${i + 1}: assistant record without message`);
            continue;
          }
          const model = asString(message['model']);
          const synthetic = model === '<synthetic>';
          // Merge split records of one API message; usage counted once.
          const messageId = asString(message['id']);
          if (!messageId) {
            warn(`line ${i + 1}: assistant record without message.id; cannot dedup usage safely`);
          }
          const key = messageId ?? asString(rec['uuid']) ?? `line-${i}`;
          let group = groups.get(key);
          if (!group) {
            group = {
              at,
              order: order++,
              tools: [],
              textChars: 0,
              reasoningChars: 0,
              sidechain: rec['isSidechain'] === true,
              synthetic,
            };
            if (model && !synthetic) group.model = model;
            groups.set(key, group);
          }
          const usage = parseUsage(message['usage']);
          if (usage) {
            if (!group.tokens) {
              group.tokens = usage;
            } else if (
              group.tokens.input !== usage.input ||
              group.tokens.output !== usage.output ||
              group.tokens.cacheRead !== usage.cacheRead ||
              group.tokens.cacheWrite !== usage.cacheWrite
            ) {
              warn(`line ${i + 1}: usage disagrees within message ${key}; keeping first reported usage`);
            }
          }
          const content = Array.isArray(message['content']) ? message['content'] : [];
          for (const rawBlock of content) {
            const block = asRecord(rawBlock);
            if (!block) continue;
            const btype = asString(block['type']);
            if (btype === 'tool_use') {
              const name = asString(block['name']);
              if (!name) continue;
              const input = block['input'];
              const pending: PendingTool = { name, input };
              const tid = asString(block['id']);
              if (tid) pending.id = tid;
              const inputRec = asRecord(input);
              const filePath =
                asString(inputRec?.['file_path']) ?? asString(inputRec?.['notebook_path']);
              if (filePath && /^(Read|Edit|Write|MultiEdit|NotebookEdit)$/i.test(name)) {
                pending.targetPath = sanitizeControlChars(filePath);
              }
              if (name === 'Bash') {
                const command = asString(inputRec?.['command']);
                if (command !== undefined) pending.commandCategory = classifyCommand(command);
              }
              group.tools.push(pending);
            } else if (btype === 'text' && !synthetic) {
              group.textChars += (asString(block['text']) ?? '').length;
            } else if (btype === 'thinking') {
              group.reasoningChars += (asString(block['thinking']) ?? '').length;
            }
          }
          continue;
        }
        if (type === 'user') {
          const message = asRecord(rec['message']);
          const content = message?.['content'];
          const toolUseResult = asRecord(rec['toolUseResult']);
          if (Array.isArray(content)) {
            let sawToolResult = false;
            for (const rawBlock of content) {
              const block = asRecord(rawBlock);
              if (block?.['type'] !== 'tool_result') continue;
              sawToolResult = true;
              const tid = asString(block['tool_use_id']);
              if (!tid) continue;
              results.set(tid, {
                isError: block['is_error'] === true,
                interrupted: toolUseResult?.['interrupted'] === true,
              });
            }
            if (sawToolResult) continue; // tool results are not user turns
          }
          if (rec['isMeta'] === true || toolUseResult !== undefined) continue;
          if (rec['isSidechain'] === true) continue; // subagent prompts, not user turns
          // Genuine user prompt: count chars only, never retain text.
          let chars = 0;
          if (typeof content === 'string') chars = content.length;
          else if (Array.isArray(content)) {
            for (const rawBlock of content) {
              const block = asRecord(rawBlock);
              if (block?.['type'] === 'text') chars += (asString(block['text']) ?? '').length;
            }
          }
          if (chars === 0 && !Array.isArray(content)) continue;
          events.push({
            kind: 'user',
            at,
            id: asString(rec['uuid']) ?? `line-${i}`,
            textChars: chars,
            fileCount: 0,
          });
          continue;
        }
        if (type === 'system') {
          const subtype = asString(rec['subtype']);
          if (subtype === 'compact_boundary') {
            const cm = asRecord(rec['compactMetadata']);
            const ev: Extract<SessionEvent, { kind: 'compaction' }> = { kind: 'compaction', at };
            const trigger = asString(cm?.['trigger']);
            if (trigger) ev.reason = trigger;
            events.push(ev);
          } else if (subtype === 'api_error') {
            events.push({ kind: 'idle', at, error: { type: 'api_error' } });
          }
          // Other subtypes (turn_duration, stop_hook_summary, local_command,
          // informational, ...): no v0.2 diagnostic signal; content never read.
          continue;
        }
        if (type === 'summary') {
          // Older Claude Code compaction marker; text is never retained.
          events.push({ kind: 'compaction', at, reason: 'summary' });
          continue;
        }
        if (type === 'cost-state') {
          lastCostState = rec;
          continue;
        }
        if (type === 'ai-title') {
          lastTitle = asString(rec['aiTitle']) ?? lastTitle;
          continue;
        }
        // Everything else (attachment, api-request*, queue-operation,
        // file-history-*, session-owner, bridge-session, last-prompt, mode,
        // permission-mode, pr-link, tools-used, agent-name, continued-in,
        // atis-latch, ...): ignored. Several carry raw content or identity
        // data; none are needed for v0.2 diagnostics.
      } catch (err) {
        // Defense in depth: exception text is structural in practice, but
        // sanitize anyway so no unexpected error can carry content into
        // warnings → reports → persisted state.
        warn(`line ${i + 1}: ${sanitizeErrorMessage(errorMessage(err)) ?? 'record processing error'}`);
      }
    }

    // Emit merged assistant groups with resolved tool statuses.
    let sidechainTurns = 0;
    let sidechainTools = 0;
    let sidechainErrors = 0;
    let sawSidechain = false;
    const sortedGroups = [...groups.values()].sort((a, b) => a.order - b.order);
    for (const group of sortedGroups) {
      const tools: ToolCall[] = [];
      for (const pending of group.tools) {
        const result = pending.id ? results.get(pending.id) : undefined;
        const tool: ToolCall = {
          name: pending.name,
          status: 'unknown',
          statusSource: 'reported',
          inputFingerprint: fingerprint(pending.input ?? null),
        };
        if (pending.id) tool.id = pending.id;
        if (pending.targetPath) tool.targetPath = pending.targetPath;
        if (pending.commandCategory) tool.commandCategory = pending.commandCategory;
        if (result) {
          if (result.interrupted) {
            tool.status = 'unknown';
            tool.errorType = 'interrupted';
          } else if (result.isError) {
            tool.status = 'error';
            tool.errorType = 'tool_result.is_error';
          } else {
            tool.status = 'completed';
          }
        }
        tools.push(tool);
      }
      const ev: Extract<SessionEvent, { kind: 'assistant' }> = {
        kind: 'assistant',
        at: group.at,
        id: `group-${group.order}`,
        tools,
        textChars: group.textChars,
        reasoningChars: group.reasoningChars,
      };
      if (group.model) {
        ev.model = modelRef(group.model);
        lastModel = group.model;
        if (prevModel && prevModel !== group.model) {
          events.push({ kind: 'model-switch', at: group.at, from: modelRef(prevModel), to: modelRef(group.model) });
        }
        prevModel = group.model;
      }
      if (group.tokens) ev.tokens = group.tokens;
      if (group.synthetic) ev.error = { type: 'synthetic' };
      events.push(ev);
      if (group.sidechain) {
        sawSidechain = true;
        sidechainTurns++;
        sidechainTools += tools.length;
        sidechainErrors += tools.filter((t) => t.status === 'error').length;
      }
    }
    events.sort((a, b) => a.at - b.at);

    const record: SessionRecord = {
      agent: 'claude',
      id: meta.id,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      events,
      partial,
      parseWarnings: warnings,
      source: { kind: 'jsonl', location: file, signature: meta.signature },
    };
    if (lastTitle) record.title = sanitizeFreeText(lastTitle, 120);
    const dir = cwd ?? meta.directory;
    if (dir) record.directory = dir;
    if (lastModel) record.model = modelRef(lastModel);
    if (version) record.source.version = version;
    if (sawSidechain) {
      record.subagentStats = { turns: sidechainTurns, toolCalls: sidechainTools, toolErrors: sidechainErrors };
    }

    // Agent-reported aggregates from the final cost-state record.
    if (lastCostState) {
      const modelUsage = asRecord(lastCostState['modelUsage']);
      if (modelUsage) {
        const totals = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
        let any = false;
        for (const [modelName, entry] of Object.entries(modelUsage)) {
          const u = asRecord(entry);
          if (!u) {
            warn(`cost-state: malformed modelUsage entry for ${modelName}; totals may be incomplete`);
            continue;
          }
          any = true;
          totals.input += asNumber(u['inputTokens']) ?? 0;
          totals.output += asNumber(u['outputTokens']) ?? 0;
          totals.reasoning += asNumber(u['thinkingTokens']) ?? 0;
          totals.cacheRead += asNumber(u['cacheReadInputTokens']) ?? 0;
          totals.cacheWrite += asNumber(u['cacheCreationInputTokens']) ?? 0;
        }
        if (any) record.reportedTotals = totals;
      }
      // hasUnknownModelCost means the dollar figure is incomplete — do not
      // present it as a reliable total. Any truthy value suppresses.
      const cost = asNumber(lastCostState['totalCostUSD']);
      if (cost !== undefined && !lastCostState['hasUnknownModelCost']) {
        record.reportedCost = cost;
      }
    }
    // late warnings (e.g. cost-state) must be reflected in the record
    record.partial = partial;
    return record;
  }

  private emptyRecord(meta: SessionMeta, file: string, partial: boolean, warnings: string[]): SessionRecord {
    const record: SessionRecord = {
      agent: 'claude',
      id: meta.id,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      events: [],
      partial,
      parseWarnings: warnings,
      source: { kind: 'jsonl', location: file, signature: meta.signature },
    };
    if (meta.directory) record.directory = meta.directory;
    return record;
  }

  private findTranscript(id: string): string | undefined {
    const files: string[] = [];
    walkTranscripts(claudeProjectsDir(), files);
    let best: { file: string; mtime: number } | undefined;
    for (const file of files) {
      if (path.basename(file, '.jsonl') !== id) continue;
      try {
        const mtime = fs.statSync(file).mtimeMs;
        if (!best || mtime > best.mtime) best = { file, mtime };
      } catch {
        /* skip unreadable */
      }
    }
    return best?.file;
  }
}
