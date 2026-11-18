/** End-to-end audit pipeline tests against fixture agent data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { runAudit } from '../src/audit.ts';
import { loadLastAudit } from '../src/store.ts';
import {
  tempDir,
  cleanup,
  createOpencodeFixture,
  insertFixtureSession,
  insertFixtureMessage,
  assistantData,
  toolPart,
  withEnv,
  writeClaudeTranscript,
  ccUserText,
  ccAssistant,
  ccToolUse,
  ccToolResult,
} from './helpers.ts';

const NOW = Date.now();

function setup() {
  const dir = tempDir();
  const home = path.join(dir, 'home');
  const dataDir = path.join(dir, 'opencode-data');
  const ocConfig = path.join(home, '.config', 'opencode');
  fs.mkdirSync(ocConfig, { recursive: true });
  const db = createOpencodeFixture(dataDir);
  // Session with a repeated failure → guaranteed finding.
  insertFixtureSession(db, { id: 'ses_recent', title: 'Recent', createdAt: NOW - 5000, updatedAt: NOW });
  const input = { path: '/a.ts', oldString: 'x', newString: 'y' };
  for (let i = 0; i < 3; i++) {
    insertFixtureMessage(
      db,
      'ses_recent',
      'assistant',
      assistantData({
        at: NOW - 4000 + i * 100,
        tools: [toolPart({ name: 'edit', input, status: 'error', error: { type: 'tool.execution', message: 'not found' }, at: NOW - 4000 + i * 100 })],
      }),
      NOW - 4000 + i * 100,
    );
  }
  // Old session outside default window.
  insertFixtureSession(db, { id: 'ses_old', title: 'Old', createdAt: NOW - 90 * 86_400_000, updatedAt: NOW - 80 * 86_400_000 });
  insertFixtureMessage(db, 'ses_old', 'user', { time: { created: NOW - 80 * 86_400_000 }, text: 'old' }, NOW - 80 * 86_400_000);
  db.close();
  return { dir, home, dataDir, ocConfig };
}

function envFor(s: ReturnType<typeof setup>, stateDir: string): Record<string, string | undefined> {
  return {
    HAVRIN_HOME: stateDir,
    HAVRIN_OPENCODE_DATA_DIR: s.dataDir,
    HAVRIN_OPENCODE_CONFIG_DIR: s.ocConfig,
    HAVRIN_CODEX_HOME: path.join(s.dir, 'no-codex'),
    HAVRIN_CLAUDE_HOME: path.join(s.dir, 'no-claude'),
    CODEX_HOME: undefined,
    CLAUDE_CONFIG_DIR: undefined,
    HOME: s.home,
    USERPROFILE: s.home,
    XDG_CONFIG_HOME: path.join(s.home, '.config'),
  };
}

test('audit: window filtering, findings, persistence', () => {
  const s = setup();
  const state = path.join(s.dir, 'state');
  withEnv(envFor(s, state), () => {
    const { report } = runAudit({ sinceMs: 30 * 86_400_000 });
    assert.equal(report.mode, 'real');
    assert.equal(report.coverage.sessionsDiscovered, 2);
    assert.equal(report.coverage.sessionsAnalyzed, 1);
    assert.equal(report.coverage.sessionsSkippedWindow, 1);
    assert.ok(report.findings.some((f) => f.ruleId === 'repeated-tool-failures'));
    assert.ok(report.recommendations.some((r) => r.id === 'rec-repeated-tool-failures'));
    for (const r of report.recommendations) {
      assert.equal(r.tested, false);
      assert.ok(r.apply.length > 0);
      assert.ok(r.rollback.length > 0);
    }
    const saved = loadLastAudit();
    assert.ok(saved);
    assert.equal(saved?.generatedAt, report.generatedAt);
  });
  cleanup(s.dir);
});

test('audit: --all equivalent includes old sessions', () => {
  const s = setup();
  withEnv(envFor(s, path.join(s.dir, 'state')), () => {
    const { report } = runAudit({ sinceMs: Date.now() + 1000 });
    assert.equal(report.coverage.sessionsAnalyzed, 2);
    assert.ok(report.window.since <= 1);
  });
  cleanup(s.dir);
});

test('audit: limit is enforced per agent', () => {
  const s = setup();
  withEnv(envFor(s, path.join(s.dir, 'state')), () => {
    const { report } = runAudit({ sinceMs: NOW, limit: 1 });
    assert.equal(report.coverage.sessionsAnalyzed, 1);
    assert.equal(report.coverage.sessionsSkippedLimit, 1);
  });
  cleanup(s.dir);
});

test('audit: incremental cache reuses unchanged sessions and re-reads changed ones', () => {
  const s = setup();
  const state = path.join(s.dir, 'state');
  withEnv(envFor(s, state), () => {
    const first = runAudit({ sinceMs: 30 * 86_400_000 });
    assert.equal(first.report.coverage.sessionsFromCache, 0);
    const second = runAudit({ sinceMs: 30 * 86_400_000 });
    assert.equal(second.report.coverage.sessionsFromCache, 1);
    assert.equal(second.report.coverage.sessionsAnalyzed, 1);

    // Mutate the fixture session (simulating agent activity).
    const newUpdated = Date.now();
    const db = new DatabaseSync(path.join(s.dataDir, 'opencode.db'));
    db.prepare('UPDATE session_v2 SET time_updated = ? WHERE id = ?').run(newUpdated, 'ses_recent');
    insertFixtureMessage(db, 'ses_recent', 'user', { time: { created: newUpdated }, text: 'new turn' }, newUpdated);
    db.close();

    const third = runAudit({ sinceMs: 30 * 86_400_000 });
    assert.equal(third.report.coverage.sessionsFromCache, 0);
    const summary = third.report.sessions.find((x) => x.id === 'ses_recent');
    assert.equal(summary?.userTurns, 1);
  });
  cleanup(s.dir);
});

test('audit: noCache bypasses reads but preserves other cache entries', () => {
  const s = setup();
  const state = path.join(s.dir, 'state');
  withEnv(envFor(s, state), () => {
    runAudit({ sinceMs: NOW });
    const { report } = runAudit({ sinceMs: NOW, noCache: true });
    assert.equal(report.coverage.sessionsFromCache, 0);
    const again = runAudit({ sinceMs: NOW });
    assert.equal(again.report.coverage.sessionsFromCache, 2);
  });
  cleanup(s.dir);
});

test('audit: agent restriction works', () => {
  const s = setup();
  withEnv(envFor(s, path.join(s.dir, 'state')), () => {
    const { report } = runAudit({ agents: ['codex'], sinceMs: NOW });
    assert.equal(report.coverage.sessionsAnalyzed, 0);
    assert.equal(report.environment.agents.length, 1);
    assert.equal(report.environment.agents[0]?.agent, 'codex');
  });
  cleanup(s.dir);
});

test('audit: empty environment produces clear zero coverage, no crash', () => {
  const dir = tempDir();
  withEnv(
    {
      HAVRIN_HOME: path.join(dir, 'state'),
      HAVRIN_OPENCODE_DATA_DIR: path.join(dir, 'missing-oc'),
      HAVRIN_OPENCODE_CONFIG_DIR: path.join(dir, 'missing-cfg'),
      HAVRIN_CODEX_HOME: path.join(dir, 'missing-cx'),
      HAVRIN_CLAUDE_HOME: path.join(dir, 'missing-claude'),
      CODEX_HOME: undefined,
      CLAUDE_CONFIG_DIR: undefined,
      HOME: path.join(dir, 'missing-home'),
      USERPROFILE: path.join(dir, 'missing-home'),
      XDG_CONFIG_HOME: path.join(dir, 'missing-xdg'),
    },
    () => {
      const { report } = runAudit({});
      assert.equal(report.coverage.sessionsAnalyzed, 0);
      assert.equal(report.findings.length, 0);
      assert.equal(report.recommendations.length, 0);
    },
  );
  cleanup(dir);
});

test('audit: corrupt cache falls back to full ingestion', () => {
  const s = setup();
  const state = path.join(s.dir, 'state');
  withEnv(envFor(s, state), () => {
    runAudit({ sinceMs: NOW });
    fs.writeFileSync(path.join(state, 'cache', 'opencode.json'), '{corrupted');
    const { report } = runAudit({ sinceMs: NOW });
    assert.equal(report.coverage.sessionsAnalyzed, 2);
    assert.equal(report.coverage.sessionsFromCache, 0);
  });
  cleanup(s.dir);
});

test('audit: claude incremental cache hits, invalidates on change, preserves attribution', () => {
  const dir = tempDir();
  const home = path.join(dir, 'home');
  const claudeHome = path.join(home, '.claude');
  const state = path.join(dir, 'state');
  fs.mkdirSync(claudeHome, { recursive: true });
  const sid = 'cccccccc-1111-2222-3333-444444444444';
  const file = writeClaudeTranscript(claudeHome, '-fixture-project', sid, [
    ccUserText('fix it'),
    ccAssistant({ messageId: 'm1', blocks: [ccToolUse('t1', 'Bash', { command: 'false' })] }),
    ccToolResult({ toolUseId: 't1', isError: true }),
    ccAssistant({ messageId: 'm2', blocks: [ccToolUse('t2', 'Bash', { command: 'false' })] }),
    ccToolResult({ toolUseId: 't2', isError: true }),
  ]);
  const env: Record<string, string | undefined> = {
    HAVRIN_HOME: state,
    HAVRIN_CLAUDE_HOME: claudeHome,
    CLAUDE_CONFIG_DIR: undefined,
    HAVRIN_OPENCODE_DATA_DIR: path.join(dir, 'no-oc'),
    HAVRIN_OPENCODE_CONFIG_DIR: path.join(dir, 'no-oc-cfg'),
    HAVRIN_CODEX_HOME: path.join(dir, 'no-cx'),
    CODEX_HOME: undefined,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
  };
  withEnv(env, () => {
    const first = runAudit({ sinceMs: 86_400_000 });
    assert.equal(first.report.coverage.sessionsAnalyzed, 1);
    assert.equal(first.report.coverage.sessionsFromCache, 0);
    assert.ok(first.report.findings.some((f) => f.ruleId === 'repeated-tool-failures' && f.agent === 'claude'));

    const second = runAudit({ sinceMs: 86_400_000 });
    assert.equal(second.report.coverage.sessionsFromCache, 1);

    // Append a record → mtime/size signature changes → re-ingest.
    fs.appendFileSync(file, JSON.stringify(ccUserText('another turn')) + '\n');
    const third = runAudit({ sinceMs: 86_400_000 });
    assert.equal(third.report.coverage.sessionsFromCache, 0);
    const summary = third.report.sessions.find((x) => x.id === sid);
    assert.equal(summary?.agent, 'claude');
    assert.equal(summary?.userTurns, 2);
    assert.ok(fs.existsSync(path.join(state, 'cache', 'claude.json')));
  });
  cleanup(dir);
});

test('audit: multi-agent analysis preserves provider attribution', () => {
  const s = setup();
  const claudeHome = path.join(s.dir, 'claude-home');
  fs.mkdirSync(claudeHome, { recursive: true });
  writeClaudeTranscript(claudeHome, '-fixture-project', 'dddddddd-1111-2222-3333-444444444444', [
    ccUserText('claude task'),
    ccAssistant({ messageId: 'cm1', blocks: [ccToolUse('ct1', 'Read', { file_path: '/shared.ts' })] }),
    ccToolResult({ toolUseId: 'ct1' }),
  ]);
  const env = {
    ...envFor(s, path.join(s.dir, 'state')),
    HAVRIN_CLAUDE_HOME: claudeHome,
    CLAUDE_CONFIG_DIR: undefined,
  };
  withEnv(env, () => {
    const { report } = runAudit({ sinceMs: 30 * 86_400_000 });
    const agents = new Set(report.sessions.map((x) => x.agent));
    assert.ok(agents.has('opencode'));
    assert.ok(agents.has('claude'));
    assert.equal(report.environment.agents.length, 3);
    for (const f of report.findings) {
      if (f.scope === 'sessions') assert.ok(f.agent, 'session findings carry agent attribution');
    }
    // Totals aggregate across agents without mixing attribution.
    assert.ok(report.totals.toolCalls >= 4);
  });
  cleanup(s.dir);
});
