import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { ClaudeAdapter, claudeProjectsDir } from '../src/adapters/claude.ts';
import { sessionTokens } from '../src/core/session.ts';
import {
  tempDir,
  cleanup,
  withEnv,
  writeClaudeTranscript,
  ccBase,
  ccUserText,
  ccAssistant,
  ccToolUse,
  ccToolResult,
  ccCompactBoundary,
  ccCostState,
} from './helpers.ts';

const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function setup() {
  const dir = tempDir();
  const home = path.join(dir, 'claude-home');
  fs.mkdirSync(home, { recursive: true });
  return { dir, home };
}

function envFor(home: string): Record<string, string | undefined> {
  return { HAVRIN_CLAUDE_HOME: home, CLAUDE_CONFIG_DIR: undefined };
}

function ingest(home: string) {
  const adapter = new ClaudeAdapter();
  const inst = adapter.detect();
  const metas = adapter.listSessions(inst);
  return { adapter, inst, metas, record: metas[0] ? adapter.readSession(inst, metas[0]) : undefined };
}

test('claude detect: missing home is graceful', () => {
  const { dir } = setup();
  withEnv(envFor(path.join(dir, 'missing')), () => {
    const inst = new ClaudeAdapter().detect();
    assert.equal(inst.agent, 'claude');
    assert.equal(inst.layout, undefined);
    assert.deepEqual(new ClaudeAdapter().listSessions(inst), []);
  });
  cleanup(dir);
});

test('claude detect: home without projects reports issue', () => {
  const { dir, home } = setup();
  withEnv(envFor(home), () => {
    const inst = new ClaudeAdapter().detect();
    assert.equal(inst.layout, 'no-sessions');
    assert.ok(inst.issues.some((i) => i.includes('projects')));
  });
  cleanup(dir);
});

test('claude ingest: user turns, tools, reported errors, usage categories', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-fixture-project', SID, [
    ccUserText('please fix the bug', '2026-11-10T10:00:00.000Z'),
    ccAssistant({
      messageId: 'msg_1',
      at: '2026-11-10T10:00:01.000Z',
      blocks: [
        { type: 'thinking', thinking: 'let me think' },
        ccToolUse('tu_1', 'Bash', { command: 'npm test', description: 'run tests' }),
        ccToolUse('tu_2', 'Read', { file_path: '/fixture/project/a.ts' }),
        ccToolUse('tu_3', 'Edit', { file_path: '/fixture/project/a.ts', old_string: 'x', new_string: 'y' }),
      ],
    }),
    ccToolResult({ toolUseId: 'tu_1', toolUseResult: { stdout: 'all passed', interrupted: false }, at: '2026-11-10T10:00:02.000Z' }),
    ccToolResult({ toolUseId: 'tu_2', at: '2026-11-10T10:00:03.000Z' }),
    ccToolResult({ toolUseId: 'tu_3', isError: true, content: 'String not found', at: '2026-11-10T10:00:04.000Z' }),
    ccAssistant({ messageId: 'msg_2', at: '2026-11-10T10:00:05.000Z', blocks: [{ type: 'text', text: 'done' }] }),
    { type: 'ai-title', sessionId: SID, aiTitle: 'Fix the bug' },
    ccCostState({ costUSD: 0.42 }),
  ]);
  withEnv(envFor(home), () => {
    const { inst, metas, record } = ingest(home);
    assert.equal(inst.layout, 'jsonl-projects');
    assert.equal(inst.sessionCount, 1);
    assert.equal(metas[0]?.id, SID);
    assert.ok(record);
    assert.equal(record?.partial, false);
    assert.equal(record?.title, 'Fix the bug');
    assert.equal(record?.directory, '/fixture/project');
    assert.equal(record?.source.version, '2.1.327');
    assert.deepEqual(record?.model, { provider: 'anthropic', model: 'claude-fixture-5' });
    const users = record?.events.filter((e) => e.kind === 'user') ?? [];
    assert.equal(users.length, 1); // tool_result user records are NOT user turns
    const assts = record?.events.filter((e) => e.kind === 'assistant') ?? [];
    assert.equal(assts.length, 2);
    const first = assts[0];
    assert.ok(first && first.kind === 'assistant');
    if (first?.kind === 'assistant') {
      assert.equal(first.tools.length, 3);
      assert.equal(first.tools[0]?.name, 'Bash');
      assert.equal(first.tools[0]?.commandCategory, 'test');
      assert.equal(first.tools[0]?.status, 'completed');
      assert.equal(first.tools[1]?.targetPath, '/fixture/project/a.ts');
      assert.equal(first.tools[2]?.status, 'error');
      assert.equal(first.tools[2]?.errorType, 'tool_result.is_error');
      assert.equal(first.tools[2]?.statusSource, 'reported');
      assert.deepEqual(first.tokens, { input: 10, output: 50, reasoning: 20, cacheRead: 1000, cacheWrite: 100 });
      assert.ok(first.reasoningChars > 0);
    }
    assert.deepEqual(record?.reportedTotals, { input: 100, output: 500, reasoning: 200, cacheRead: 10000, cacheWrite: 1000 });
    assert.equal(record?.reportedCost, 0.42);
  });
  cleanup(dir);
});

test('claude ingest: split assistant records merge and count usage exactly once', () => {
  const { dir, home } = setup();
  const usage = { input_tokens: 7, output_tokens: 421, cache_read_input_tokens: 24307, cache_creation_input_tokens: 5, output_tokens_details: { thinking_tokens: 100 } };
  writeClaudeTranscript(home, '-fixture-project', SID, [
    ccUserText('go'),
    ccAssistant({ messageId: 'msg_split', blocks: [{ type: 'thinking', thinking: 'hmm' }], usage, apiBlockIndex: 0, at: '2026-11-10T10:00:01.000Z' }),
    ccAssistant({ messageId: 'msg_split', blocks: [ccToolUse('tu_a', 'Bash', { command: 'ls' })], usage, apiBlockIndex: 1, at: '2026-11-10T10:00:01.100Z' }),
    ccAssistant({ messageId: 'msg_split', blocks: [ccToolUse('tu_b', 'Read', { file_path: '/x.ts' })], usage, apiBlockIndex: 2, at: '2026-11-10T10:00:01.200Z' }),
    ccToolResult({ toolUseId: 'tu_a', at: '2026-11-10T10:00:02.000Z' }),
    ccToolResult({ toolUseId: 'tu_b', at: '2026-11-10T10:00:03.000Z' }),
  ]);
  withEnv(envFor(home), () => {
    const { record } = ingest(home);
    const assts = record?.events.filter((e) => e.kind === 'assistant') ?? [];
    assert.equal(assts.length, 1, 'split records must merge into one turn');
    const a = assts[0];
    assert.ok(a && a.kind === 'assistant');
    if (a?.kind === 'assistant') {
      assert.equal(a.tools.length, 2, 'tools from all split records merge');
      assert.deepEqual(a.tokens, { input: 7, output: 421, reasoning: 100, cacheRead: 24307, cacheWrite: 5 });
    }
    const totals = record ? sessionTokens(record) : undefined;
    assert.equal(totals?.output, 421, 'usage counted once, not 3×');
    assert.equal(totals?.cacheRead, 24307);
  });
  cleanup(dir);
});

test('claude ingest: distinct message ids are separate turns with separate usage', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-fixture-project', SID, [
    ccAssistant({ messageId: 'msg_a', blocks: [{ type: 'text', text: 'one' }], at: '2026-11-10T10:00:01.000Z' }),
    ccAssistant({ messageId: 'msg_b', blocks: [{ type: 'text', text: 'two' }], at: '2026-11-10T10:00:02.000Z' }),
  ]);
  withEnv(envFor(home), () => {
    const { record } = ingest(home);
    assert.equal(record?.events.filter((e) => e.kind === 'assistant').length, 2);
    assert.equal(record ? sessionTokens(record).output : 0, 100); // 50 + 50
  });
  cleanup(dir);
});

test('claude ingest: interrupted tool calls are unknown, not errors', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-fixture-project', SID, [
    ccAssistant({ messageId: 'msg_1', blocks: [ccToolUse('tu_1', 'Bash', { command: 'sleep 100' })] }),
    ccToolResult({ toolUseId: 'tu_1', toolUseResult: { interrupted: true, stdout: '' } }),
  ]);
  withEnv(envFor(home), () => {
    const { record } = ingest(home);
    const a = record?.events.find((e) => e.kind === 'assistant');
    assert.ok(a && a.kind === 'assistant');
    if (a?.kind === 'assistant') {
      assert.equal(a.tools[0]?.status, 'unknown');
      assert.equal(a.tools[0]?.errorType, 'interrupted');
    }
  });
  cleanup(dir);
});

test('claude ingest: unresolved tool calls (interrupted session) are unknown', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-fixture-project', SID, [
    ccAssistant({ messageId: 'msg_1', blocks: [ccToolUse('tu_orphan', 'Bash', { command: 'make build' })] }),
  ]);
  withEnv(envFor(home), () => {
    const { record } = ingest(home);
    const a = record?.events.find((e) => e.kind === 'assistant');
    assert.ok(a && a.kind === 'assistant');
    if (a?.kind === 'assistant') assert.equal(a.tools[0]?.status, 'unknown');
    assert.equal(record?.partial, false);
  });
  cleanup(dir);
});

test('claude ingest: compaction boundary and legacy summary markers', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-fixture-project', SID, [
    ccCompactBoundary('2026-11-10T10:01:00.000Z', 'auto'),
    ccCompactBoundary('2026-11-10T10:02:00.000Z', 'manual'),
    { type: 'summary', summary: 'old summary text', leafUuid: 'x', timestamp: '2026-11-10T10:03:00.000Z' },
  ]);
  withEnv(envFor(home), () => {
    const { record } = ingest(home);
    const comps = record?.events.filter((e) => e.kind === 'compaction') ?? [];
    assert.equal(comps.length, 3);
    assert.equal(comps[0]?.kind === 'compaction' ? comps[0].reason : undefined, 'auto');
    assert.equal(comps[1]?.kind === 'compaction' ? comps[1].reason : undefined, 'manual');
  });
  cleanup(dir);
});

test('claude ingest: cost-state with unknown model cost suppresses dollar figure', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-fixture-project', SID, [
    ccUserText('x'),
    ccCostState({ costUSD: 9.99, hasUnknownModelCost: true }),
  ]);
  withEnv(envFor(home), () => {
    const { record } = ingest(home);
    assert.equal(record?.reportedCost, undefined);
    assert.ok(record?.reportedTotals, 'token totals still available');
  });
  cleanup(dir);
});

test('claude ingest: last cost-state wins', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-fixture-project', SID, [
    ccCostState({ costUSD: 1.0 }),
    ccCostState({ costUSD: 2.5 }),
  ]);
  withEnv(envFor(home), () => {
    const { record } = ingest(home);
    assert.equal(record?.reportedCost, 2.5);
  });
  cleanup(dir);
});

test('claude ingest: sidechain activity produces subagentStats, not user turns', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-fixture-project', SID, [
    ccUserText('main prompt'),
    ccAssistant({ messageId: 'msg_main', blocks: [ccToolUse('tu_agent', 'Agent', { prompt: 'do research', subagent_type: 'explore' })] }),
    ccToolResult({ toolUseId: 'tu_agent', toolUseResult: { agentType: 'explore', totalTokens: 5000 } }),
    ccUserText('subagent prompt', '2026-11-10T10:00:05.000Z', { isSidechain: true }),
    ccAssistant({ messageId: 'msg_side', sidechain: true, at: '2026-11-10T10:00:06.000Z', blocks: [ccToolUse('tu_s1', 'Bash', { command: 'grep -r foo' }), ccToolUse('tu_s2', 'Read', { file_path: '/y.ts' })] }),
    ccToolResult({ toolUseId: 'tu_s1', sidechain: true, at: '2026-11-10T10:00:07.000Z' }),
    ccToolResult({ toolUseId: 'tu_s2', isError: true, sidechain: true, at: '2026-11-10T10:00:08.000Z' }),
  ]);
  withEnv(envFor(home), () => {
    const { record } = ingest(home);
    assert.deepEqual(record?.subagentStats, { turns: 1, toolCalls: 2, toolErrors: 1 });
    assert.equal(record?.events.filter((e) => e.kind === 'user').length, 1);
  });
  cleanup(dir);
});

test('claude ingest: no sidechain data means undefined subagentStats (not zero)', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-fixture-project', SID, [ccUserText('x')]);
  withEnv(envFor(home), () => {
    const { record } = ingest(home);
    assert.equal(record?.subagentStats, undefined);
  });
  cleanup(dir);
});

test('claude ingest: synthetic error messages become assistant errors', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-fixture-project', SID, [
    ccAssistant({ messageId: 'msg_syn', model: '<synthetic>', blocks: [{ type: 'text', text: 'API Error: 529' }], usage: { input_tokens: 0, output_tokens: 0 } }),
  ]);
  withEnv(envFor(home), () => {
    const { record } = ingest(home);
    const a = record?.events.find((e) => e.kind === 'assistant');
    assert.ok(a && a.kind === 'assistant');
    if (a?.kind === 'assistant') {
      assert.deepEqual(a.error, { type: 'synthetic' });
      assert.equal(a.textChars, 0);
    }
    assert.equal(record?.model, undefined, 'synthetic model is not a real model');
  });
  cleanup(dir);
});

test('claude ingest: model changes emit model-switch events', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-fixture-project', SID, [
    ccAssistant({ messageId: 'm1', model: 'claude-opus-5-5', blocks: [{ type: 'text', text: 'a' }], at: '2026-11-10T10:00:01.000Z' }),
    ccAssistant({ messageId: 'm2', model: 'claude-haiku-5-5', blocks: [{ type: 'text', text: 'b' }], at: '2026-11-10T10:00:02.000Z' }),
  ]);
  withEnv(envFor(home), () => {
    const { record } = ingest(home);
    const switches = record?.events.filter((e) => e.kind === 'model-switch') ?? [];
    assert.equal(switches.length, 1);
    const sw = switches[0];
    assert.ok(sw && sw.kind === 'model-switch');
    if (sw?.kind === 'model-switch') {
      assert.equal(sw.from?.model, 'claude-opus-5-5');
      assert.equal(sw.to?.model, 'claude-haiku-5-5');
    }
    assert.equal(record?.model?.model, 'claude-haiku-5-5');
  });
  cleanup(dir);
});

test('claude ingest: malformed, truncated, and empty transcripts are safe', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-fixture-project', SID, [
    '{broken json',
    '42',
    ccBase('assistant'), // assistant without message
    ccUserText('valid turn', '2026-11-10T10:00:05.000Z'),
    '{"type":"user","message":{"role":"user","content":"truncated', // partial last line
  ]);
  writeClaudeTranscript(home, '-fixture-project', 'empty-session-id', []);
  withEnv(envFor(home), () => {
    const adapter = new ClaudeAdapter();
    const inst = adapter.detect();
    const metas = adapter.listSessions(inst);
    assert.equal(metas.length, 2);
    const bad = adapter.readSession(inst, metas.find((m) => m.id === SID)!);
    assert.equal(bad.partial, true);
    assert.ok(bad.parseWarnings.length >= 3);
    assert.ok(bad.events.some((e) => e.kind === 'user'), 'valid records still parse');
    const empty = adapter.readSession(inst, metas.find((m) => m.id === 'empty-session-id')!);
    assert.equal(empty.events.length, 0);
    assert.equal(empty.partial, false);
  });
  cleanup(dir);
});

test('claude: duplicate session ids across files keep the newest', () => {
  const { dir, home } = setup();
  const f1 = writeClaudeTranscript(home, '-project-a', SID, [ccUserText('old copy')]);
  const f2 = writeClaudeTranscript(home, '-project-b', SID, [ccUserText('new copy'), ccUserText('second')]);
  const past = new Date(Date.now() - 86_400_000);
  fs.utimesSync(f1, past, past);
  withEnv(envFor(home), () => {
    const adapter = new ClaudeAdapter();
    const inst = adapter.detect();
    const metas = adapter.listSessions(inst);
    assert.equal(metas.length, 1);
    const record = adapter.readSession(inst, metas[0]!);
    assert.equal(record.events.filter((e) => e.kind === 'user').length, 2);
    assert.equal(record.source.location, f2);
  });
  cleanup(dir);
});

test('claude: multiple projects discovered with cwd attribution', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-home-user-proj1', 'sid-1', [ccUserText('a')]);
  writeClaudeTranscript(home, '-home-user-proj2', 'sid-2', [ccBase('user', '2026-11-10T10:00:00.000Z', { cwd: '/home/user/proj2', message: { role: 'user', content: 'b' } })]);
  withEnv(envFor(home), () => {
    const adapter = new ClaudeAdapter();
    const inst = adapter.detect();
    assert.equal(inst.sessionCount, 2);
    const metas = adapter.listSessions(inst);
    assert.equal(metas.length, 2);
    const m2 = metas.find((m) => m.id === 'sid-2');
    assert.equal(m2?.directory, '/home/user/proj2');
  });
  cleanup(dir);
});

test('claude: oversized transcript is skipped with a warning, not parsed', () => {
  const { dir, home } = setup();
  const file = writeClaudeTranscript(home, '-fixture-project', SID, [ccUserText('x')]);
  fs.truncateSync(file, 128 * 1024 * 1024 + 1); // sparse file, no real I/O
  withEnv(envFor(home), () => {
    const { record } = ingest(home);
    assert.equal(record?.partial, true);
    assert.ok(record?.parseWarnings.some((w) => w.includes('exceeds')));
    assert.equal(record?.events.length, 0);
  });
  cleanup(dir);
});

test('claude: unreadable project directory is skipped gracefully', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-readable', 'sid-ok', [ccUserText('a')]);
  const locked = path.join(home, 'projects', '-locked');
  fs.mkdirSync(locked, { recursive: true });
  fs.chmodSync(locked, 0o000);
  try {
    withEnv(envFor(home), () => {
      const adapter = new ClaudeAdapter();
      const inst = adapter.detect();
      const metas = adapter.listSessions(inst);
      assert.ok(metas.some((m) => m.id === 'sid-ok'));
    });
  } finally {
    fs.chmodSync(locked, 0o755);
    cleanup(dir);
  }
});

test('claude: transcript files are never modified', () => {
  const { dir, home } = setup();
  const file = writeClaudeTranscript(home, '-fixture-project', SID, [
    ccUserText('x'),
    ccAssistant({ messageId: 'm1', blocks: [ccToolUse('t1', 'Bash', { command: 'ls' })] }),
    ccToolResult({ toolUseId: 't1' }),
    ccCostState({}),
  ]);
  const before = fs.readFileSync(file);
  withEnv(envFor(home), () => {
    ingest(home);
  });
  assert.ok(before.equals(fs.readFileSync(file)));
  cleanup(dir);
});

test('claude: meta user records and command output are not user turns', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-fixture-project', SID, [
    ccUserText('real prompt'),
    ccUserText('<local-command-stdout>output</local-command-stdout>', '2026-11-10T10:00:01.000Z', { isMeta: true }),
    ccBase('user', '2026-11-10T10:00:02.000Z', { message: { role: 'user', content: 'tool-ish' }, toolUseResult: { stdout: 'x' } }),
  ]);
  withEnv(envFor(home), () => {
    const { record } = ingest(home);
    assert.equal(record?.events.filter((e) => e.kind === 'user').length, 1);
  });
  cleanup(dir);
});

test('claude: usage absent stays undefined per turn (unavailable ≠ zero)', () => {
  const { dir, home } = setup();
  const rec = ccAssistant({ messageId: 'm1', blocks: [{ type: 'text', text: 'hi' }] });
  delete (rec['message'] as Record<string, unknown>)['usage'];
  writeClaudeTranscript(home, '-fixture-project', SID, [rec]);
  withEnv(envFor(home), () => {
    const { record } = ingest(home);
    const a = record?.events.find((e) => e.kind === 'assistant');
    assert.ok(a && a.kind === 'assistant');
    if (a?.kind === 'assistant') assert.equal(a.tokens, undefined);
  });
  cleanup(dir);
});

test('claude: projects dir override resolves layout path', () => {
  const { dir, home } = setup();
  writeClaudeTranscript(home, '-p', SID, [ccUserText('x')]);
  withEnv(envFor(home), () => {
    assert.equal(claudeProjectsDir(), path.join(home, 'projects'));
  });
  cleanup(dir);
});
