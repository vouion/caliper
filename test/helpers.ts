/** Shared test fixtures: temp dirs, synthetic OpenCode SQLite DB, Codex rollouts. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function tempDir(prefix = 'havrin-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/** Create a fixture OpenCode database matching the verified v2.3.x schema subset. */
export function createOpencodeFixture(dataDir: string): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'opencode.db'));
  db.exec(`
    CREATE TABLE session_v2 (
      id text PRIMARY KEY, project_id text NOT NULL, workspace_id text, parent_id text,
      slug text NOT NULL, directory text NOT NULL, title text, version text NOT NULL,
      cost real DEFAULT 0 NOT NULL,
      tokens_input integer DEFAULT 0 NOT NULL, tokens_output integer DEFAULT 0 NOT NULL,
      tokens_reasoning integer DEFAULT 0 NOT NULL, tokens_cache_read integer DEFAULT 0 NOT NULL,
      tokens_cache_write integer DEFAULT 0 NOT NULL,
      agent text, model text, time_created integer NOT NULL, time_updated integer NOT NULL,
      time_archived integer
    );
    CREATE TABLE session_message (
      id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL,
      time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL
    );
    CREATE TABLE session_part (
      message_id text NOT NULL, session_id text NOT NULL, ordinal integer NOT NULL,
      type text NOT NULL, call_id text, time_created integer NOT NULL,
      time_updated integer NOT NULL, data text NOT NULL
    );
    CREATE TABLE account (id text PRIMARY KEY, email text, access_token text, refresh_token text);
    INSERT INTO account VALUES ('acc1', 'secret@example.com', 'SUPER-SECRET-ACCESS-TOKEN', 'SUPER-SECRET-REFRESH');
  `);
  return db;
}

export interface FixtureSessionOpts {
  id: string;
  title?: string;
  directory?: string;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  cost?: number;
  tokens?: { input: number; output: number; reasoning?: number; cacheRead?: number; cacheWrite?: number };
  model?: { id: string; providerID: string; variant?: string };
  agent?: string;
}

export function insertFixtureSession(db: DatabaseSync, opts: FixtureSessionOpts): void {
  db.prepare(
    `INSERT INTO session_v2 (id, project_id, slug, directory, title, version, cost,
      tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
      agent, model, time_created, time_updated, time_archived)
     VALUES (?, 'proj1', ?, ?, ?, '2.3.1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.id,
    opts.id,
    opts.directory ?? '/fixture/project',
    opts.title ?? null,
    opts.cost ?? 0,
    opts.tokens?.input ?? 0,
    opts.tokens?.output ?? 0,
    opts.tokens?.reasoning ?? 0,
    opts.tokens?.cacheRead ?? 0,
    opts.tokens?.cacheWrite ?? 0,
    opts.agent ?? null,
    opts.model ? JSON.stringify(opts.model) : null,
    opts.createdAt,
    opts.updatedAt,
    opts.archived ? opts.updatedAt : null,
  );
}

let seqCounter = 0;

export function insertFixtureMessage(
  db: DatabaseSync,
  sessionId: string,
  type: string,
  data: unknown,
  timeCreated: number,
): string {
  const id = `msg_${sessionId}_${seqCounter++}`;
  db.prepare(
    'INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, sessionId, type, seqCounter, timeCreated, timeCreated, typeof data === 'string' ? data : JSON.stringify(data));
  return id;
}

export function assistantData(opts: {
  at: number;
  tools?: unknown[];
  text?: string;
  tokens?: { input: number; output: number; reasoning?: number; cache?: { read?: number; write?: number } };
  cost?: number;
  error?: { type: string; message: string };
  retry?: number;
  model?: { id: string; providerID: string };
}): unknown {
  const content: unknown[] = [];
  if (opts.text) content.push({ type: 'text', text: opts.text });
  for (const t of opts.tools ?? []) content.push(t);
  const data: Record<string, unknown> = {
    time: { created: opts.at },
    agent: 'build',
    model: opts.model ?? { id: 'fixture-model', providerID: 'fixture' },
    content,
  };
  if (opts.tokens) data['tokens'] = opts.tokens;
  if (opts.cost !== undefined) data['cost'] = opts.cost;
  if (opts.error) data['error'] = opts.error;
  if (opts.retry !== undefined) data['retry'] = opts.retry;
  return data;
}

export function toolPart(opts: {
  name: string;
  input: unknown;
  status?: 'completed' | 'error' | 'running';
  error?: { type: string; message: string };
  at?: number;
}): unknown {
  const state: Record<string, unknown> = { status: opts.status ?? 'completed', input: opts.input };
  if (opts.error) state['error'] = opts.error;
  return {
    type: 'tool',
    id: `call_${Math.random().toString(36).slice(2)}`,
    name: opts.name,
    executed: true,
    state,
    time: { created: opts.at ?? 0, ran: opts.at ?? 0, completed: (opts.at ?? 0) + 100 },
  };
}

/** Write a Codex rollout fixture; returns the file path. */
export function writeCodexRollout(
  home: string,
  sessionId: string,
  lines: unknown[],
  dateParts = ['2026', '11', '10'],
): string {
  const dir = path.join(home, 'sessions', ...dateParts);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-11-10T10-00-00-${sessionId}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  return file;
}

export function codexLine(type: string, payload: unknown, at = '2026-11-10T10:00:00.000Z'): unknown {
  return { timestamp: at, type, payload };
}

export function sessionMetaPayload(sessionId: string, cwd = '/fixture/project'): unknown {
  return {
    session_id: sessionId,
    id: sessionId,
    timestamp: '2026-11-10T10:00:00.000Z',
    cwd,
    cli_version: '0.169.0',
    model_provider: 'openai',
    originator: 'codex-tui',
  };
}

/** Run a function with temporary env overrides, restoring afterwards. */
export function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
