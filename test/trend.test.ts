/**
 * Audit trend tests: pure delta computation, content-free history ring buffer,
 * end-to-end trend on repeat audits, the `caliper trend` command, and privacy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { summarizeAudit, computeTrend, formatDelta } from '../src/report/trend.ts';
import { runDemoAudit } from '../src/demo/dataset.ts';
import { runAudit } from '../src/audit.ts';
import { loadAuditHistory, appendAuditHistory, auditHistoryPath } from '../src/store.ts';
import type { AuditSummary } from '../src/core/types.ts';
import { tempDir, cleanup, withEnv, createOpencodeFixture, insertFixtureSession, insertFixtureMessage, assistantData, toolPart } from './helpers.ts';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');
const NOW = Date.now();

function summary(over: Partial<AuditSummary> = {}): AuditSummary {
  return {
    generatedAt: 1000,
    mode: 'real',
    window: { since: 0, until: 86_400_000 },
    sessionsAnalyzed: 10,
    findingsTotal: 5,
    severity: { high: 1, medium: 2, low: 2, info: 0 },
    rules: { 'retry-loops': 3, 'redundant-file-reads': 2 },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Pure computation
// ---------------------------------------------------------------------------

test('trend: summarizeAudit counts findings by severity and rule (content-free)', () => {
  const s = summarizeAudit(runDemoAudit());
  assert.equal(s.findingsTotal, 13);
  assert.equal(s.severity.high + s.severity.medium + s.severity.low + s.severity.info, 13);
  assert.equal(Object.values(s.rules).reduce((a, b) => a + b, 0), 13);
  assert.equal(s.mode, 'demo');
});

test('trend: computeTrend deltas, new/gone rules, sessions', () => {
  const prev = summary();
  const curr = summary({
    generatedAt: 2000,
    findingsTotal: 3,
    severity: { high: 0, medium: 1, low: 2, info: 0 },
    rules: { 'retry-loops': 1, 'unused-mcp-servers': 2 },
    sessionsAnalyzed: 8,
  });
  const t = computeTrend(prev, curr);
  assert.equal(t.findings.previous, 5);
  assert.equal(t.findings.current, 3);
  assert.equal(t.findings.delta, -2);
  assert.equal(t.severity.high.delta, -1);
  assert.deepEqual(t.newRules, ['unused-mcp-servers']);
  assert.deepEqual(t.goneRules, ['redundant-file-reads']);
  assert.equal(t.sessionsAnalyzed.delta, -2);
  assert.equal(t.rules.find((r) => r.ruleId === 'retry-loops')?.delta, -2);
  assert.equal(t.windowChanged, false);
});

test('trend: windowChanged flagged when the window duration differs', () => {
  const curr = summary({ window: { since: 0, until: 7 * 86_400_000 } });
  assert.equal(computeTrend(summary(), curr).windowChanged, true);
});

test('trend: formatDelta signs', () => {
  assert.equal(formatDelta(3), '+3');
  assert.equal(formatDelta(-6), '-6');
  assert.equal(formatDelta(0), '0');
});

// ---------------------------------------------------------------------------
// History ring buffer
// ---------------------------------------------------------------------------

test('trend: history persists real audits, ignores demo, rejects corruption', () => {
  const dir = tempDir();
  withEnv({ CALIPER_HOME: path.join(dir, 'state') }, () => {
    assert.deepEqual(loadAuditHistory(), []);
    appendAuditHistory(summary({ generatedAt: 1 }));
    appendAuditHistory(summary({ generatedAt: 2, mode: 'demo' })); // demo ignored
    appendAuditHistory(summary({ generatedAt: 3 }));
    const h = loadAuditHistory();
    assert.deepEqual(h.map((x) => x.generatedAt), [1, 3]);
    fs.writeFileSync(auditHistoryPath(), JSON.stringify([{ bogus: true }, summary({ generatedAt: 4 })]));
    const h2 = loadAuditHistory();
    assert.equal(h2.length, 1);
    assert.equal(h2[0]!.generatedAt, 4);
  });
  cleanup(dir);
});

test('trend: history caps at 50 entries (oldest evicted)', () => {
  const dir = tempDir();
  withEnv({ CALIPER_HOME: path.join(dir, 'state') }, () => {
    for (let i = 0; i < 60; i++) appendAuditHistory(summary({ generatedAt: i }));
    const h = loadAuditHistory();
    assert.equal(h.length, 50);
    assert.equal(h[0]!.generatedAt, 10);
    assert.equal(h[49]!.generatedAt, 59);
  });
  cleanup(dir);
});

test('trend: history is content-free (no secrets/text)', () => {
  const dir = tempDir();
  withEnv({ CALIPER_HOME: path.join(dir, 'state') }, () => {
    appendAuditHistory(summary());
    const raw = fs.readFileSync(auditHistoryPath(), 'utf8');
    for (const secret of ['SUPER-SECRET', 'USER-PRIVATE-MESSAGE', 'sk-user-secret', 'TOOL-OUTPUT']) {
      assert.ok(!raw.includes(secret));
    }
    // Only counts/ids/timestamps — no free-text fields.
    const parsed = JSON.parse(raw) as AuditSummary[];
    assert.ok(parsed.every((s) => typeof s.findingsTotal === 'number' && typeof s.rules === 'object'));
  });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// End-to-end + CLI
// ---------------------------------------------------------------------------

function fixtureEnv(): { env: Record<string, string>; dir: string } {
  const dir = tempDir();
  const home = path.join(dir, 'home');
  const dataDir = path.join(dir, 'opencode-data');
  const ocConfig = path.join(home, '.config', 'opencode');
  fs.mkdirSync(ocConfig, { recursive: true });
  const db = createOpencodeFixture(dataDir);
  insertFixtureSession(db, { id: 'ses_trend', title: 'Trend fixture', createdAt: NOW - 1000, updatedAt: NOW });
  const input = { command: 'false' };
  for (let i = 0; i < 3; i++) {
    insertFixtureMessage(db, 'ses_trend', 'assistant', assistantData({
      at: NOW - 900 + i * 10,
      tools: [toolPart({ name: 'shell', input, status: 'error', error: { type: 'tool.execution', message: 'exit 1' }, at: NOW - 900 + i * 10 })],
    }), NOW - 900 + i * 10);
  }
  db.close();
  const env: Record<string, string> = {
    CALIPER_HOME: path.join(dir, 'state'),
    CALIPER_OPENCODE_DATA_DIR: dataDir,
    CALIPER_OPENCODE_CONFIG_DIR: ocConfig,
    CALIPER_CODEX_HOME: path.join(dir, 'no-codex'),
    CALIPER_CLAUDE_HOME: path.join(dir, 'no-claude'),
    CODEX_HOME: '',
    CLAUDE_CONFIG_DIR: '',
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    NO_COLOR: '1',
  };
  return { env, dir };
}

test('trend: second audit carries a trend vs the first', () => {
  const { env, dir } = fixtureEnv();
  withEnv(env, () => {
    const first = runAudit({ sinceMs: 86_400_000 });
    assert.equal(first.report.trend, undefined); // no previous audit
    assert.ok(first.report.findings.length > 0);
    const second = runAudit({ sinceMs: 86_400_000 });
    assert.ok(second.report.trend, 'second audit should have a trend');
    assert.equal(second.report.trend!.findings.previous, first.report.findings.length);
    assert.equal(second.report.trend!.findings.current, second.report.findings.length);
    assert.equal(loadAuditHistory().length, 2);
  });
  cleanup(dir);
});

function runCli(args: string[], env: Record<string, string>): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, ['--experimental-strip-types', CLI, ...args], {
      env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

test('cli: trend with no history explains how to start', () => {
  const dir = tempDir();
  const r = runCli(['trend'], { CALIPER_HOME: path.join(dir, 'empty'), NO_COLOR: '1' });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('No audit history yet'));
  cleanup(dir);
});

test('cli: audit then trend shows a delta table', () => {
  const { env, dir } = fixtureEnv();
  assert.equal(runCli(['audit'], env).status, 0);
  assert.equal(runCli(['audit'], env).status, 0);
  const r = runCli(['trend'], env);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('TREND HISTORY'));
  assert.ok(r.stdout.includes('TREND'));
  assert.ok(r.stdout.includes('Findings:'));
  cleanup(dir);
});
