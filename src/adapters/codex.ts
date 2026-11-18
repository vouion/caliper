/**
 * Codex CLI adapter (verified against codex-cli 0.169.x).
 *
 * Storage: JSONL "rollout" files under ~/.codex/sessions/YYYY/MM/DD/.
 * Each line: {timestamp, ordinal, type, payload}. Relevant record types:
 *   session_meta, turn_context, response_item (message / custom_tool_call /
 *   function_call / *_output / reasoning), event_msg (task_started,
 *   task_complete, token_count, turn_aborted, ...), token_usage_record.
 *
 * Tool call status is not reliably reported by Codex; failures are inferred
 * from output text (nonzero exit codes, explicit error markers). Such
 * inferences are tagged statusSource: "heuristic" and treated with lower
 * confidence by diagnostics.
 *
 * SAFETY: files are only read. No user text or tool output content is
 * retained beyond coarse metrics; see core/types.ts.
 */
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { AgentInstallation, ModelRef, SessionEvent, SessionRecord, ToolCall, TokenUsage } from '../core/types.ts';
import type { AgentAdapter, SessionMeta } from './adapter.ts';
import { HavrinError, errorMessage } from '../core/errors.ts';
import { fingerprint } from '../core/util.ts';
import { classifyCommand } from '../core/classify.ts';
import { homeDir, isDirectory, isReadableFile, whichSync } from '../core/fs.ts';

const MAX_ROLLOUT_BYTES = 128 * 1024 * 1024;
const MAX_PARSE_WARNINGS = 20;
const ROLLOUT_RE = /^rollout-.*\.jsonl$/;

export function codexHome(): string {
  const override = process.env['HAVRIN_CODEX_HOME'];
  if (override && path.isAbsolute(override)) return override;
  const env = process.env['CODEX_HOME'];
  if (env && path.isAbsolute(env)) return env;
  return path.join(homeDir(), '.codex');
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

function walkRollouts(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkRollouts(full, out);
    else if (entry.isFile() && ROLLOUT_RE.test(entry.name)) out.push(full);
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
  return {
    input: asNumber(rec['input_tokens']) ?? 0,
    output: asNumber(rec['output_tokens']) ?? 0,
    reasoning: asNumber(rec['reasoning_output_tokens']) ?? 0,
    cacheRead: asNumber(rec['cached_input_tokens']) ?? 0,
    cacheWrite: asNumber(rec['cache_write_input_tokens']) ?? 0,
  };
}

/** Extract output text whether output is a string or an array of content items. */
function outputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const rec = asRecord(item);
        return asString(rec?.['text']) ?? '';
      })
      .join('\n');
  }
  return '';
}

const HEURISTIC_ERROR_RES: RegExp[] = [
  /"exit_code"\s*:\s*[1-9]\d*/,
  /\bexit code [1-9]\d*\b/i,
  /\bScript failed\b/i,
  /^error:/im,
  /\bapply_patch verification failed\b/i,
];

function inferToolError(text: string): boolean {
  // Bound the scan: failure markers appear early in exec wrappers.
  const sample = text.slice(0, 20_000);
  return HEURISTIC_ERROR_RES.some((re) => re.test(sample));
}

interface PendingCall {
  name: string;
  input: unknown;
  rawInput: string;
  at: number;
  reportedStatus?: string;
}

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex' as const;

  detect(): AgentInstallation {
    const issues: string[] = [];
    const binaryPath = whichSync('codex');
    const version = binaryPath ? probeVersion(binaryPath) : undefined;
    if (binaryPath && !version) issues.push('codex binary found but --version failed');

    const home = codexHome();
    const sessionsDir = path.join(home, 'sessions');
    const configPath = path.join(home, 'config.toml');
    const installation: AgentInstallation = { agent: 'codex', issues };
    if (binaryPath) installation.binaryPath = binaryPath;
    if (version) installation.version = version;
    if (isDirectory(home)) installation.dataDir = home;
    if (isReadableFile(configPath)) installation.configPath = configPath;

    if (!isDirectory(sessionsDir)) {
      if (isDirectory(home)) {
        installation.layout = 'no-sessions';
        issues.push('Codex home exists but no sessions directory was found.');
      }
      return installation;
    }
    installation.layout = 'jsonl-rollout';
    const files: string[] = [];
    walkRollouts(sessionsDir, files);
    installation.sessionCount = files.length;
    return installation;
  }

  listSessions(installation: AgentInstallation): SessionMeta[] {
    if (installation.layout !== 'jsonl-rollout') return [];
    const sessionsDir = path.join(codexHome(), 'sessions');
    const files: string[] = [];
    walkRollouts(sessionsDir, files);

    const titles = this.readSessionIndex();
    const metas: SessionMeta[] = [];
    for (const file of files) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      const first = readFirstLine(file);
      let id = path.basename(file, '.jsonl');
      let createdAt = stat.mtimeMs;
      let directory: string | undefined;
      const meta = first ? asRecord(asRecord(first)?.['payload']) : undefined;
      if (meta) {
        id = asString(meta['session_id']) ?? asString(meta['id']) ?? id;
        createdAt = isoToMs(meta['timestamp']) ?? createdAt;
        directory = asString(meta['cwd']);
      }
      const m: SessionMeta = {
        id,
        createdAt,
        updatedAt: stat.mtimeMs,
        signature: `${stat.mtimeMs}:${stat.size}`,
      };
      const title = titles.get(id);
      if (title) m.title = title;
      if (directory) m.directory = directory;
      // Keep the rollout path retrievable from the id without a second walk.
      rolloutPathById.set(id, file);
      metas.push(m);
    }
    metas.sort((a, b) => b.updatedAt - a.updatedAt);
    return metas;
  }

  private readSessionIndex(): Map<string, string> {
    const titles = new Map<string, string>();
    const indexFile = path.join(codexHome(), 'session_index.jsonl');
    if (!isReadableFile(indexFile)) return titles;
    let raw: string;
    try {
      raw = fs.readFileSync(indexFile, 'utf8');
    } catch {
      return titles;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = asRecord(JSON.parse(line));
        const id = asString(rec?.['id']);
        const name = asString(rec?.['thread_name']);
        if (id && name) titles.set(id, name);
      } catch {
        // Index is best-effort enrichment; ignore malformed lines.
      }
    }
    return titles;
  }

  readSession(installation: AgentInstallation, meta: SessionMeta): SessionRecord {
    if (installation.layout !== 'jsonl-rollout') {
      throw new HavrinError('UNSUPPORTED', `Codex layout ${installation.layout ?? 'unknown'} is not supported`);
    }
    const file = rolloutPathById.get(meta.id) ?? this.findRollout(meta.id);
    if (!file) throw new HavrinError('NO_DATA', `Rollout file for session ${meta.id} not found`);

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
    if (stat.size > MAX_ROLLOUT_BYTES) {
      warn(`rollout exceeds ${MAX_ROLLOUT_BYTES} bytes; skipped for safety`);
      return this.emptyRecord(meta, file, partial, warnings);
    }
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      throw new HavrinError('IO', `Cannot read ${file}: ${errorMessage(err)}`);
    }

    const events: SessionEvent[] = [];
    const pending = new Map<string, PendingCall>();
    let provider = 'openai';
    let currentModel: ModelRef | undefined;
    let cliVersion: string | undefined;
    let directory: string | undefined;
    let reportedTotals: TokenUsage | undefined;
    let lastAssistantIdx = -1;

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
      const at = isoToMs(rec['timestamp']) ?? meta.createdAt;
      const type = asString(rec['type']);
      const payload = asRecord(rec['payload']);
      if (!type || !payload) {
        warn(`line ${i + 1}: missing type/payload`);
        continue;
      }
      try {
        if (type === 'session_meta') {
          provider = asString(payload['model_provider']) ?? provider;
          cliVersion = asString(payload['cli_version']) ?? cliVersion;
          directory = asString(payload['cwd']) ?? directory;
          continue;
        }
        if (type === 'turn_context') {
          const model = asString(payload['model']);
          if (model) currentModel = { provider, model };
          directory = asString(payload['cwd']) ?? directory;
          continue;
        }
        if (type === 'token_usage_record') {
          const usage = parseUsage(payload['usage']);
          if (usage && lastAssistantIdx >= 0) {
            const target = events[lastAssistantIdx];
            if (target && target.kind === 'assistant' && !target.tokens) target.tokens = usage;
          }
          const cumulative = parseUsage(payload['thread_token_usage']);
          if (cumulative) reportedTotals = cumulative;
          continue;
        }
        if (type === 'event_msg') {
          const ptype = asString(payload['type']);
          if (ptype === 'turn_aborted') events.push({ kind: 'turn-aborted', at });
          else if (ptype === 'context_compacted') events.push({ kind: 'compaction', at });
          continue;
        }
        if (type !== 'response_item') continue;

        const ptype = asString(payload['type']);
        if (ptype === 'message') {
          const role = asString(payload['role']);
          const content = Array.isArray(payload['content']) ? payload['content'] : [];
          let chars = 0;
          for (const item of content) {
            chars += (asString(asRecord(item)?.['text']) ?? '').length;
          }
          if (role === 'user') {
            events.push({ kind: 'user', at, id: asString(payload['id']) ?? `line-${i}`, textChars: chars, fileCount: 0 });
          } else if (role === 'assistant') {
            const ev: Extract<SessionEvent, { kind: 'assistant' }> = {
              kind: 'assistant',
              at,
              id: asString(payload['id']) ?? `line-${i}`,
              tools: [],
              textChars: chars,
              reasoningChars: 0,
            };
            if (currentModel) ev.model = currentModel;
            events.push(ev);
            lastAssistantIdx = events.length - 1;
          }
          continue;
        }
        if (ptype === 'custom_tool_call' || ptype === 'function_call') {
          const callId = asString(payload['call_id']);
          const name = asString(payload['name']);
          if (!callId || !name) {
            warn(`line ${i + 1}: tool call missing call_id/name`);
            continue;
          }
          const rawInput = asString(payload['input']) ?? '';
          let input: unknown = rawInput;
          if (ptype === 'function_call') {
            try {
              input = JSON.parse(rawInput);
            } catch {
              input = rawInput;
            }
          }
          const call: PendingCall = { name, input, rawInput, at };
          const reportedStatus = asString(payload['status']);
          if (reportedStatus) call.reportedStatus = reportedStatus;
          pending.set(callId, call);
          continue;
        }
        if (ptype === 'custom_tool_call_output' || ptype === 'function_call_output') {
          const callId = asString(payload['call_id']);
          const call = callId ? pending.get(callId) : undefined;
          if (!callId) {
            warn(`line ${i + 1}: tool output without call_id`);
            continue;
          }
          const text = outputText(payload['output']);
          if (call) {
            pending.delete(callId);
            const tool = this.buildToolCall(call, text);
            events.push({ kind: 'tool', at: call.at, tool });
          } else {
            // Orphan output (call predates this rollout, e.g. resumed/forked
            // sessions). Recover name/status when present; input is unknown,
            // so use a unique fingerprint to avoid false identical-input groups.
            const name = asString(payload['name']);
            if (!name) {
              warn(`line ${i + 1}: tool output without matching call`);
              continue;
            }
            const orphan: PendingCall = { name, input: undefined, rawInput: '', at };
            const tool = this.buildToolCall(orphan, text);
            tool.inputFingerprint = fingerprint({ orphanOutput: asString(payload['id']) ?? `line-${i}` });
            events.push({ kind: 'tool', at, tool });
          }
          continue;
        }
        // reasoning, additional_tools, configuration_update, world_state etc.:
        // no v0.1 diagnostic signal; ignored intentionally.
      } catch (err) {
        warn(`line ${i + 1}: ${errorMessage(err)}`);
      }
    }

    // Calls never matched by an output (interrupted sessions): status unknown.
    for (const call of pending.values()) {
      const tool = this.buildToolCall(call, undefined);
      tool.status = 'unknown';
      events.push({ kind: 'tool', at: call.at, tool });
    }
    events.sort((a, b) => a.at - b.at);

    const record: SessionRecord = {
      agent: 'codex',
      id: meta.id,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      events,
      partial,
      parseWarnings: warnings,
      source: { kind: 'jsonl', location: file, signature: meta.signature },
    };
    if (meta.title) record.title = meta.title;
    const dir = directory ?? meta.directory;
    if (dir) record.directory = dir;
    if (currentModel) record.model = currentModel;
    if (cliVersion) record.source.version = cliVersion;
    if (reportedTotals) record.reportedTotals = reportedTotals;
    return record;
  }

  private buildToolCall(call: PendingCall, output: string | undefined): ToolCall {
    const tool: ToolCall = {
      name: call.name,
      status: 'completed',
      statusSource: 'reported',
      inputFingerprint: fingerprint(call.input),
      startedAt: call.at,
    };
    if (call.name === 'exec' || call.name === 'shell' || call.name === 'local_shell') {
      tool.commandCategory = classifyCommand(call.rawInput);
    } else if (call.name === 'apply_patch') {
      const m = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m.exec(call.rawInput);
      if (m?.[1]) tool.targetPath = m[1].trim();
    }
    if (call.reportedStatus === 'failed' || call.reportedStatus === 'incomplete') {
      tool.status = 'error';
      tool.statusSource = 'reported';
    } else if (output !== undefined && inferToolError(output)) {
      tool.status = 'error';
      tool.statusSource = 'heuristic';
      // Content-free marker: output text is NOT an error field and may contain
      // arbitrary content. Never copy output lines into the normalized model.
      tool.errorMessage = 'inferred failure: error/exit marker in tool output';
    } else if (output === undefined) {
      tool.status = 'unknown';
      tool.statusSource = 'reported';
    }
    return tool;
  }

  private emptyRecord(meta: SessionMeta, file: string, partial: boolean, warnings: string[]): SessionRecord {
    const record: SessionRecord = {
      agent: 'codex',
      id: meta.id,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      events: [],
      partial,
      parseWarnings: warnings,
      source: { kind: 'jsonl', location: file, signature: meta.signature },
    };
    if (meta.title) record.title = meta.title;
    return record;
  }

  private findRollout(id: string): string | undefined {
    const files: string[] = [];
    walkRollouts(path.join(codexHome(), 'sessions'), files);
    for (const file of files) {
      if (file.includes(id)) return file;
    }
    return undefined;
  }
}

/** Map populated by listSessions; avoids re-walking the tree per session. */
const rolloutPathById = new Map<string, string>();

function readFirstLine(file: string): unknown | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16 * 1024);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.subarray(0, bytes).toString('utf8');
    const nl = text.indexOf('\n');
    const line = nl >= 0 ? text.slice(0, nl) : text;
    return JSON.parse(line);
  } catch {
    return undefined;
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
