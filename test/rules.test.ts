import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionRecord, SessionEvent, ToolCall, EnvironmentInfo } from '../src/core/types.ts';
import { runDiagnostics, RULES } from '../src/diagnostics/rules.ts';
import { fingerprint } from '../src/core/util.ts';

const NOW = 1_800_000_000_000;

function tool(name: string, input: unknown, status: ToolCall['status'] = 'completed', extra: Partial<ToolCall> = {}): ToolCall {
  return { name, status, statusSource: 'reported', inputFingerprint: fingerprint(input), ...extra };
}

function session(id: string, events: SessionEvent[], agent: 'opencode' | 'codex' = 'opencode'): SessionRecord {
  return {
    agent,
    id,
    createdAt: NOW,
    updatedAt: NOW + 60_000,
    events,
    partial: false,
    parseWarnings: [],
    source: { kind: 'sqlite', location: 'fixture', signature: 'sig' },
  };
}

function assistant(at: number, tools: ToolCall[], extra: Partial<Extract<SessionEvent, { kind: 'assistant' }>> = {}): SessionEvent {
  return { kind: 'assistant', at, id: `a${at}`, tools, textChars: 10, reasoningChars: 0, ...extra };
}

function emptyEnv(): EnvironmentInfo {
  return { agents: [], mcpServers: [], skills: [], instructionFiles: [], secretExposures: [], warnings: [] };
}

function findingsFor(ruleId: string, sessions: SessionRecord[], env: EnvironmentInfo = emptyEnv()) {
  return runDiagnostics({ sessions, environment: env }).filter((f) => f.ruleId === ruleId);
}

test('rule registry covers the eight v0.1 rules', () => {
  assert.deepEqual(
    RULES.map((r) => r.id).sort(),
    [
      'context-compaction-pressure',
      'missing-test-verification',
      'plaintext-config-secrets',
      'redundant-file-reads',
      'repeated-tool-failures',
      'retry-loops',
      'skill-name-collisions',
      'unused-mcp-servers',
    ],
  );
});

test('repeated-tool-failures: identical failing input twice fires; different inputs do not', () => {
  const input = { path: '/a.ts', oldString: 'x', newString: 'y' };
  const err = { errorType: 'tool.execution', errorMessage: 'Could not find oldString' };
  const s = session('s1', [
    assistant(NOW, [tool('edit', input, 'error', err)]),
    assistant(NOW + 1, [tool('edit', input, 'error', err)]),
  ]);
  const f = findingsFor('repeated-tool-failures', [s]);
  assert.equal(f.length, 1);
  assert.equal(f[0]?.confidence, 'high');
  assert.equal(f[0]?.severity, 'medium');

  const different = session('s2', [
    assistant(NOW, [tool('edit', { ...input, oldString: 'x1' }, 'error', err)]),
    assistant(NOW + 1, [tool('edit', { ...input, oldString: 'x2' }, 'error', err)]),
  ]);
  assert.equal(findingsFor('repeated-tool-failures', [different]).length, 0);
});

test('repeated-tool-failures: five identical failures escalate to high severity', () => {
  const input = { command: 'false' };
  const events = Array.from({ length: 5 }, (_, i) =>
    assistant(NOW + i, [tool('shell', input, 'error', { errorMessage: 'exit 1' })]),
  );
  const f = findingsFor('repeated-tool-failures', [session('s', events)]);
  assert.equal(f[0]?.severity, 'high');
});

test('repeated-tool-failures: heuristic-only errors cap confidence at medium', () => {
  const input = 'node x.js';
  const events = Array.from({ length: 3 }, (_, i) =>
    assistant(NOW + i, [tool('exec', input, 'error', { statusSource: 'heuristic', errorMessage: 'exit_code:1' })]),
  );
  const f = findingsFor('repeated-tool-failures', [session('s', events, 'codex')]);
  assert.equal(f[0]?.confidence, 'medium');
});

test('retry-loops: three consecutive identical non-read calls fire', () => {
  const input = { command: 'curl https://x' };
  const events = Array.from({ length: 3 }, (_, i) => assistant(NOW + i, [tool('shell', input)]));
  assert.equal(findingsFor('retry-loops', [session('s', events)]).length, 1);
});

test('retry-loops: consecutive identical reads are NOT retry loops (covered by re-read rule)', () => {
  const input = { path: '/a.ts' };
  const events = Array.from({ length: 4 }, (_, i) =>
    assistant(NOW + i, [tool('read', input, 'completed', { targetPath: '/a.ts' })]),
  );
  assert.equal(findingsFor('retry-loops', [session('s', events)]).length, 0);
});

test('retry-loops: consecutive assistant errors fire', () => {
  const events = [
    assistant(NOW, [], { error: { type: 'api', message: 'rate limited' } }),
    assistant(NOW + 1, [], { error: { type: 'api', message: 'rate limited' } }),
    assistant(NOW + 2, []),
  ];
  assert.equal(findingsFor('retry-loops', [session('s', events)]).length, 1);
});

test('redundant-file-reads: 3 reads of unchanged file fire; write between resets', () => {
  const read = tool('read', { path: '/a.ts' }, 'completed', { targetPath: '/a.ts' });
  const s = session('s1', [assistant(NOW, [read]), assistant(NOW + 1, [read]), assistant(NOW + 2, [read])]);
  const f = findingsFor('redundant-file-reads', [s]);
  assert.equal(f.length, 1);
  assert.equal(f[0]?.evidence[0]?.value, 2);

  const write = tool('edit', { path: '/a.ts' }, 'completed', { targetPath: '/a.ts' });
  const s2 = session('s2', [
    assistant(NOW, [read]),
    assistant(NOW + 1, [write]),
    assistant(NOW + 2, [read]),
    assistant(NOW + 3, [read]),
  ]);
  // segment1: 1 read, segment2: 2 reads → 1 redundant < 2 threshold
  assert.equal(findingsFor('redundant-file-reads', [s2]).length, 0);
});

test('missing-test-verification: writes without tests fire; tests present suppress', () => {
  const writes = [
    tool('edit', { path: '/a' }, 'completed', { targetPath: '/a' }),
    tool('edit', { path: '/b' }, 'completed', { targetPath: '/b' }),
    tool('write', { path: '/c' }, 'completed', { targetPath: '/c' }),
  ];
  const events = [
    { kind: 'user', at: NOW, id: 'u', textChars: 5, fileCount: 0 } as SessionEvent,
    assistant(NOW + 1, writes),
    assistant(NOW + 2, [tool('shell', { command: 'npm run build' }, 'completed', { commandCategory: 'build' })]),
    assistant(NOW + 3, []),
  ];
  const f = findingsFor('missing-test-verification', [session('s', events)]);
  assert.equal(f.length, 1);
  assert.equal(f[0]?.confidence, 'medium');

  const withTest = [...events, assistant(NOW + 4, [tool('shell', { command: 'npm test' }, 'completed', { commandCategory: 'test' })])];
  assert.equal(findingsFor('missing-test-verification', [session('s2', withTest)]).length, 0);
});

test('missing-test-verification: tiny sessions are ignored', () => {
  const events = [assistant(NOW, [tool('write', { path: '/a' }, 'completed', { targetPath: '/a' })])];
  assert.equal(findingsFor('missing-test-verification', [session('s', events)]).length, 0);
});

test('context-compaction-pressure: two compactions fire, one does not', () => {
  const one = session('s1', [{ kind: 'compaction', at: NOW }]);
  assert.equal(findingsFor('context-compaction-pressure', [one]).length, 0);
  const two = session('s2', [{ kind: 'compaction', at: NOW }, { kind: 'compaction', at: NOW + 1 }]);
  assert.equal(findingsFor('context-compaction-pressure', [two]).length, 1);
});

test('unused-mcp-servers: prefix matching recognizes used servers', () => {
  const env = emptyEnv();
  env.mcpServers = [{ agent: 'opencode', configPath: '/cfg', names: ['playwright', 'unused'] }];
  const s = session('s', [
    assistant(NOW, [tool('playwright_browser_navigate', { url: 'https://x' })]),
  ]);
  const f = findingsFor('unused-mcp-servers', [s], env);
  assert.equal(f.length, 1);
  assert.ok(f[0]?.title.includes('unused'));
  assert.ok(!f[0]?.title.includes('playwright'));
});

test('unused-mcp-servers: no tool calls means no claim', () => {
  const env = emptyEnv();
  env.mcpServers = [{ agent: 'opencode', configPath: '/cfg', names: ['x'] }];
  assert.equal(findingsFor('unused-mcp-servers', [session('s', [])], env).length, 0);
});

test('skill-name-collisions: duplicate ids across dirs fire', () => {
  const env = emptyEnv();
  env.skills = [
    { agent: 'opencode', dir: '/a', ids: ['deploy', 'review'] },
    { agent: 'shared', dir: '/b', ids: ['deploy'] },
  ];
  const f = findingsFor('skill-name-collisions', [], env);
  assert.equal(f.length, 1);
  assert.ok(f[0]?.title.includes('deploy'));
  assert.ok(!f[0]?.title.includes('review'));
});

test('plaintext-config-secrets: exposures produce one high finding', () => {
  const env = emptyEnv();
  env.secretExposures = [{ configPath: '/cfg', keyPath: 'provider.x.options.apiKey' }];
  const f = findingsFor('plaintext-config-secrets', [], env);
  assert.equal(f.length, 1);
  assert.equal(f[0]?.severity, 'high');
});

test('findings are sorted by severity and capped per rule', () => {
  const input = { command: 'x' };
  const sessions = Array.from({ length: 12 }, (_, i) =>
    session(`s${i}`, [
      assistant(NOW, [tool('shell', input, 'error', { errorMessage: 'e' })]),
      assistant(NOW + 1, [tool('shell', input, 'error', { errorMessage: 'e' })]),
    ]),
  );
  const all = runDiagnostics({ sessions, environment: emptyEnv() });
  const repeated = all.filter((f) => f.ruleId === 'repeated-tool-failures');
  assert.ok(repeated.length <= 5);
  const ranks = all.map((f) => ({ high: 3, medium: 2, low: 1, info: 0 })[f.severity]);
  for (let i = 1; i < ranks.length; i++) assert.ok((ranks[i] ?? 0) <= (ranks[i - 1] ?? 0));
});
