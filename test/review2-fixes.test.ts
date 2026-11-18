/**
 * Regression tests for defects confirmed by the independent v0.2 review
 * (H-1, M-1..M-4, L-1..L-8). Each test names the finding it guards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { classifyCommand, commandFromInput } from '../src/core/classify.ts';
import { sanitizeControlChars, sanitizeFreeText } from '../src/core/util.ts';
import { runDiagnostics } from '../src/diagnostics/rules.ts';
import { loadCache, saveCache, loadLastAudit } from '../src/store.ts';
import { runAudit } from '../src/audit.ts';
import { ClaudeAdapter, claudeHome } from '../src/adapters/claude.ts';
import { CodexAdapter } from '../src/adapters/codex.ts';
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
  writeClaudeTranscript,
  writeCodexRollout,
  codexLine,
  sessionMetaPayload,
  ccUserText,
  ccAssistant,
  ccToolUse,
  ccToolResult,
} from './helpers.ts';

const NOW = 1_800_000_000_000;

function fullEnv(dir: string, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const home = path.join(dir, 'home');
  return {
    CALIPER_HOME: path.join(dir, 'state'),
    CALIPER_OPENCODE_DATA_DIR: path.join(dir, 'no-oc'),
    CALIPER_OPENCODE_CONFIG_DIR: path.join(dir, 'no-oc-cfg'),
    CALIPER_CODEX_HOME: path.join(dir, 'no-cx'),
    CALIPER_CLAUDE_HOME: path.join(dir, 'no-claude'),
    CODEX_HOME: undefined,
    CLAUDE_CONFIG_DIR: undefined,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    PATH: '',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// M-4 / L-8: classification must not count mentions as execution
// ---------------------------------------------------------------------------

test('M-4: search/echo/commit mentions of test runners are NOT test execution', () => {
  assert.equal(classifyCommand('grep -rn pytest .'), 'search');
  assert.equal(classifyCommand('grep -r "pytest" .'), 'search');
  assert.equal(classifyCommand('rg "npm test" src/'), 'search');
  assert.equal(classifyCommand('echo "npm test"'), 'other');
  assert.equal(classifyCommand('printf "%s" "pytest"'), 'other');
  assert.equal(classifyCommand('git commit -m "npm test fixes"'), 'git');
  assert.equal(classifyCommand(commandFromInput({ command: ['echo', 'npm test'] }) ?? ''), 'other');
});

test('M-4: real test execution still classifies through wrappers and pipelines', () => {
  assert.equal(classifyCommand('bash -lc "npm test"'), 'test');
  assert.equal(classifyCommand("sh -c 'pytest -x'"), 'test');
  assert.equal(classifyCommand('npm test;'), 'test');
  assert.equal(classifyCommand('npm test|tee log'), 'test');
  assert.equal(classifyCommand('(npm test)'), 'test');
  assert.equal(classifyCommand('cd app && npm test'), 'test');
  assert.equal(classifyCommand('grep foo bar && pytest'), 'test');
  assert.equal(classifyCommand(commandFromInput({ command: ['bash', '-lc', 'npm test'] }) ?? ''), 'test');
});

test('L-8: boundary symmetry — make alone is build, trailing punctuation handled', () => {
  assert.equal(classifyCommand('make'), 'build');
  assert.equal(classifyCommand('make;'), 'build');
  assert.equal(classifyCommand('tsc'), 'build');
  assert.equal(classifyCommand('cargo build'), 'build');
});

// ---------------------------------------------------------------------------
// M-2: control characters in free text must never reach the terminal
// ---------------------------------------------------------------------------

test('M-2: sanitizeControlChars strips ESC/CSI/BEL/newlines', () => {
  const hostile = 'title\u001b[31mINJECTED\u001b[0m\u0007\r\nmore\u009btext';
  const out = sanitizeControlChars(hostile);
  assert.ok(!out.includes('\u001b'));
  assert.ok(!out.includes('\u0007'));
  assert.ok(!out.includes('\n'));
  assert.ok(!out.includes('\u009b'));
  assert.ok(out.includes('INJECTED')); // visible text preserved
});

test('M-2: ESC-bearing Claude ai-title is sanitized at ingestion and render', () => {
  const dir = tempDir();
  const home = path.join(dir, 'claude');
  fs.mkdirSync(home, { recursive: true });
  writeClaudeTranscript(home, '-p', 'esc-sid', [
    ccUserText('x'),
    { type: 'ai-title', sessionId: 'esc-sid', aiTitle: 'Evil\u001b[2J\u001b[1;1HFAKE REPORT LINE\r\nTitle' },
  ]);
  withEnv(fullEnv(dir, { CALIPER_CLAUDE_HOME: home }), () => {
    const adapter = new ClaudeAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    assert.ok(record.title);
    assert.ok(!record.title.includes('\u001b'));
    assert.ok(!record.title.includes('\n'));
    const report = runDemoAudit();
    report.sessions[0]!.title = record.title;
    const out = renderTerminal(report, { color: false, width: 80 });
    assert.ok(!out.includes('\u001b'), 'renderer emitted raw escapes from free text');
  });
  cleanup(dir);
});

test('M-2: ESC-bearing file paths are sanitized at ingestion', () => {
  const dir = tempDir();
  const home = path.join(dir, 'claude');
  fs.mkdirSync(home, { recursive: true });
  writeClaudeTranscript(home, '-p', 'esc-path-sid', [
    ccAssistant({ messageId: 'm1', blocks: [ccToolUse('t1', 'Read', { file_path: '/tmp/evil\u001b[31m.ts' })] }),
    ccToolResult({ toolUseId: 't1' }),
  ]);
  withEnv(fullEnv(dir, { CALIPER_CLAUDE_HOME: home }), () => {
    const adapter = new ClaudeAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    const tool = record.events.flatMap((e) => (e.kind === 'assistant' ? e.tools : []))[0];
    assert.equal(tool?.targetPath, '/tmp/evil[31m.ts');
  });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// M-3: Claude api_error signals must feed retry-loops
// ---------------------------------------------------------------------------

function tool(name: string, input: unknown, status: ToolCall['status'] = 'completed'): ToolCall {
  return { name, status, statusSource: 'reported', inputFingerprint: `fp-${name}-${JSON.stringify(input)}` };
}

function session(id: string, events: SessionEvent[], agent: SessionRecord['agent'] = 'claude'): SessionRecord {
  return {
    agent, id, createdAt: NOW, updatedAt: NOW + 60_000, events,
    partial: false, parseWarnings: [],
    source: { kind: 'jsonl', location: 'fixture', signature: 'sig' },
  };
}

function emptyEnv(): EnvironmentInfo {
  return { agents: [], mcpServers: [], skills: [], instructionFiles: [], secretExposures: [], warnings: [] };
}

test('M-3: consecutive api_error idle events fire retry-loops', () => {
  const events: SessionEvent[] = [
    { kind: 'idle', at: NOW, error: { type: 'api_error' } },
    { kind: 'idle', at: NOW + 1, error: { type: 'api_error' } },
  ];
  const f = runDiagnostics({ sessions: [session('s', events)], environment: emptyEnv() }).filter((x) => x.ruleId === 'retry-loops');
  assert.equal(f.length, 1);
});

test('M-3: a single api_error does not fire; non-api idle does not count', () => {
  const one: SessionEvent[] = [{ kind: 'idle', at: NOW, error: { type: 'api_error' } }];
  const other: SessionEvent[] = [
    { kind: 'idle', at: NOW, error: { type: 'other' } },
    { kind: 'idle', at: NOW + 1, error: { type: 'other' } },
  ];
  const f = runDiagnostics({ sessions: [session('s1', one), session('s2', other)], environment: emptyEnv() }).filter((x) => x.ruleId === 'retry-loops');
  assert.equal(f.length, 0);
});

// ---------------------------------------------------------------------------
// L-6: mcp__ convention rule coverage
// ---------------------------------------------------------------------------

test('L-6: unused-mcp-servers recognizes Claude mcp__server__tool naming', () => {
  const env = emptyEnv();
  env.mcpServers = [{ agent: 'claude', configPath: '/proj/.mcp.json', names: ['playwright', 'unused'] }];
  const asst: SessionEvent = {
    kind: 'assistant', at: NOW, id: 'a', tools: [tool('mcp__playwright__browser_navigate', { url: 'x' })], textChars: 0, reasoningChars: 0,
  };
  const f = runDiagnostics({ sessions: [session('s', [asst])], environment: env }).filter((x) => x.ruleId === 'unused-mcp-servers');
  assert.equal(f.length, 1);
  assert.ok(f[0]?.title.includes('unused'));
  assert.ok(!f[0]?.title.includes('playwright'));
});

// ---------------------------------------------------------------------------
// M-1: deep semantic corruption vectors must be rejected safely
// ---------------------------------------------------------------------------

test('M-1: cache entries with null events / missing tools / missing warnings are dropped', () => {
  const dir = tempDir();
  const base = {
    agent: 'opencode', id: 'ses_x', createdAt: NOW, updatedAt: NOW,
    partial: false, parseWarnings: [],
    source: { kind: 'sqlite', location: 'f', signature: 's' },
  };
  withEnv({ CALIPER_HOME: dir }, () => {
    const entries = new Map<string, { signature: string; record: unknown }>([
      ['null-event', { signature: 's', record: { ...base, id: 'null-event', events: [null] } }],
      ['no-tools', { signature: 's', record: { ...base, id: 'no-tools', events: [{ kind: 'assistant', at: NOW, id: 'a', textChars: 0, reasoningChars: 0 }] } }],
      ['no-warnings', { signature: 's', record: { ...base, id: 'no-warnings', partial: true, parseWarnings: undefined, events: [] } }],
      ['wrong-agent', { signature: 's', record: { ...base, id: 'wrong-agent', agent: 'codex', events: [] } }],
      ['valid', { signature: 's', record: { ...base, id: 'valid', events: [] } }],
    ]);
    saveCache('opencode', entries as Map<string, { signature: string; record: SessionRecord }>);
    const loaded = loadCache('opencode');
    assert.equal(loaded.size, 1);
    assert.ok(loaded.has('valid'));
  });
  cleanup(dir);
});

test('M-1: audit survives a semantically corrupt cache (re-reads instead of crashing)', () => {
  const dir = tempDir();
  const dataDir = path.join(dir, 'oc-data');
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
  const db = createOpencodeFixture(dataDir);
  insertFixtureSession(db, { id: 'ses_m1', createdAt: NOW, updatedAt: Date.now() });
  insertFixtureMessage(db, 'ses_m1', 'user', { time: { created: NOW }, text: 'x' }, NOW);
  db.close();
  const state = path.join(dir, 'state');
  fs.mkdirSync(path.join(state, 'cache'), { recursive: true });
  fs.writeFileSync(path.join(state, 'cache', 'opencode.json'), JSON.stringify({
    schemaVersion: 1, agent: 'opencode',
    entries: { ses_m1: { signature: 'fake', record: { agent: 'opencode', id: 'ses_m1', createdAt: NOW, updatedAt: NOW, partial: true, events: [null], source: { kind: 'sqlite', location: 'f', signature: 's' } } } },
  }));
  withEnv(fullEnv(dir, { CALIPER_HOME: state, CALIPER_OPENCODE_DATA_DIR: dataDir, CALIPER_OPENCODE_CONFIG_DIR: path.join(home, '.config', 'opencode') }), () => {
    const { report } = runAudit({ sinceMs: 86_400_000 });
    assert.equal(report.coverage.sessionsAnalyzed, 1);
    assert.equal(report.coverage.sessionsFromCache, 0);
  });
  cleanup(dir);
});

test('M-1: artifact with null findings / empty recommendations / null sessions is rejected', () => {
  const dir = tempDir();
  const valid = runDemoAudit();
  withEnv({ CALIPER_HOME: dir }, () => {
    for (const corrupt of [
      { ...valid, findings: [null] },
      { ...valid, recommendations: [{}] },
      { ...valid, sessions: [null] },
      { ...valid, totals: null },
    ]) {
      fs.writeFileSync(path.join(dir, 'last-audit.json'), JSON.stringify(corrupt));
      assert.equal(loadLastAudit(), undefined, 'corrupt artifact accepted');
    }
    fs.writeFileSync(path.join(dir, 'last-audit.json'), JSON.stringify(valid));
    assert.ok(loadLastAudit(), 'valid demo artifact rejected');
  });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// L-1 / L-2: Claude group-merge and cost-state defensive warnings
// ---------------------------------------------------------------------------

test('L-1: assistant record without message.id produces partial + warning', () => {
  const dir = tempDir();
  const home = path.join(dir, 'claude');
  fs.mkdirSync(home, { recursive: true });
  const rec = ccAssistant({ messageId: 'm1', blocks: [{ type: 'text', text: 'hi' }] });
  delete (rec['message'] as Record<string, unknown>)['id'];
  writeClaudeTranscript(home, '-p', 'noid-sid', [rec]);
  withEnv(fullEnv(dir, { CALIPER_CLAUDE_HOME: home }), () => {
    const adapter = new ClaudeAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    assert.equal(record.partial, true);
    assert.ok(record.parseWarnings.some((w) => w.includes('message.id')));
  });
  cleanup(dir);
});

test('L-1: intra-group usage disagreement warns and keeps first usage', () => {
  const dir = tempDir();
  const home = path.join(dir, 'claude');
  fs.mkdirSync(home, { recursive: true });
  writeClaudeTranscript(home, '-p', 'disagree-sid', [
    ccAssistant({ messageId: 'm1', blocks: [{ type: 'thinking', thinking: 'x' }], usage: { input_tokens: 1, output_tokens: 10 } }),
    ccAssistant({ messageId: 'm1', blocks: [{ type: 'text', text: 'y' }], usage: { input_tokens: 1, output_tokens: 999 } }),
  ]);
  withEnv(fullEnv(dir, { CALIPER_CLAUDE_HOME: home }), () => {
    const adapter = new ClaudeAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    assert.ok(record.parseWarnings.some((w) => w.includes('disagrees')));
    const a = record.events.find((e) => e.kind === 'assistant');
    assert.ok(a && a.kind === 'assistant');
    if (a?.kind === 'assistant') assert.equal(a.tokens?.output, 10);
  });
  cleanup(dir);
});

test('L-2: malformed cost-state entry warns; truthy hasUnknownModelCost suppresses cost', () => {
  const dir = tempDir();
  const home = path.join(dir, 'claude');
  fs.mkdirSync(home, { recursive: true });
  writeClaudeTranscript(home, '-p', 'cost-sid', [
    ccUserText('x'),
    {
      type: 'cost-state', sessionId: 'cost-sid', totalCostUSD: 5,
      hasUnknownModelCost: 'true',
      modelUsage: { good: { inputTokens: 1, outputTokens: 2 }, bad: 'not-an-object' },
    },
  ]);
  withEnv(fullEnv(dir, { CALIPER_CLAUDE_HOME: home }), () => {
    const adapter = new ClaudeAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    assert.equal(record.reportedCost, undefined);
    assert.equal(record.partial, true);
    assert.ok(record.parseWarnings.some((w) => w.includes('modelUsage')));
    assert.deepEqual(record.reportedTotals, { input: 1, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
  });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// L-4: exact-id transcript lookup (no substring collisions)
// ---------------------------------------------------------------------------

test('L-4: codex findRollout matches exact id suffix, not substring', () => {
  const dir = tempDir();
  const home = path.join(dir, 'codex');
  fs.mkdirSync(home, { recursive: true });
  const shortId = 'abc123';
  const longId = 'xabc123';
  writeCodexRollout(home, shortId, [codexLine('session_meta', sessionMetaPayload(shortId))], ['2026', '11', '01']);
  const newer = writeCodexRollout(home, longId, [
    codexLine('session_meta', sessionMetaPayload(longId)),
    codexLine('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'long-id session' }] }, '2026-11-10T10:00:01.000Z'),
  ], ['2026', '11', '10']);
  withEnv(fullEnv(dir, { CALIPER_CODEX_HOME: home }), () => {
    const adapter = new CodexAdapter();
    const inst = adapter.detect();
    // Bypass listSessions so the path map is empty and findRollout is used.
    const meta = { id: shortId, createdAt: NOW, updatedAt: NOW, signature: 's' };
    const record = adapter.readSession(inst, meta);
    assert.ok(record.source.location.endsWith(`-${shortId}.jsonl`));
    assert.notEqual(record.source.location, newer);
  });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// L-6: additional Claude behavior coverage
// ---------------------------------------------------------------------------

test('L-6: CLAUDE_CONFIG_DIR is honored; CALIPER_CLAUDE_HOME takes precedence', () => {
  const dir = tempDir();
  const official = path.join(dir, 'official-claude');
  const override = path.join(dir, 'override-claude');
  fs.mkdirSync(official, { recursive: true });
  fs.mkdirSync(override, { recursive: true });
  writeClaudeTranscript(official, '-p', 'official-sid', [ccUserText('official')]);
  writeClaudeTranscript(override, '-p', 'override-sid', [ccUserText('override')]);
  withEnv(fullEnv(dir, { CALIPER_CLAUDE_HOME: undefined, CLAUDE_CONFIG_DIR: official }), () => {
    assert.equal(claudeHome(), official);
    const adapter = new ClaudeAdapter();
    const metas = adapter.listSessions(adapter.detect());
    assert.deepEqual(metas.map((m) => m.id), ['official-sid']);
  });
  withEnv(fullEnv(dir, { CALIPER_CLAUDE_HOME: override, CLAUDE_CONFIG_DIR: official }), () => {
    assert.equal(claudeHome(), override);
  });
  cleanup(dir);
});

test('L-6: tool_result appearing before its tool_use still resolves', () => {
  const dir = tempDir();
  const home = path.join(dir, 'claude');
  fs.mkdirSync(home, { recursive: true });
  writeClaudeTranscript(home, '-p', 'order-sid', [
    ccToolResult({ toolUseId: 't1', isError: true, at: '2026-11-10T10:00:01.000Z' }),
    ccAssistant({ messageId: 'm1', at: '2026-11-10T10:00:02.000Z', blocks: [ccToolUse('t1', 'Bash', { command: 'false' })] }),
  ]);
  withEnv(fullEnv(dir, { CALIPER_CLAUDE_HOME: home }), () => {
    const adapter = new ClaudeAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    const t = record.events.flatMap((e) => (e.kind === 'assistant' ? e.tools : []))[0];
    assert.equal(t?.status, 'error');
  });
  cleanup(dir);
});

test('L-6: parse warnings are capped at 20', () => {
  const dir = tempDir();
  const home = path.join(dir, 'claude');
  fs.mkdirSync(home, { recursive: true });
  writeClaudeTranscript(home, '-p', 'manybad-sid', Array.from({ length: 30 }, () => '{bad json'));
  withEnv(fullEnv(dir, { CALIPER_CLAUDE_HOME: home }), () => {
    const adapter = new ClaudeAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    assert.equal(record.partial, true);
    assert.ok(record.parseWarnings.length <= 20);
  });
  cleanup(dir);
});

test('L-6: image-only user content counts as a turn; empty string does not', () => {
  const dir = tempDir();
  const home = path.join(dir, 'claude');
  fs.mkdirSync(home, { recursive: true });
  writeClaudeTranscript(home, '-p', 'img-sid', [
    { type: 'user', uuid: 'u1', timestamp: '2026-11-10T10:00:00.000Z', cwd: '/p', isSidechain: false, message: { role: 'user', content: [{ type: 'image', source: { data: 'x' } }] } },
    { type: 'user', uuid: 'u2', timestamp: '2026-11-10T10:00:01.000Z', cwd: '/p', isSidechain: false, message: { role: 'user', content: '' } },
  ]);
  withEnv(fullEnv(dir, { CALIPER_CLAUDE_HOME: home }), () => {
    const adapter = new ClaudeAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    const users = record.events.filter((e) => e.kind === 'user');
    assert.equal(users.length, 1);
    assert.equal(users[0]?.kind === 'user' ? users[0].textChars : -1, 0);
  });
  cleanup(dir);
});

test('L-6: cache eviction keeps the newest 2000 entries', () => {
  const dir = tempDir();
  withEnv({ CALIPER_HOME: dir }, () => {
    const entries = new Map<string, { signature: string; record: SessionRecord }>();
    for (let i = 0; i < 2001; i++) {
      entries.set(`s${i}`, { signature: 's', record: session(`s${i}`, [], 'opencode') });
      entries.get(`s${i}`)!.record.updatedAt = NOW + i;
    }
    saveCache('opencode', entries);
    const loaded = loadCache('opencode');
    assert.equal(loaded.size, 2000);
    assert.ok(loaded.has('s2000'), 'newest must survive');
    assert.ok(!loaded.has('s0'), 'oldest must be evicted');
  });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// H-1: forced processing error must produce sanitized, content-free warnings
// ---------------------------------------------------------------------------

test('H-1: deep-nesting processing error yields content-free warning', () => {
  const dir = tempDir();
  const home = path.join(dir, 'claude');
  fs.mkdirSync(home, { recursive: true });
  // Deeply nested tool input: JSON.parse may succeed where fingerprint
  // recursion throws, exercising the record-processing catch path.
  const depth = 30000;
  const nested = '{"a":'.repeat(depth) + '"NESTED-SENTINEL-SECRET"' + '}'.repeat(depth);
  const line = JSON.stringify({
    type: 'assistant', uuid: 'u1', timestamp: '2026-11-10T10:00:00.000Z', cwd: '/p', isSidechain: false,
    message: { id: 'm1', role: 'assistant', model: 'claude-x', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: JSON.parse(nested) }] },
  });
  writeClaudeTranscript(home, '-p', 'deep-sid', [line]);
  withEnv(fullEnv(dir, { CALIPER_CLAUDE_HOME: home }), () => {
    const adapter = new ClaudeAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    const serialized = JSON.stringify(record);
    assert.ok(!serialized.includes('NESTED-SENTINEL-SECRET'));
    // Either parse or processing failed safely; both paths are content-free.
    if (record.partial) {
      for (const w of record.parseWarnings) {
        assert.ok(!w.includes('NESTED-SENTINEL-SECRET'));
      }
    }
  });
  cleanup(dir);
});

test('sanitizeFreeText combines control-stripping, redaction, bounding', () => {
  const out = sanitizeFreeText('hi\u001b[31m sk-abcdefgh12345678 ' + 'z'.repeat(300), 120);
  assert.ok(!out.includes('\u001b'));
  assert.ok(!out.includes('sk-abcdefgh12345678'));
  assert.ok(out.length <= 121);
});
