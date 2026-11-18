/**
 * Regression tests for defects confirmed by the independent v0.1 review.
 * Each test names the finding it guards (H1/H2/M1-M6/L1-L10).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parseDuration, sanitizeErrorMessage, fingerprint, isSecretKey } from '../src/core/util.ts';
import { classifyCommand, commandFromInput } from '../src/core/classify.ts';
import { runDiagnostics } from '../src/diagnostics/rules.ts';
import { scanEnvironment } from '../src/env/environment.ts';
import { loadCache, saveCache, loadLastAudit } from '../src/store.ts';
import { runAudit } from '../src/audit.ts';
import { CodexAdapter } from '../src/adapters/codex.ts';
import { OpenCodeAdapter } from '../src/adapters/opencode.ts';
import { ClaudeAdapter } from '../src/adapters/claude.ts';
import { renderTerminal } from '../src/report/terminal.ts';
import { runDemoAudit } from '../src/demo/dataset.ts';
import type { SessionRecord, SessionEvent, ToolCall, EnvironmentInfo } from '../src/core/types.ts';
import {
  tempDir,
  cleanup,
  withEnv,
  createOpencodeFixture,
  insertFixtureSession,
  insertFixtureMessage,
  writeCodexRollout,
  codexLine,
  sessionMetaPayload,
  writeClaudeTranscript,
  ccUserText,
} from './helpers.ts';

const NOW = 1_800_000_000_000;

// ---------------------------------------------------------------------------
// M1: redaction must happen before truncation
// ---------------------------------------------------------------------------

test('M1: secret straddling the truncation boundary is fully redacted', () => {
  const filler = 'x'.repeat(195);
  const msg = `${filler} sk-abcdefgh12345678 tail`;
  const out = sanitizeErrorMessage(msg);
  assert.ok(out);
  // The secret starts before char 200 and ends after it. Redaction happens
  // before truncation, so no fragment of the secret may survive — even
  // though the [REDACTED] marker itself may be cut by the boundary.
  assert.ok(!out.includes('sk-'), 'secret prefix survived truncation');
  assert.ok(!out.includes('abcdefgh12345678'), 'secret body survived truncation');
  assert.ok(out.length <= 201);
});

// ---------------------------------------------------------------------------
// M4: hostile __proto__ keys must not cause fingerprint collisions
// ---------------------------------------------------------------------------

test('M4: __proto__ payload does not collide with the stripped object', () => {
  const hostile = JSON.parse('{"__proto__":{"x":1},"a":1}') as unknown;
  const plain = { a: 1 };
  assert.notEqual(fingerprint(hostile), fingerprint(plain));
});

// ---------------------------------------------------------------------------
// L10: parseDuration whitespace symmetry
// ---------------------------------------------------------------------------

test('L10: parseDuration tolerates surrounding whitespace symmetrically', () => {
  assert.equal(parseDuration(' 30d'), 30 * 86_400_000);
  assert.equal(parseDuration('30d '), 30 * 86_400_000);
  assert.equal(parseDuration('  7d12h  '), 7 * 86_400_000 + 12 * 3_600_000);
});

// ---------------------------------------------------------------------------
// L1: secret-key matcher must not flag benign keys like "author"
// ---------------------------------------------------------------------------

test('L1: isSecretKey does not over-match author/authority-free keys', () => {
  assert.ok(!isSecretKey('author'));
  assert.ok(!isSecretKey('authors'));
  assert.ok(isSecretKey('authToken'));
  assert.ok(isSecretKey('authorization'));
  assert.ok(isSecretKey('oauth'));
});

// ---------------------------------------------------------------------------
// H2: wrapped and JSON-shaped commands classify correctly
// ---------------------------------------------------------------------------

test('H2: shell-wrapped test commands classify as test', () => {
  assert.equal(classifyCommand('bash -lc "npm test"'), 'test');
  assert.equal(classifyCommand("sh -c 'pytest -x'"), 'test');
  assert.equal(classifyCommand('/bin/bash -lc "go test ./..."'), 'test');
});

test('H2: commandFromInput unwraps JSON command shapes', () => {
  assert.equal(commandFromInput({ command: ['bash', '-lc', 'npm test'] }), 'bash -lc npm test');
  assert.equal(classifyCommand(commandFromInput({ command: ['bash', '-lc', 'npm test'] }) ?? ''), 'test');
  assert.equal(commandFromInput({ command: ['npm', 'test'] }), 'npm test');
  assert.equal(classifyCommand(commandFromInput({ command: ['npm', 'test'] }) ?? ''), 'test');
  assert.equal(commandFromInput({ command: 'cargo test' }), 'cargo test');
  assert.equal(commandFromInput('raw script'), 'raw script');
  assert.equal(commandFromInput({ other: 1 }), undefined);
});

// ---------------------------------------------------------------------------
// Rules: M2, M3, L9, mixed-heuristic cap, boundary negatives
// ---------------------------------------------------------------------------

function tool(name: string, input: unknown, status: ToolCall['status'] = 'completed', extra: Partial<ToolCall> = {}): ToolCall {
  return { name, status, statusSource: 'reported', inputFingerprint: fingerprint(input), ...extra };
}

function session(id: string, events: SessionEvent[], agent: SessionRecord['agent'] = 'opencode'): SessionRecord {
  return {
    agent, id, createdAt: NOW, updatedAt: NOW + 60_000, events,
    partial: false, parseWarnings: [],
    source: { kind: 'sqlite', location: 'fixture', signature: 'sig' },
  };
}

function assistant(at: number, tools: ToolCall[], extra: Partial<Extract<SessionEvent, { kind: 'assistant' }>> = {}): SessionEvent {
  return { kind: 'assistant', at, id: `a${at}`, tools, textChars: 10, reasoningChars: 0, ...extra };
}

function emptyEnv(): EnvironmentInfo {
  return { agents: [], mcpServers: [], skills: [], instructionFiles: [], secretExposures: [], warnings: [] };
}

function fired(ruleId: string, sessions: SessionRecord[], env: EnvironmentInfo = emptyEnv()) {
  return runDiagnostics({ sessions, environment: env }).filter((f) => f.ruleId === ruleId);
}

test('M2: a failed test run still counts as verification activity', () => {
  const writes = [
    tool('edit', { path: '/a' }, 'completed', { targetPath: '/a' }),
    tool('edit', { path: '/b' }, 'completed', { targetPath: '/b' }),
    tool('write', { path: '/c' }, 'completed', { targetPath: '/c' }),
  ];
  const events: SessionEvent[] = [
    { kind: 'user', at: NOW, id: 'u', textChars: 5, fileCount: 0 },
    assistant(NOW + 1, writes),
    assistant(NOW + 2, [tool('shell', { command: 'npm test' }, 'error', { commandCategory: 'test' })]),
    assistant(NOW + 3, []),
  ];
  assert.equal(fired('missing-test-verification', [session('s', events)]).length, 0);
});

test('M3: retry-loop evidence timestamp points at the best run, not the last', () => {
  const inputA = { command: 'a' };
  const inputB = { command: 'b' };
  const events: SessionEvent[] = [];
  for (let i = 0; i < 5; i++) events.push(assistant(NOW + i * 1000, [tool('shell', inputA)]));
  events.push(assistant(NOW + 90_000, [tool('shell', inputB)])); // later, shorter run
  const f = fired('retry-loops', [session('s', events)]);
  assert.equal(f.length, 1);
  assert.equal(f[0]?.evidence[0]?.at, NOW, 'evidence must carry the 5× run start');
  assert.equal(f[0]?.evidence[0]?.value, 5);
});

test('L9: consecutive synthetic placeholders do not fabricate retry loops', () => {
  const events = [
    assistant(NOW, [], { error: { type: 'synthetic' } }),
    assistant(NOW + 1, [], { error: { type: 'synthetic' } }),
    assistant(NOW + 2, [], { error: { type: 'synthetic' } }),
  ];
  assert.equal(fired('retry-loops', [session('s', events, 'claude')]).length, 0);
});

test('mixed reported+heuristic failure evidence caps confidence at medium', () => {
  const input = { command: 'x' };
  const events = [
    assistant(NOW, [tool('shell', input, 'error', { errorMessage: 'e' })]),
    assistant(NOW + 1, [tool('shell', input, 'error', { statusSource: 'heuristic', errorMessage: 'e' })]),
  ];
  const f = fired('repeated-tool-failures', [session('s', events)]);
  assert.equal(f[0]?.confidence, 'medium');
});

test('provider retry total ≥3 fires retry-loops', () => {
  const events = [
    assistant(NOW, [], { retries: 2 }),
    assistant(NOW + 1, [], { retries: 1 }),
  ];
  const f = fired('retry-loops', [session('s', events)]);
  assert.equal(f.length, 1);
  assert.ok(f[0]?.evidence.some((e) => e.description.includes('3 provider-reported retries')));
});

test('two consecutive identical calls are below the retry-loop threshold', () => {
  const input = { command: 'x' };
  const events = [assistant(NOW, [tool('shell', input)]), assistant(NOW + 1, [tool('shell', input)])];
  assert.equal(fired('retry-loops', [session('s', events)]).length, 0);
});

// ---------------------------------------------------------------------------
// H1: malformed configs with secrets must not leak through warnings
// ---------------------------------------------------------------------------

test('H1: malformed TOML near a secret line produces content-free warnings', () => {
  const dir = tempDir();
  const home = path.join(dir, 'home');
  const codexHome = path.join(home, '.codex');
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, 'config.toml'),
    'model = "x"\nenv = { OPENAI_API_KEY = "sk-H1SENTINEL99999" }\nthis is = not [ valid toml\n',
  );
  withEnv(
    {
      CALIPER_CODEX_HOME: codexHome,
      CALIPER_OPENCODE_CONFIG_DIR: path.join(dir, 'none'),
      CALIPER_CLAUDE_HOME: path.join(dir, 'none'),
      CODEX_HOME: undefined,
      CLAUDE_CONFIG_DIR: undefined,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
    },
    () => {
      const info = scanEnvironment({ projectDir: dir });
      assert.ok(info.warnings.length >= 1);
      const serialized = JSON.stringify(info);
      assert.ok(!serialized.includes('sk-H1SENTINEL99999'), 'TOML parser snippet leaked the secret');
      assert.ok(!serialized.includes('OPENAI_API_KEY'));
    },
  );
  cleanup(dir);
});

test('H1: malformed JSON config with a secret produces content-free warnings', () => {
  const dir = tempDir();
  const ocConfig = path.join(dir, 'oc-config');
  fs.mkdirSync(ocConfig, { recursive: true });
  fs.writeFileSync(path.join(ocConfig, 'opencode.json'), '{"apiKey": "sk-H1JSONSENTINEL777", broken');
  withEnv(
    {
      CALIPER_OPENCODE_CONFIG_DIR: ocConfig,
      CALIPER_CODEX_HOME: path.join(dir, 'none'),
      CALIPER_CLAUDE_HOME: path.join(dir, 'none'),
      CODEX_HOME: undefined,
      CLAUDE_CONFIG_DIR: undefined,
      HOME: path.join(dir, 'home'),
      USERPROFILE: path.join(dir, 'home'),
      XDG_CONFIG_HOME: path.join(dir, 'xdg'),
    },
    () => {
      const info = scanEnvironment({ projectDir: dir });
      assert.ok(info.warnings.length >= 1);
      assert.ok(!JSON.stringify(info).includes('sk-H1JSONSENTINEL777'));
    },
  );
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// M6: semantically corrupt state must not crash the pipeline
// ---------------------------------------------------------------------------

test('M6: semantically corrupt cache entries are dropped, audit survives', () => {
  const dir = tempDir();
  const dataDir = path.join(dir, 'oc-data');
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
  const db = createOpencodeFixture(dataDir);
  insertFixtureSession(db, { id: 'ses_m6', createdAt: NOW, updatedAt: Date.now() });
  insertFixtureMessage(db, 'ses_m6', 'user', { time: { created: NOW }, text: 'x' }, NOW);
  db.close();
  const state = path.join(dir, 'state');
  withEnv(
    {
      CALIPER_HOME: state,
      CALIPER_OPENCODE_DATA_DIR: dataDir,
      CALIPER_OPENCODE_CONFIG_DIR: path.join(home, '.config', 'opencode'),
      CALIPER_CODEX_HOME: path.join(dir, 'none'),
      CALIPER_CLAUDE_HOME: path.join(dir, 'none'),
      CODEX_HOME: undefined,
      CLAUDE_CONFIG_DIR: undefined,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
    },
    () => {
      // Valid JSON, correct schema version, garbage record shape.
      fs.mkdirSync(path.join(state, 'cache'), { recursive: true });
      fs.writeFileSync(
        path.join(state, 'cache', 'opencode.json'),
        JSON.stringify({ schemaVersion: 1, agent: 'opencode', entries: { ses_m6: { signature: 'fake', record: {} } } }),
      );
      const { report } = runAudit({ sinceMs: 86_400_000 });
      assert.equal(report.coverage.sessionsAnalyzed, 1);
      assert.equal(report.coverage.sessionsFromCache, 0, 'invalid entry must be re-read');
    },
  );
  cleanup(dir);
});

test('M6: semantically corrupt last-audit is rejected by loadLastAudit', () => {
  const dir = tempDir();
  withEnv({ CALIPER_HOME: dir }, () => {
    fs.writeFileSync(path.join(dir, 'last-audit.json'), JSON.stringify({ schemaVersion: '1', mode: 'real', sessions: 'not-an-array' }));
    assert.equal(loadLastAudit(), undefined);
    fs.writeFileSync(path.join(dir, 'last-audit.json'), JSON.stringify({ schemaVersion: '1' }));
    assert.equal(loadLastAudit(), undefined);
  });
  cleanup(dir);
});

test('M6: cache round-trip still works for valid entries', () => {
  const dir = tempDir();
  withEnv({ CALIPER_HOME: dir }, () => {
    const rec = session('ses_valid', []);
    const entries = new Map([['ses_valid', { signature: 's1', record: rec }]]);
    saveCache('opencode', entries);
    const loaded = loadCache('opencode');
    assert.equal(loaded.size, 1);
    assert.equal(loaded.get('ses_valid')?.signature, 's1');
  });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// L2 / L8 / H2-integration: Codex adapter regressions
// ---------------------------------------------------------------------------

test('L2: duplicate codex session ids are deduped to the newest rollout', () => {
  const dir = tempDir();
  const home = path.join(dir, 'codex');
  fs.mkdirSync(home, { recursive: true });
  const sid = '01a1dup-0000-0000-0000-000000000001';
  const f1 = writeCodexRollout(home, sid, [codexLine('session_meta', sessionMetaPayload(sid))], ['2026', '11', '01']);
  const f2 = writeCodexRollout(home, sid, [
    codexLine('session_meta', sessionMetaPayload(sid)),
    codexLine('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'newer' }] }, '2026-11-10T10:00:01.000Z'),
  ], ['2026', '11', '10']);
  const past = new Date(Date.now() - 86_400_000);
  fs.utimesSync(f1, past, past);
  withEnv({ CALIPER_CODEX_HOME: home, CODEX_HOME: undefined, PATH: '' }, () => {
    const adapter = new CodexAdapter();
    const inst = adapter.detect();
    const metas = adapter.listSessions(inst);
    assert.equal(metas.length, 1);
    const record = adapter.readSession(inst, metas[0]!);
    assert.equal(record.source.location, f2);
    assert.equal(record.events.filter((e) => e.kind === 'user').length, 1);
  });
  cleanup(dir);
});

test('L8: reported failed status survives missing output', () => {
  const dir = tempDir();
  const home = path.join(dir, 'codex');
  fs.mkdirSync(home, { recursive: true });
  const sid = '01a1fail-0000-0000-0000-000000000001';
  writeCodexRollout(home, sid, [
    codexLine('session_meta', sessionMetaPayload(sid)),
    codexLine('response_item', { type: 'custom_tool_call', call_id: 'c1', name: 'exec', input: 'false', status: 'failed' }, '2026-11-10T10:00:01.000Z'),
  ]);
  withEnv({ CALIPER_CODEX_HOME: home, CODEX_HOME: undefined, PATH: '' }, () => {
    const adapter = new CodexAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    const t = record.events.find((e) => e.kind === 'tool');
    assert.ok(t && t.kind === 'tool');
    if (t?.kind === 'tool') assert.equal(t.tool.status, 'error');
  });
  cleanup(dir);
});

test('H2: codex function_call JSON command input classifies tests', () => {
  const dir = tempDir();
  const home = path.join(dir, 'codex');
  fs.mkdirSync(home, { recursive: true });
  const sid = '01a1json-0000-0000-0000-000000000001';
  writeCodexRollout(home, sid, [
    codexLine('session_meta', sessionMetaPayload(sid)),
    codexLine('response_item', { type: 'function_call', call_id: 'c1', name: 'shell', input: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }) }, '2026-11-10T10:00:01.000Z'),
    codexLine('response_item', { type: 'function_call_output', call_id: 'c1', output: 'ok' }, '2026-11-10T10:00:02.000Z'),
  ]);
  withEnv({ CALIPER_CODEX_HOME: home, CODEX_HOME: undefined, PATH: '' }, () => {
    const adapter = new CodexAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    const t = record.events.find((e) => e.kind === 'tool');
    assert.ok(t && t.kind === 'tool');
    if (t?.kind === 'tool') assert.equal(t.tool.commandCategory, 'test');
  });
  cleanup(dir);
});

test('codex: multiple token_usage_records attach to successive assistant turns', () => {
  const dir = tempDir();
  const home = path.join(dir, 'codex');
  fs.mkdirSync(home, { recursive: true });
  const sid = '01a1tok-0000-0000-0000-000000000001';
  const usage = (n: number) => ({ usage: { input_tokens: n, output_tokens: n * 2, cached_input_tokens: 0 }, thread_token_usage: { input_tokens: n, output_tokens: n * 2 } });
  writeCodexRollout(home, sid, [
    codexLine('session_meta', sessionMetaPayload(sid)),
    codexLine('response_item', { type: 'message', role: 'assistant', id: 'm1', content: [{ type: 'output_text', text: 'a' }] }, '2026-11-10T10:00:01.000Z'),
    codexLine('token_usage_record', usage(10), '2026-11-10T10:00:02.000Z'),
    codexLine('response_item', { type: 'message', role: 'assistant', id: 'm2', content: [{ type: 'output_text', text: 'b' }] }, '2026-11-10T10:00:03.000Z'),
    codexLine('token_usage_record', usage(20), '2026-11-10T10:00:04.000Z'),
  ]);
  withEnv({ CALIPER_CODEX_HOME: home, CODEX_HOME: undefined, PATH: '' }, () => {
    const adapter = new CodexAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    const assts = record.events.filter((e) => e.kind === 'assistant');
    assert.equal(assts.length, 2);
    const tokens = assts.map((a) => (a.kind === 'assistant' ? a.tokens?.output : undefined));
    assert.deepEqual(tokens, [20, 40]);
  });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// L7: OpenCode WAL mode + message volume guard
// ---------------------------------------------------------------------------

test('L7: WAL-mode fixture database ingests read-only', () => {
  const dir = tempDir();
  const dataDir = path.join(dir, 'oc-data');
  const db = createOpencodeFixture(dataDir);
  db.exec('PRAGMA journal_mode=WAL');
  insertFixtureSession(db, { id: 'ses_wal', createdAt: NOW, updatedAt: Date.now() });
  insertFixtureMessage(db, 'ses_wal', 'user', { time: { created: NOW }, text: 'wal turn' }, NOW);
  db.close();
  const dbPath = path.join(dataDir, 'opencode.db');
  const before = fs.readFileSync(dbPath);
  withEnv({ CALIPER_OPENCODE_DATA_DIR: dataDir, PATH: '' }, () => {
    const adapter = new OpenCodeAdapter();
    const inst = adapter.detect();
    assert.equal(inst.layout, 'sqlite-v2');
    const metas = adapter.listSessions(inst);
    const record = adapter.readSession(inst, metas[0]!);
    assert.equal(record.events.filter((e) => e.kind === 'user').length, 1);
  });
  assert.ok(before.equals(fs.readFileSync(dbPath)), 'main DB file must be unchanged');
  cleanup(dir);
});

test('L7: oversized OpenCode message volume is skipped with a warning', () => {
  const dir = tempDir();
  const dataDir = path.join(dir, 'oc-data');
  const db = createOpencodeFixture(dataDir);
  insertFixtureSession(db, { id: 'ses_big', createdAt: NOW, updatedAt: Date.now() });
  // zeroblob stores sparsely: cheap 128MB+ row without real I/O.
  db.prepare(
    'INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, zeroblob(?))',
  ).run('msg_big', 'ses_big', 'assistant', 1, NOW, NOW, 128 * 1024 * 1024 + 1);
  db.close();
  withEnv({ CALIPER_OPENCODE_DATA_DIR: dataDir, PATH: '' }, () => {
    const adapter = new OpenCodeAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    assert.equal(record.partial, true);
    assert.ok(record.parseWarnings.some((w) => w.includes('128MB')));
    assert.equal(record.events.length, 0);
    assert.ok(record.reportedTotals, 'session-level aggregates still available');
  });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// M7: titles are the disclosed free-text exception, truncated
// ---------------------------------------------------------------------------

test('M7: claude ai-title is truncated to 120 chars', () => {
  const dir = tempDir();
  const home = path.join(dir, 'claude');
  fs.mkdirSync(home, { recursive: true });
  const longTitle = 'TITLE-SENTINEL ' + 'y'.repeat(300);
  writeClaudeTranscript(home, '-p', 'title-sid', [
    ccUserText('x'),
    { type: 'ai-title', sessionId: 'title-sid', aiTitle: longTitle },
  ]);
  withEnv({ CALIPER_CLAUDE_HOME: home, CLAUDE_CONFIG_DIR: undefined, PATH: '' }, () => {
    const adapter = new ClaudeAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    assert.ok(record.title);
    assert.ok(record.title.length <= 121); // 120 chars + ellipsis marker
    assert.ok(record.title.startsWith('TITLE-SENTINEL'));
  });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// L5: terminal wrapping with ANSI indents and unbreakable words
// ---------------------------------------------------------------------------

test('L5: long paths hard-break within width; colored indents budget visible width', () => {
  const report = runDemoAudit();
  report.findings.push({
    ruleId: 'redundant-file-reads',
    title: 'Width probe',
    severity: 'low',
    confidence: 'high',
    scope: 'sessions',
    evidence: [{ description: 'File ' + '/very/long/path/'.repeat(12) + 'file.ts read 9×' }],
    consequence: 'x',
    suggestion: 'y',
  });
  for (const color of [false, true]) {
    const out = renderTerminal(report, { color, width: 72 });
    for (const line of out.split('\n')) {
      const visible = line.replace(/\u001b\[[0-9;]*m/g, '');
      assert.ok(visible.length <= 100, `line overflows (${visible.length}): ${visible.slice(0, 50)}`);
    }
  }
});
