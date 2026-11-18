/**
 * OpenCode adapter (verified against OpenCode v2.3.x).
 *
 * Storage: SQLite database `opencode.db` under the OpenCode data dir.
 * Sessions live in `session_v2`; messages in `session_message` with parts
 * embedded in the `data` JSON `content` array. A `session_part` table exists
 * in this schema but is unused by v2.3.x; if a future version populates it,
 * this adapter must be revisited (layout probe below detects the change).
 *
 * SAFETY:
 * - The database is opened strictly read-only.
 * - Only session/project tables are queried. Tables holding credentials
 *   (account, control_account, credential, ...) are never touched.
 * - No user text or tool output content is retained; see core/types.ts.
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import type { AgentInstallation, ModelRef, SessionEvent, SessionRecord, ToolCall, ToolStatus, TokenUsage } from '../core/types.ts';
import { emptyTokens } from '../core/types.ts';
import type { AgentAdapter, SessionMeta } from './adapter.ts';
import { HavrinError, errorMessage } from '../core/errors.ts';
import { fingerprint, sanitizeErrorMessage, sanitizeFreeText, sanitizeControlChars } from '../core/util.ts';
import { classifyCommand } from '../core/classify.ts';
import { isDirectory, isReadableFile, whichSync, xdgConfigHome, xdgDataHome, homeDir } from '../core/fs.ts';

const MAX_PARSE_WARNINGS = 20;

export function opencodeDataDir(): string {
  const override = process.env['HAVRIN_OPENCODE_DATA_DIR'];
  if (override && path.isAbsolute(override)) return override;
  return path.join(xdgDataHome(), 'opencode');
}

export function opencodeConfigDir(): string {
  const override = process.env['HAVRIN_OPENCODE_CONFIG_DIR'];
  if (override && path.isAbsolute(override)) return override;
  return path.join(xdgConfigHome(), 'opencode');
}

export function opencodeDbPath(): string {
  return path.join(opencodeDataDir(), 'opencode.db');
}

function probeVersion(binary: string): string | undefined {
  try {
    // Fixed argv, no shell, bounded time/output. Only --version is ever run.
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

interface SessionRow {
  id: string;
  directory: string;
  title: string | null;
  version: string;
  cost: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  agent: string | null;
  model: string | null;
  time_created: number;
  time_updated: number;
}

interface MessageRow {
  id: string;
  type: string;
  seq: number;
  time_created: number;
  data: string;
}

function openDbReadOnly(dbPath: string): DatabaseSync {
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    throw new HavrinError(
      'IO',
      `Cannot open OpenCode database read-only: ${errorMessage(err)}`,
      'Is OpenCode running with an exclusive lock? Havrin never writes to agent data.',
    );
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

function parseModelRef(value: unknown): ModelRef | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const id = asString(rec['id']);
  const provider = asString(rec['providerID']);
  if (!id || !provider) return undefined;
  const variant = asString(rec['variant']);
  return variant ? { provider, model: id, variant } : { provider, model: id };
}

function parseTokens(value: unknown): TokenUsage | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const cache = asRecord(rec['cache']);
  return {
    input: asNumber(rec['input']) ?? 0,
    output: asNumber(rec['output']) ?? 0,
    reasoning: asNumber(rec['reasoning']) ?? 0,
    cacheRead: asNumber(cache?.['read']) ?? 0,
    cacheWrite: asNumber(cache?.['write']) ?? 0,
  };
}

function parseToolStatus(value: unknown): ToolStatus {
  return value === 'completed' || value === 'error' || value === 'running' ? value : 'unknown';
}

/** Extract a file path from structured file-tool input, when present. */
function extractTargetPath(name: string, input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  const lower = name.toLowerCase();
  let raw: string | undefined;
  if (lower === 'read' || lower === 'write' || lower === 'edit' || lower === 'multiedit') {
    raw = asString(input['path']) ?? asString(input['filePath']);
  } else if (lower === 'glob' || lower === 'grep') {
    raw = asString(input['path']);
  }
  return raw !== undefined ? sanitizeControlChars(raw) : undefined;
}

function parseToolPart(part: Record<string, unknown>): ToolCall | undefined {
  const name = asString(part['name']);
  if (!name) return undefined;
  const state = asRecord(part['state']);
  const input = asRecord(state?.['input']);
  const time = asRecord(part['time']);
  const status = parseToolStatus(state?.['status']);
  const error = asRecord(state?.['error']);
  const tool: ToolCall = {
    name,
    status,
    statusSource: 'reported',
    inputFingerprint: fingerprint(input ?? null),
  };
  const callId = asString(part['id']);
  if (callId) tool.id = callId;
  const targetPath = extractTargetPath(name, input);
  if (targetPath) tool.targetPath = targetPath;
  if (name === 'shell' || name === 'bash' || name === 'exec') {
    const command = asString(input?.['command']);
    if (command !== undefined) tool.commandCategory = classifyCommand(command);
  }
  if (status === 'error') {
    const errorType = asString(error?.['type']);
    if (errorType) tool.errorType = errorType;
    const msg = sanitizeErrorMessage(error?.['message']);
    if (msg) tool.errorMessage = msg;
  }
  const startedAt = asNumber(time?.['ran']) ?? asNumber(time?.['created']);
  const endedAt = asNumber(time?.['completed']);
  if (startedAt !== undefined) tool.startedAt = startedAt;
  if (endedAt !== undefined) tool.endedAt = endedAt;
  return tool;
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode' as const;

  detect(): AgentInstallation {
    const issues: string[] = [];
    const binaryPath =
      whichSync('opencode') ??
      (isReadableFile(path.join(homeDir(), '.opencode', 'bin', 'opencode'))
        ? path.join(homeDir(), '.opencode', 'bin', 'opencode')
        : undefined);
    const version = binaryPath ? probeVersion(binaryPath) : undefined;
    if (binaryPath && !version) issues.push('opencode binary found but --version failed');

    const dataDir = opencodeDataDir();
    const dbPath = opencodeDbPath();
    const configPath = path.join(opencodeConfigDir(), 'opencode.json');
    const installation: AgentInstallation = {
      agent: 'opencode',
      issues,
    };
    if (binaryPath) installation.binaryPath = binaryPath;
    if (version) installation.version = version;
    if (isDirectory(dataDir)) installation.dataDir = dataDir;
    if (isReadableFile(configPath)) installation.configPath = configPath;

    if (!isReadableFile(dbPath)) {
      // Legacy JSON-file storage (pre-SQLite OpenCode) is not supported in v0.1.
      const legacy = path.join(dataDir, 'storage', 'session');
      if (isDirectory(legacy)) {
        installation.layout = 'legacy-json';
        issues.push(
          'Legacy JSON session storage detected. Havrin v0.1 supports the SQLite layout (OpenCode ≥ 2.x).',
        );
      } else if (isDirectory(dataDir)) {
        installation.layout = 'unknown';
        issues.push('OpenCode data directory exists but opencode.db was not found.');
      }
      return installation;
    }

    installation.layout = 'sqlite-v2';
    let db: DatabaseSync | undefined;
    try {
      db = openDbReadOnly(dbPath);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('session_v2','session_message','session_part')")
        .all() as { name: string }[];
      const names = new Set(tables.map((t) => t.name));
      if (!names.has('session_v2') || !names.has('session_message')) {
        installation.layout = 'unknown';
        issues.push('opencode.db exists but session tables are missing or renamed.');
        return installation;
      }
      if (names.has('session_part')) {
        const partCount = (db.prepare('SELECT count(*) AS n FROM session_part').get() as { n: number }).n;
        if (partCount > 0) {
          issues.push(
            'session_part table is populated; this OpenCode version may store parts outside message data. Analysis may be incomplete.',
          );
        }
      }
      const count = (db
        .prepare('SELECT count(*) AS n FROM session_v2 WHERE time_archived IS NULL')
        .get() as { n: number }).n;
      installation.sessionCount = count;
    } catch (err) {
      issues.push(`Database probe failed: ${errorMessage(err)}`);
    } finally {
      db?.close();
    }
    return installation;
  }

  listSessions(installation: AgentInstallation): SessionMeta[] {
    if (installation.layout !== 'sqlite-v2') return [];
    const db = openDbReadOnly(opencodeDbPath());
    try {
      const rows = db
        .prepare(
          `SELECT id, directory, title, version, time_created, time_updated
           FROM session_v2 WHERE time_archived IS NULL ORDER BY time_updated DESC`,
        )
        .all() as Pick<SessionRow, 'id' | 'directory' | 'title' | 'version' | 'time_created' | 'time_updated'>[];
      return rows.map((r) => {
        const meta: SessionMeta = {
          id: r.id,
          createdAt: r.time_created,
          updatedAt: r.time_updated,
          signature: `${r.time_updated}:${r.version}`,
          directory: r.directory,
        };
        if (r.title) meta.title = sanitizeFreeText(r.title, 120);
        return meta;
      });
    } finally {
      db.close();
    }
  }

  readSession(installation: AgentInstallation, meta: SessionMeta): SessionRecord {
    if (installation.layout !== 'sqlite-v2') {
      throw new HavrinError('UNSUPPORTED', `OpenCode layout ${installation.layout ?? 'unknown'} is not supported`);
    }
    const dbPath = opencodeDbPath();
    const db = openDbReadOnly(dbPath);
    const warnings: string[] = [];
    let partial = false;
    const warn = (msg: string) => {
      partial = true;
      if (warnings.length < MAX_PARSE_WARNINGS) warnings.push(msg);
    };
    try {
      const row = db
        .prepare(
          `SELECT id, directory, title, version, cost, tokens_input, tokens_output, tokens_reasoning,
                  tokens_cache_read, tokens_cache_write, agent, model, time_created, time_updated
           FROM session_v2 WHERE id = ?`,
        )
        .get(meta.id) as SessionRow | undefined;
      if (!row) throw new HavrinError('NO_DATA', `Session ${meta.id} disappeared from the database`);

      const events: SessionEvent[] = [];
      // Guard against pathological sessions: message data includes full tool
      // output JSON. Cap total volume like the JSONL adapters do.
      const volume = db
        .prepare('SELECT COALESCE(SUM(length(data)), 0) AS n FROM session_message WHERE session_id = ?')
        .get(meta.id) as { n: number };
      if (volume.n > 128 * 1024 * 1024) {
        warn(`session message data exceeds 128MB (${volume.n} bytes); skipped for safety`);
      }
      const messages = volume.n > 128 * 1024 * 1024
        ? []
        : (db
            .prepare('SELECT id, type, seq, time_created, data FROM session_message WHERE session_id = ? ORDER BY seq')
            .all(meta.id) as unknown as MessageRow[]);

      for (const msg of messages) {
        let data: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(msg.data);
          const rec = asRecord(parsed);
          if (!rec) {
            warn(`message ${msg.id}: data is not an object`);
            continue;
          }
          data = rec;
        } catch {
          warn(`message ${msg.id}: invalid JSON`);
          continue;
        }
        const at = asNumber(asRecord(data['time'])?.['created']) ?? msg.time_created;
        try {
          const ev = this.parseMessage(msg, data, at, warn);
          if (ev) events.push(ev);
        } catch (err) {
          warn(`message ${msg.id}: ${sanitizeErrorMessage(errorMessage(err)) ?? 'message processing error'}`);
        }
      }

      const model = parseModelRef(row.model ? safeJson(row.model) : undefined);
      const record: SessionRecord = {
        agent: 'opencode',
        id: row.id,
        createdAt: row.time_created,
        updatedAt: row.time_updated,
        events,
        partial,
        parseWarnings: warnings,
        reportedTotals: {
          input: row.tokens_input,
          output: row.tokens_output,
          reasoning: row.tokens_reasoning,
          cacheRead: row.tokens_cache_read,
          cacheWrite: row.tokens_cache_write,
        },
        reportedCost: row.cost,
        source: {
          kind: 'sqlite',
          location: dbPath,
          version: row.version,
          signature: meta.signature,
        },
      };
      if (row.title) record.title = sanitizeFreeText(row.title, 120);
      if (row.directory) record.directory = row.directory;
      if (model) record.model = model;
      if (row.agent) record.agentName = row.agent;
      return record;
    } finally {
      db.close();
    }
  }

  private parseMessage(
    msg: MessageRow,
    data: Record<string, unknown>,
    at: number,
    warn: (m: string) => void,
  ): SessionEvent | undefined {
    switch (msg.type) {
      case 'user': {
        const text = asString(data['text']) ?? '';
        const files = Array.isArray(data['files']) ? data['files'].length : 0;
        return { kind: 'user', at, id: msg.id, textChars: text.length, fileCount: files };
      }
      case 'assistant': {
        const tools: ToolCall[] = [];
        let textChars = 0;
        let reasoningChars = 0;
        const content = Array.isArray(data['content']) ? data['content'] : [];
        for (const rawPart of content) {
          const part = asRecord(rawPart);
          if (!part) continue;
          const type = asString(part['type']);
          if (type === 'tool') {
            const tool = parseToolPart(part);
            if (tool) tools.push(tool);
            else warn(`message ${msg.id}: unparseable tool part`);
          } else if (type === 'text') {
            textChars += (asString(part['text']) ?? '').length;
          } else if (type === 'reasoning') {
            reasoningChars += (asString(part['text']) ?? '').length;
          }
          // Unknown part types are ignored intentionally (forward compat).
        }
        const ev: Extract<SessionEvent, { kind: 'assistant' }> = {
          kind: 'assistant',
          at,
          id: msg.id,
          tools,
          textChars,
          reasoningChars,
        };
        const model = parseModelRef(data['model']);
        if (model) ev.model = model;
        const agentName = asString(data['agent']);
        if (agentName) ev.agentName = agentName;
        const tokens = parseTokens(data['tokens']);
        if (tokens) ev.tokens = tokens;
        const cost = asNumber(data['cost']);
        if (cost !== undefined) ev.cost = cost;
        const finish = asString(data['finish']);
        if (finish) ev.finish = finish;
        const error = asRecord(data['error']);
        if (error) {
          const type = asString(error['type']) ?? 'unknown';
          const message = sanitizeErrorMessage(error['message']);
          ev.error = message ? { type, message } : { type };
        }
        const retries = asNumber(data['retry']);
        if (retries !== undefined && retries > 0) ev.retries = retries;
        return ev;
      }
      case 'compaction': {
        const ev: Extract<SessionEvent, { kind: 'compaction' }> = { kind: 'compaction', at };
        const reason = asString(data['reason']);
        if (reason) ev.reason = reason;
        const tokens = parseTokens(data['tokens']);
        if (tokens) ev.tokens = tokens;
        const cost = asNumber(data['cost']);
        if (cost !== undefined) ev.cost = cost;
        return ev;
      }
      case 'model-switched': {
        const ev: Extract<SessionEvent, { kind: 'model-switch' }> = { kind: 'model-switch', at };
        const from = parseModelRef(data['previous']);
        const to = parseModelRef(data['model']);
        if (from) ev.from = from;
        if (to) ev.to = to;
        return ev;
      }
      case 'agent-switched': {
        const ev: Extract<SessionEvent, { kind: 'agent-switch' }> = { kind: 'agent-switch', at };
        const from = asString(data['previous']);
        const to = asString(data['agent']);
        if (from) ev.from = from;
        if (to) ev.to = to;
        return ev;
      }
      case 'idle': {
        const ev: Extract<SessionEvent, { kind: 'idle' }> = { kind: 'idle', at };
        const outcome = asString(data['outcome']);
        if (outcome) ev.outcome = outcome;
        const error = asRecord(data['error']);
        if (error) {
          const type = asString(error['type']) ?? 'unknown';
          const message = sanitizeErrorMessage(error['message']);
          ev.error = message ? { type, message } : { type };
        }
        return ev;
      }
      default:
        // system/synthetic/location-switched etc. carry no diagnostic signal in v0.1.
        return undefined;
    }
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Exposed for doctor: quick read-only integrity sanity check. */
export function probeDatabase(dbPath: string): { ok: boolean; detail: string } {
  if (!isReadableFile(dbPath)) return { ok: false, detail: 'database file missing or unreadable' };
  let db: DatabaseSync | undefined;
  try {
    db = openDbReadOnly(dbPath);
    const row = db.prepare('SELECT count(*) AS n FROM session_v2').get() as { n: number };
    return { ok: true, detail: `${row.n} sessions visible (read-only)` };
  } catch (err) {
    return { ok: false, detail: errorMessage(err) };
  } finally {
    db?.close();
  }
}
