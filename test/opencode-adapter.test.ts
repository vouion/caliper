import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { OpenCodeAdapter, opencodeDbPath } from '../src/adapters/opencode.ts';
import {
  tempDir,
  cleanup,
  createOpencodeFixture,
  insertFixtureSession,
  insertFixtureMessage,
  assistantData,
  toolPart,
  withEnv,
} from './helpers.ts';

const NOW = 1_800_000_000_000;

function setup() {
  const dir = tempDir();
  const dataDir = path.join(dir, 'opencode-data');
  const db = createOpencodeFixture(dataDir);
  return { dir, dataDir, db };
}

test('opencode detect: no data dir means no layout, no crash', () => {
  const { dir, db } = setup();
  db.close();
  cleanup(path.join(dir, 'opencode-data'));
  withEnv({ HAVRIN_OPENCODE_DATA_DIR: path.join(dir, 'missing') }, () => {
    const inst = new OpenCodeAdapter().detect();
    assert.equal(inst.agent, 'opencode');
    assert.equal(inst.layout, undefined);
    assert.equal(inst.sessionCount, undefined);
  });
  cleanup(dir);
});

test('opencode detect: legacy json storage is reported as unsupported', () => {
  const { dir, db } = setup();
  db.close();
  fs.rmSync(path.join(dir, 'opencode-data', 'opencode.db'));
  fs.mkdirSync(path.join(dir, 'opencode-data', 'storage', 'session'), { recursive: true });
  withEnv({ HAVRIN_OPENCODE_DATA_DIR: path.join(dir, 'opencode-data') }, () => {
    const inst = new OpenCodeAdapter().detect();
    assert.equal(inst.layout, 'legacy-json');
    assert.ok(inst.issues.some((i) => i.includes('Legacy')));
    assert.deepEqual(new OpenCodeAdapter().listSessions(inst), []);
  });
  cleanup(dir);
});

test('opencode ingest: full session with tools, tokens, errors, compaction', () => {
  const { dir, dataDir, db } = setup();
  insertFixtureSession(db, {
    id: 'ses_test1',
    title: 'Fixture session',
    createdAt: NOW,
    updatedAt: NOW + 60_000,
    cost: 0.25,
    tokens: { input: 100, output: 50, cacheRead: 500 },
    model: { id: 'm1', providerID: 'p1', variant: 'high' },
    agent: 'build',
  });
  insertFixtureMessage(db, 'ses_test1', 'user', { time: { created: NOW }, text: 'hello world', files: [], agents: [] }, NOW);
  insertFixtureMessage(
    db,
    'ses_test1',
    'assistant',
    assistantData({
      at: NOW + 1000,
      text: 'response text',
      tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 100, write: 10 } },
      cost: 0.01,
      tools: [
        toolPart({ name: 'read', input: { path: '/a.ts' }, at: NOW + 1000 }),
        toolPart({
          name: 'edit',
          input: { path: '/a.ts', oldString: 'x', newString: 'y' },
          status: 'error',
          error: { type: 'tool.execution', message: 'Could not find oldString in /a.ts' },
          at: NOW + 2000,
        }),
        toolPart({ name: 'shell', input: { command: 'npm test' }, at: NOW + 3000 }),
      ],
    }),
    NOW + 1000,
  );
  insertFixtureMessage(db, 'ses_test1', 'compaction', { time: { created: NOW + 4000 }, reason: 'auto', tokens: { input: 5, output: 500 } }, NOW + 4000);
  insertFixtureMessage(db, 'ses_test1', 'model-switched', { time: { created: NOW + 5000 }, previous: { id: 'm0', providerID: 'p1' }, model: { id: 'm1', providerID: 'p1' } }, NOW + 5000);
  db.close();

  withEnv({ HAVRIN_OPENCODE_DATA_DIR: dataDir, PATH: '' }, () => {
    const adapter = new OpenCodeAdapter();
    const inst = adapter.detect();
    assert.equal(inst.layout, 'sqlite-v2');
    assert.equal(inst.sessionCount, 1);
    const metas = adapter.listSessions(inst);
    assert.equal(metas.length, 1);
    assert.equal(metas[0]?.id, 'ses_test1');
    const record = adapter.readSession(inst, metas[0]!);
    assert.equal(record.agent, 'opencode');
    assert.equal(record.title, 'Fixture session');
    assert.deepEqual(record.model, { provider: 'p1', model: 'm1', variant: 'high' });
    assert.equal(record.partial, false);
    assert.equal(record.events.length, 4); // user, assistant, compaction, model-switch
    const asst = record.events[1];
    assert.equal(asst?.kind, 'assistant');
    if (asst?.kind === 'assistant') {
      assert.equal(asst.tools.length, 3);
      assert.equal(asst.tools[1]?.status, 'error');
      assert.equal(asst.tools[1]?.errorType, 'tool.execution');
      assert.ok(asst.tools[1]?.errorMessage?.includes('Could not find oldString'));
      assert.equal(asst.tools[0]?.targetPath, '/a.ts');
      assert.equal(asst.tools[2]?.commandCategory, 'test');
      assert.deepEqual(asst.tokens, { input: 10, output: 20, reasoning: 5, cacheRead: 100, cacheWrite: 10 });
      assert.equal(asst.cost, 0.01);
    }
    assert.equal(record.events[2]?.kind, 'compaction');
    assert.equal(record.events[3]?.kind, 'model-switch');
    assert.deepEqual(record.reportedTotals, { input: 100, output: 50, reasoning: 0, cacheRead: 500, cacheWrite: 0 });
    assert.equal(record.source.location, opencodeDbPath());
  });
  cleanup(dir);
});

test('opencode ingest: malformed message rows produce partial record, not crash', () => {
  const { dir, dataDir, db } = setup();
  insertFixtureSession(db, { id: 'ses_bad', createdAt: NOW, updatedAt: NOW + 1 });
  insertFixtureMessage(db, 'ses_bad', 'assistant', '{invalid json', NOW);
  insertFixtureMessage(db, 'ses_bad', 'assistant', '[1,2,3]', NOW + 1);
  insertFixtureMessage(db, 'ses_bad', 'assistant', assistantData({ at: NOW + 2, tools: [{ type: 'tool' }] }), NOW + 2);
  insertFixtureMessage(db, 'ses_bad', 'user', { time: { created: NOW + 3 }, text: 'ok' }, NOW + 3);
  db.close();
  withEnv({ HAVRIN_OPENCODE_DATA_DIR: dataDir, PATH: '' }, () => {
    const adapter = new OpenCodeAdapter();
    const inst = adapter.detect();
    const metas = adapter.listSessions(inst);
    const record = adapter.readSession(inst, metas[0]!);
    assert.equal(record.partial, true);
    assert.ok(record.parseWarnings.length >= 2);
    // The valid user message still parses.
    assert.ok(record.events.some((e) => e.kind === 'user'));
  });
  cleanup(dir);
});

test('opencode: archived sessions are excluded; windowing uses updatedAt', () => {
  const { dir, dataDir, db } = setup();
  insertFixtureSession(db, { id: 'ses_active', createdAt: NOW, updatedAt: NOW + 10 });
  insertFixtureSession(db, { id: 'ses_archived', createdAt: NOW, updatedAt: NOW + 20, archived: true });
  db.close();
  withEnv({ HAVRIN_OPENCODE_DATA_DIR: dataDir, PATH: '' }, () => {
    const adapter = new OpenCodeAdapter();
    const inst = adapter.detect();
    assert.equal(inst.sessionCount, 1);
    const metas = adapter.listSessions(inst);
    assert.deepEqual(metas.map((m) => m.id), ['ses_active']);
  });
  cleanup(dir);
});

test('opencode: source database is never modified by ingestion', () => {
  const { dir, dataDir, db } = setup();
  insertFixtureSession(db, { id: 'ses_ro', createdAt: NOW, updatedAt: NOW });
  insertFixtureMessage(db, 'ses_ro', 'user', { time: { created: NOW }, text: 'x' }, NOW);
  db.close();
  const dbPath = path.join(dataDir, 'opencode.db');
  const before = fs.readFileSync(dbPath);
  withEnv({ HAVRIN_OPENCODE_DATA_DIR: dataDir, PATH: '' }, () => {
    const adapter = new OpenCodeAdapter();
    const inst = adapter.detect();
    const metas = adapter.listSessions(inst);
    adapter.readSession(inst, metas[0]!);
  });
  const after = fs.readFileSync(dbPath);
  assert.ok(before.equals(after), 'database bytes changed during read-only ingestion');
  cleanup(dir);
});

test('opencode: populated session_part table raises a forward-compat warning', () => {
  const { dir, dataDir, db } = setup();
  insertFixtureSession(db, { id: 'ses_parts', createdAt: NOW, updatedAt: NOW });
  db.prepare(
    'INSERT INTO session_part (message_id, session_id, ordinal, type, time_created, time_updated, data) VALUES (?, ?, 0, ?, ?, ?, ?)',
  ).run('m1', 'ses_parts', 'tool', NOW, NOW, '{}');
  db.close();
  withEnv({ HAVRIN_OPENCODE_DATA_DIR: dataDir, PATH: '' }, () => {
    const inst = new OpenCodeAdapter().detect();
    assert.ok(inst.issues.some((i) => i.includes('session_part')));
  });
  cleanup(dir);
});
