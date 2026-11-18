import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { CodexAdapter } from '../src/adapters/codex.ts';
import { tempDir, cleanup, writeCodexRollout, codexLine, sessionMetaPayload, withEnv } from './helpers.ts';

function setup() {
  const dir = tempDir();
  const home = path.join(dir, 'codex-home');
  fs.mkdirSync(home, { recursive: true });
  return { dir, home };
}

const SID = '01a1test-0000-0000-0000-000000000001';

function baseLines(sessionId = SID): unknown[] {
  return [
    codexLine('session_meta', sessionMetaPayload(sessionId)),
    codexLine('turn_context', { turn_id: 't1', model: 'gpt-fixture', cwd: '/fixture/project' }, '2026-11-10T10:00:01.000Z'),
  ];
}

test('codex detect: missing home is graceful', () => {
  const { dir } = setup();
  withEnv({ HAVRIN_CODEX_HOME: path.join(dir, 'missing'), CODEX_HOME: undefined }, () => {
    const inst = new CodexAdapter().detect();
    assert.equal(inst.layout, undefined);
    assert.deepEqual(new CodexAdapter().listSessions(inst), []);
  });
  cleanup(dir);
});

test('codex ingest: messages, tool calls with outputs, token usage', () => {
  const { dir, home } = setup();
  const lines = [
    ...baseLines(),
    codexLine('response_item', { type: 'message', role: 'user', id: 'm0', content: [{ type: 'input_text', text: 'fix the bug' }] }, '2026-11-10T10:00:02.000Z'),
    codexLine('response_item', { type: 'custom_tool_call', call_id: 'c1', name: 'exec', input: 'npm test', status: 'completed' }, '2026-11-10T10:00:03.000Z'),
    codexLine('response_item', { type: 'custom_tool_call_output', call_id: 'c1', output: [{ type: 'input_text', text: 'Script completed\nexit_code:0\nall tests passed' }] }, '2026-11-10T10:00:04.000Z'),
    codexLine('response_item', { type: 'custom_tool_call', call_id: 'c2', name: 'exec', input: 'node bad.js', status: 'completed' }, '2026-11-10T10:00:05.000Z'),
    codexLine('response_item', { type: 'custom_tool_call_output', call_id: 'c2', output: '{"exit_code":1,"output":"Error: boom"}' }, '2026-11-10T10:00:06.000Z'),
    codexLine('response_item', { type: 'message', role: 'assistant', id: 'm1', content: [{ type: 'output_text', text: 'done' }] }, '2026-11-10T10:00:07.000Z'),
    codexLine('token_usage_record', { usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 500, reasoning_output_tokens: 5 }, thread_token_usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 500 } }, '2026-11-10T10:00:08.000Z'),
    codexLine('event_msg', { type: 'task_complete' }, '2026-11-10T10:00:09.000Z'),
  ];
  writeCodexRollout(home, SID, lines);
  fs.writeFileSync(path.join(home, 'session_index.jsonl'), JSON.stringify({ id: SID, thread_name: 'Fixture thread' }) + '\n');

  withEnv({ HAVRIN_CODEX_HOME: home, CODEX_HOME: undefined }, () => {
    const adapter = new CodexAdapter();
    const inst = adapter.detect();
    assert.equal(inst.layout, 'jsonl-rollout');
    assert.equal(inst.sessionCount, 1);
    const metas = adapter.listSessions(inst);
    assert.equal(metas[0]?.title, 'Fixture thread');
    const record = adapter.readSession(inst, metas[0]!);
    assert.equal(record.partial, false);
    assert.equal(record.title, 'Fixture thread');
    assert.equal(record.directory, '/fixture/project');
    assert.deepEqual(record.model, { provider: 'openai', model: 'gpt-fixture' });
    const tools = record.events.filter((e) => e.kind === 'tool');
    assert.equal(tools.length, 2);
    if (tools[0]?.kind === 'tool') {
      assert.equal(tools[0].tool.status, 'completed');
      assert.equal(tools[0].tool.commandCategory, 'test');
    }
    if (tools[1]?.kind === 'tool') {
      assert.equal(tools[1].tool.status, 'error');
      assert.equal(tools[1].tool.statusSource, 'heuristic');
    }
    const asst = record.events.find((e) => e.kind === 'assistant');
    assert.ok(asst && asst.kind === 'assistant');
    if (asst?.kind === 'assistant') {
      assert.deepEqual(asst.tokens, { input: 100, output: 20, reasoning: 5, cacheRead: 500, cacheWrite: 0 });
    }
    assert.deepEqual(record.reportedTotals, { input: 100, output: 20, reasoning: 0, cacheRead: 500, cacheWrite: 0 });
  });
  cleanup(dir);
});

test('codex ingest: orphan output with name is recovered with unique fingerprint', () => {
  const { dir, home } = setup();
  const lines = [
    ...baseLines(),
    codexLine('response_item', { type: 'custom_tool_call_output', id: 'o1', call_id: 'missing1', name: 'exec', output: '{"exit_code":1}' }, '2026-11-10T10:00:03.000Z'),
    codexLine('response_item', { type: 'custom_tool_call_output', id: 'o2', call_id: 'missing2', name: 'exec', output: '{"exit_code":1}' }, '2026-11-10T10:00:04.000Z'),
  ];
  writeCodexRollout(home, SID, lines);
  withEnv({ HAVRIN_CODEX_HOME: home, CODEX_HOME: undefined }, () => {
    const adapter = new CodexAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    const tools = record.events.filter((e) => e.kind === 'tool');
    assert.equal(tools.length, 2);
    if (tools[0]?.kind === 'tool' && tools[1]?.kind === 'tool') {
      assert.equal(tools[0].tool.status, 'error');
      assert.notEqual(tools[0].tool.inputFingerprint, tools[1].tool.inputFingerprint);
    }
    assert.equal(record.partial, false);
  });
  cleanup(dir);
});

test('codex ingest: unmatched call (interrupted) gets unknown status', () => {
  const { dir, home } = setup();
  const lines = [
    ...baseLines(),
    codexLine('response_item', { type: 'custom_tool_call', call_id: 'c1', name: 'exec', input: 'sleep 100', status: 'completed' }, '2026-11-10T10:00:03.000Z'),
    codexLine('event_msg', { type: 'turn_aborted' }, '2026-11-10T10:00:04.000Z'),
  ];
  writeCodexRollout(home, SID, lines);
  withEnv({ HAVRIN_CODEX_HOME: home, CODEX_HOME: undefined }, () => {
    const adapter = new CodexAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    const tool = record.events.find((e) => e.kind === 'tool');
    assert.ok(tool && tool.kind === 'tool');
    if (tool?.kind === 'tool') assert.equal(tool.tool.status, 'unknown');
    assert.ok(record.events.some((e) => e.kind === 'turn-aborted'));
  });
  cleanup(dir);
});

test('codex ingest: malformed lines produce partial record', () => {
  const { dir, home } = setup();
  const lines = [
    ...baseLines(),
    '{not json',
    codexLine('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ok' }] }, '2026-11-10T10:00:05.000Z'),
    '42',
  ];
  writeCodexRollout(home, SID, lines);
  withEnv({ HAVRIN_CODEX_HOME: home, CODEX_HOME: undefined }, () => {
    const adapter = new CodexAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    assert.equal(record.partial, true);
    assert.ok(record.parseWarnings.length >= 2);
    assert.ok(record.events.some((e) => e.kind === 'user'));
  });
  cleanup(dir);
});

test('codex: apply_patch target path extraction', () => {
  const { dir, home } = setup();
  const lines = [
    ...baseLines(),
    codexLine('response_item', { type: 'custom_tool_call', call_id: 'c1', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: src/lib.py\n@@\n-old\n+new\n*** End Patch', status: 'completed' }, '2026-11-10T10:00:03.000Z'),
    codexLine('response_item', { type: 'custom_tool_call_output', call_id: 'c1', output: 'Success' }, '2026-11-10T10:00:04.000Z'),
  ];
  writeCodexRollout(home, SID, lines);
  withEnv({ HAVRIN_CODEX_HOME: home, CODEX_HOME: undefined }, () => {
    const adapter = new CodexAdapter();
    const inst = adapter.detect();
    const record = adapter.readSession(inst, adapter.listSessions(inst)[0]!);
    const tool = record.events.find((e) => e.kind === 'tool');
    assert.ok(tool && tool.kind === 'tool');
    if (tool?.kind === 'tool') {
      assert.equal(tool.tool.targetPath, 'src/lib.py');
      assert.equal(tool.tool.status, 'completed');
    }
  });
  cleanup(dir);
});

test('codex: rollout files are never modified', () => {
  const { dir, home } = setup();
  const file = writeCodexRollout(home, SID, baseLines());
  const before = fs.readFileSync(file);
  withEnv({ HAVRIN_CODEX_HOME: home, CODEX_HOME: undefined }, () => {
    const adapter = new CodexAdapter();
    const inst = adapter.detect();
    adapter.readSession(inst, adapter.listSessions(inst)[0]!);
  });
  assert.ok(before.equals(fs.readFileSync(file)));
  cleanup(dir);
});
