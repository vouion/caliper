/** CLI behavior tests: spawn the real CLI with fixture environments. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempDir, cleanup, createOpencodeFixture, insertFixtureSession, insertFixtureMessage, assistantData, toolPart } from './helpers.ts';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');
const NOW = Date.now();

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env: Record<string, string>): RunResult {
  try {
    const stdout = execFileSync(process.execPath, ['--experimental-strip-types', CLI, ...args], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function fixtureEnv(): { env: Record<string, string>; dir: string } {
  const dir = tempDir();
  const home = path.join(dir, 'home');
  const dataDir = path.join(dir, 'opencode-data');
  const ocConfig = path.join(home, '.config', 'opencode');
  fs.mkdirSync(ocConfig, { recursive: true });
  const db = createOpencodeFixture(dataDir);
  insertFixtureSession(db, { id: 'ses_cli', title: 'CLI fixture', createdAt: NOW - 1000, updatedAt: NOW });
  const input = { command: 'false' };
  for (let i = 0; i < 3; i++) {
    insertFixtureMessage(db, 'ses_cli', 'assistant', assistantData({
      at: NOW - 900 + i * 10,
      tools: [toolPart({ name: 'shell', input, status: 'error', error: { type: 'tool.execution', message: 'exit 1' }, at: NOW - 900 + i * 10 })],
    }), NOW - 900 + i * 10);
  }
  db.close();
  const env: Record<string, string> = {
    HAVRIN_HOME: path.join(dir, 'state'),
    HAVRIN_OPENCODE_DATA_DIR: dataDir,
    HAVRIN_OPENCODE_CONFIG_DIR: ocConfig,
    HAVRIN_CODEX_HOME: path.join(dir, 'no-codex'),
    HAVRIN_CLAUDE_HOME: path.join(dir, 'no-claude'),
    CLAUDE_CONFIG_DIR: '',
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    NO_COLOR: '1',
  };
  return { env, dir };
}

test('cli: help exits 0 and lists commands', () => {
  const r = runCli(['help'], {});
  assert.equal(r.status, 0);
  for (const cmd of ['doctor', 'audit', 'report', 'demo']) assert.ok(r.stdout.includes(cmd));
});

test('cli: no args shows help', () => {
  const r = runCli([], {});
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('USAGE'));
});

test('cli: version prints semver', () => {
  const r = runCli(['version'], {});
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('cli: unknown command exits 2 with structured error', () => {
  const r = runCli(['bogus'], {});
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('error[USAGE]'));
});

test('cli: unknown option exits 2', () => {
  const r = runCli(['audit', '--wat'], {});
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('error[USAGE]'));
});

test('cli: invalid --since exits 2 with hint', () => {
  const r = runCli(['audit', '--since', 'bananas'], {});
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('Invalid --since'));
});

test('cli: invalid --agent exits 2', () => {
  const r = runCli(['audit', '--agent', 'gemini'], {});
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('Unknown agent'));
});

test('cli: --all and --since conflict exits 2', () => {
  const r = runCli(['audit', '--all', '--since', '7d'], {});
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('mutually exclusive'));
});

test('cli: report without prior audit exits 1 with NO_AUDIT', () => {
  const dir = tempDir();
  const r = runCli(['report', '--format', 'json'], { HAVRIN_HOME: path.join(dir, 'empty'), NO_COLOR: '1' });
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('error[NO_AUDIT]'));
  cleanup(dir);
});

test('cli: demo --json emits valid demo report covering all rules', () => {
  const r = runCli(['demo', '--json'], { NO_COLOR: '1' });
  assert.equal(r.status, 0);
  const report = JSON.parse(r.stdout);
  assert.equal(report.mode, 'demo');
  assert.equal(report.schemaVersion, '1');
  const ruleIds = new Set(report.findings.map((f: { ruleId: string }) => f.ruleId));
  for (const rule of [
    'repeated-tool-failures', 'retry-loops', 'redundant-file-reads', 'missing-test-verification',
    'context-compaction-pressure', 'unused-mcp-servers', 'skill-name-collisions', 'plaintext-config-secrets',
  ]) {
    assert.ok(ruleIds.has(rule), `demo missing rule ${rule}`);
  }
});

test('cli: demo terminal output is labeled synthetic and colorless with NO_COLOR', () => {
  const r = runCli(['demo'], { NO_COLOR: '1' });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('SYNTHETIC DEMONSTRATION DATA'));
  assert.ok(!r.stdout.includes('\u001b['));
});

test('cli: audit --json then report --format json round-trips', () => {
  const { env, dir } = fixtureEnv();
  const audit = runCli(['audit', '--json'], env);
  assert.equal(audit.status, 0);
  const report = JSON.parse(audit.stdout);
  assert.equal(report.mode, 'real');
  assert.equal(report.coverage.sessionsAnalyzed, 1);
  assert.ok(report.findings.length > 0);

  const again = runCli(['report', '--format', 'json'], env);
  assert.equal(again.status, 0);
  const roundTripped = JSON.parse(again.stdout);
  assert.equal(roundTripped.generatedAt, report.generatedAt);

  const terminal = runCli(['report'], env);
  assert.equal(terminal.status, 0);
  assert.ok(terminal.stdout.includes('FINDINGS'));
  assert.ok(terminal.stdout.includes('RECOMMENDATIONS'));
  cleanup(dir);
});

test('cli: audit terminal report renders without color under NO_COLOR', () => {
  const { env, dir } = fixtureEnv();
  const r = runCli(['audit'], env);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('havrin v'));
  assert.ok(!r.stdout.includes('\u001b['));
  cleanup(dir);
});

test('cli: report --json is an alias for --format json', () => {
  const { env, dir } = fixtureEnv();
  const audit = runCli(['audit', '--json'], env);
  assert.equal(audit.status, 0);
  const viaAlias = runCli(['report', '--json'], env);
  assert.equal(viaAlias.status, 0);
  const report = JSON.parse(viaAlias.stdout);
  assert.equal(report.schemaVersion, '1');
  cleanup(dir);
});

test('cli: doctor passes with fixture data and fails nothing critical', () => {
  const { env, dir } = fixtureEnv();
  const r = runCli(['doctor'], env);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('opencode: installation'));
  assert.ok(r.stdout.includes('All critical checks passed'));
  cleanup(dir);
});

test('cli: audit with no data communicates clearly and exits 0', () => {
  const dir = tempDir();
  const r = runCli(['audit'], {
    HAVRIN_HOME: path.join(dir, 'state'),
    HAVRIN_OPENCODE_DATA_DIR: path.join(dir, 'none'),
    HAVRIN_OPENCODE_CONFIG_DIR: path.join(dir, 'none'),
    HAVRIN_CODEX_HOME: path.join(dir, 'none'),
    HAVRIN_CLAUDE_HOME: path.join(dir, 'none'),
    CLAUDE_CONFIG_DIR: '',
    HOME: path.join(dir, 'none-home'),
    USERPROFILE: path.join(dir, 'none-home'),
    XDG_CONFIG_HOME: path.join(dir, 'none-xdg'),
    NO_COLOR: '1',
  });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('No session data was analyzed'));
  assert.ok(r.stdout.includes('havrin demo'));
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// Experiment CLI
// ---------------------------------------------------------------------------

function expEnv(dir: string): Record<string, string> {
  const home = path.join(dir, 'home');
  return {
    HAVRIN_HOME: path.join(dir, 'state'),
    HAVRIN_OPENCODE_DATA_DIR: path.join(dir, 'none'),
    HAVRIN_OPENCODE_CONFIG_DIR: path.join(dir, 'none'),
    HAVRIN_CODEX_HOME: path.join(dir, 'none'),
    HAVRIN_CLAUDE_HOME: path.join(dir, 'none'),
    CLAUDE_CONFIG_DIR: '',
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    NO_COLOR: '1',
  };
}

const MOCK_BASE = {
  id: 'base',
  label: 'Base',
  agent: 'mock',
  mockBehavior: { durationMs: 5, outcome: 'success', edits: [], metrics: { tokens: { input: 100, output: 100, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, toolCalls: 3, toolErrors: 1 } },
};
const MOCK_CAND = {
  id: 'cand',
  label: 'Cand',
  agent: 'mock',
  mockBehavior: {
    durationMs: 5,
    outcome: 'success',
    edits: [{ path: 'src/price.js', content: 'export function finalPrice(price, discountRate) {\n  if (price >= 100) {\n    return Math.round(price * (1 - discountRate) * 100) / 100;\n  }\n  return price;\n}\n' }],
    metrics: { tokens: { input: 80, output: 60, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, toolCalls: 2, toolErrors: 0 },
  },
};

test('cli: experiment demo --json produces a completed comparison', () => {
  const r = runCli(['experiment', 'demo', '--json'], { NO_COLOR: '1' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.record.status, 'completed');
  assert.equal(out.comparison.verdict.winnerConfigId, 'candidate-fast');
  assert.equal(out.record.trials.length, 6);
});

test('cli: experiment demo terminal shows mock banner and verdict', () => {
  const r = runCli(['experiment', 'demo'], { NO_COLOR: '1' });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('MOCK configurations'));
  assert.ok(r.stdout.includes('VERDICT'));
  assert.ok(!r.stdout.includes('\u001b['));
});

test('cli: experiment create → run → report → inspect lifecycle', () => {
  const dir = tempDir();
  const env = expEnv(dir);
  fs.writeFileSync(path.join(dir, 'base.json'), JSON.stringify(MOCK_BASE));
  fs.writeFileSync(path.join(dir, 'cand.json'), JSON.stringify(MOCK_CAND));
  const created = runCli(['experiment', 'create', '--benchmark', 'builtin:fix-failing-test', '--baseline', path.join(dir, 'base.json'), '--candidate', path.join(dir, 'cand.json'), '--trials', '3', '--seed', '9'], env);
  assert.equal(created.status, 0);
  const idMatch = /Created experiment (exp-[a-z0-9-]+)/.exec(created.stdout);
  const id = idMatch?.[1];
  assert.ok(id);

  const listed = runCli(['experiment', 'list'], env);
  assert.equal(listed.status, 0);
  assert.ok(listed.stdout.includes(id));

  const run = runCli(['experiment', 'run', id], env);
  assert.equal(run.status, 0);
  assert.ok(run.stdout.includes('Task success'));

  const report = runCli(['experiment', 'report', id, '--format', 'json'], env);
  assert.equal(report.status, 0);
  const parsed = JSON.parse(report.stdout);
  assert.equal(parsed.record.id, id);
  assert.equal(parsed.comparison.verdict.winnerConfigId, 'cand');

  const inspect = runCli(['experiment', 'inspect', id], env);
  assert.equal(inspect.status, 0);
  assert.equal(JSON.parse(inspect.stdout).id, id);
  cleanup(dir);
});

test('cli: experiment run with real agents requires approval (exit 2)', () => {
  const dir = tempDir();
  const env = expEnv(dir);
  fs.writeFileSync(path.join(dir, 'base.json'), JSON.stringify({ id: 'base', label: 'OC', agent: 'opencode', model: 'x/y' }));
  fs.writeFileSync(path.join(dir, 'cand.json'), JSON.stringify({ id: 'cand', label: 'OC2', agent: 'opencode', model: 'x/z' }));
  const created = runCli(['experiment', 'create', '--benchmark', 'builtin:fix-failing-test', '--baseline', path.join(dir, 'base.json'), '--candidate', path.join(dir, 'cand.json')], env);
  assert.equal(created.status, 0);
  const id = /Created experiment (exp-[a-z0-9-]+)/.exec(created.stdout)?.[1];
  assert.ok(id);
  const run = runCli(['experiment', 'run', id], env);
  assert.equal(run.status, 2);
  assert.ok(run.stderr.includes('approve-inference'));
  const dry = runCli(['experiment', 'run', id, '--dry-run'], env);
  assert.equal(dry.status, 0);
  assert.ok(dry.stdout.includes('DRY RUN'));
  cleanup(dir);
});

test('cli: unknown experiment subcommand exits 2', () => {
  const r = runCli(['experiment', 'bogus'], { NO_COLOR: '1' });
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('Unknown experiment subcommand'));
});

test('cli: experiment report for missing id exits 1 with hint', () => {
  const dir = tempDir();
  const r = runCli(['experiment', 'report', 'exp-nonexistent'], expEnv(dir));
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('not found'));
  cleanup(dir);
});
