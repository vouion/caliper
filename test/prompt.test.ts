/**
 * Fix-prompt generation tests.
 *
 * Unit tests exercise buildFixPrompt/selectRecommendations on the synthetic
 * demo report (deterministic, content-free). CLI tests spawn the real binary
 * with isolated fixture environments. The privacy contract for this new output
 * surface is asserted against real secret-bearing fixtures in privacy.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildFixPrompt, selectRecommendations } from '../src/optimize/prompt.ts';
import { runDemoAudit } from '../src/demo/dataset.ts';
import type { AuditReport } from '../src/core/types.ts';
import { tempDir, cleanup } from './helpers.ts';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');

// ---------------------------------------------------------------------------
// Unit: buildFixPrompt / selectRecommendations
// ---------------------------------------------------------------------------

test('prompt: demo report yields a complete, severity-ordered fix prompt', () => {
  const report = runDemoAudit();
  const prompt = buildFixPrompt(report);
  assert.ok(prompt.includes('# Workflow optimization task'));
  assert.ok(prompt.includes('## Operating rules'));
  assert.ok(prompt.includes('## Prioritized fixes'));
  assert.ok(prompt.includes('## Definition of done'));
  // All eight demo recommendations are included at the default threshold.
  assert.equal(selectRecommendations(report, 'low').length, 8);
  // Highest severity comes first.
  const firstHeader = prompt.split('\n').find((l) => l.startsWith('### 1.'));
  assert.ok(firstHeader?.includes('[HIGH]'));
  // Honest framing: observational, not experimentally proven.
  assert.ok(prompt.includes('observational (not experimentally verified)'));
  assert.ok(!prompt.includes('experimentally tested'));
});

test('prompt: selectRecommendations filters by severity and sorts descending', () => {
  const report = runDemoAudit();
  const high = selectRecommendations(report, 'high');
  assert.equal(high.length, 2);
  assert.ok(high.every((r) => r.severity === 'high'));
  const medium = selectRecommendations(report, 'medium');
  assert.ok(medium.length > high.length);
  assert.ok(medium.every((r) => r.severity === 'high' || r.severity === 'medium'));
  // Descending severity order.
  const rank = { high: 3, medium: 2, low: 1, info: 0 } as const;
  for (let i = 1; i < medium.length; i++) {
    assert.ok(rank[medium[i - 1]!.severity] >= rank[medium[i]!.severity]);
  }
});

test('prompt: --min-severity high keeps only high-severity fixes', () => {
  const prompt = buildFixPrompt(runDemoAudit(), { minSeverity: 'high' });
  assert.ok(prompt.includes('2 recommendations'));
  assert.ok(prompt.includes('[HIGH]'));
  assert.ok(!prompt.includes('[MEDIUM]'));
  assert.ok(!prompt.includes('[LOW]'));
});

test('prompt: agent tailoring changes the instruction-file reference', () => {
  const report = runDemoAudit();
  assert.ok(buildFixPrompt(report, { agent: 'claude' }).includes('CLAUDE.md (project root, or global ~/.claude/CLAUDE.md)'));
  assert.ok(buildFixPrompt(report, { agent: 'opencode' }).includes('~/.config/opencode/AGENTS.md'));
  assert.ok(buildFixPrompt(report, { agent: 'codex' }).includes('~/.codex/AGENTS.md'));
  assert.ok(buildFixPrompt(report, { agent: 'generic' }).includes('e.g. AGENTS.md or CLAUDE.md'));
});

test('prompt: empty report (no findings) says nothing to fix', () => {
  const report: AuditReport = { ...runDemoAudit(), findings: [], recommendations: [] };
  const prompt = buildFixPrompt(report);
  assert.ok(prompt.includes('No issues were detected'));
  assert.ok(!prompt.includes('## Prioritized fixes'));
  assert.ok(prompt.includes('make no speculative changes'));
});

test('prompt: threshold above all findings explains the empty selection', () => {
  const demo = runDemoAudit();
  const lowFindings = demo.findings.filter((f) => f.severity === 'low');
  const lowRecs = demo.recommendations.filter((r) => r.findingRuleIds.some((id) => lowFindings.some((f) => f.ruleId === id)));
  const report: AuditReport = { ...demo, findings: lowFindings, recommendations: lowRecs };
  assert.ok(lowFindings.length > 0);
  const prompt = buildFixPrompt(report, { minSeverity: 'high' });
  assert.ok(prompt.includes('No recommendations meet the severity threshold'));
  assert.ok(prompt.includes('make no speculative changes'));
});

test('prompt: full-history window is labeled, not rendered as decades', () => {
  const demo = runDemoAudit();
  const report: AuditReport = { ...demo, window: { ...demo.window, since: 0 } };
  const prompt = buildFixPrompt(report);
  assert.ok(prompt.includes('window: full history'));
});

test('prompt: Detected issues section is formed around the actual findings', () => {
  const report = runDemoAudit();
  const prompt = buildFixPrompt(report);
  assert.ok(prompt.includes('## Detected issues'));
  // Every finding is represented with its title, rule, evidence, and impact.
  for (const f of report.findings) {
    assert.ok(prompt.includes(f.title), `missing finding title: ${f.title}`);
    assert.ok(prompt.includes(f.ruleId), `missing rule: ${f.ruleId}`);
  }
  assert.ok(prompt.includes('Impact:'));
  assert.ok(prompt.includes('confidence'));
  // Detected issues precedes the fixes that address them.
  assert.ok(prompt.indexOf('## Detected issues') < prompt.indexOf('## Prioritized fixes'));
});

test('prompt: Detected issues respects the severity threshold', () => {
  const report = runDemoAudit();
  const prompt = buildFixPrompt(report, { minSeverity: 'high' });
  const section = prompt.split('## Detected issues')[1]!.split('## ')[0]!;
  const high = report.findings.filter((f) => f.severity === 'high');
  const low = report.findings.filter((f) => f.severity === 'low');
  assert.ok(high.length > 0 && low.length > 0);
  for (const f of high) assert.ok(section.includes(f.title), `missing high finding: ${f.title}`);
  for (const f of low) assert.ok(!section.includes(f.title), `low finding leaked into high-only prompt: ${f.title}`);
});

test('prompt: explains session findings are historical, environment findings current', () => {
  const prompt = buildFixPrompt(runDemoAudit());
  assert.ok(prompt.includes('historical patterns'));
  assert.ok(prompt.includes('Environment-scoped issues reflect current configuration'));
});

test('cli: prompt --demo --copy copies the prompt to the clipboard', () => {
  const dir = tempDir();
  const capture = path.join(dir, 'cap.txt');
  const fake = path.join(dir, 'wl-copy');
  fs.writeFileSync(fake, `#!/bin/sh\ncat > "${capture}"\n`);
  fs.chmodSync(fake, 0o755);
  const env = { ...promptEnv(dir), PATH: `${dir}:${process.env['PATH'] ?? ''}`, WAYLAND_DISPLAY: 'wayland-0' };
  const r = runCli(['prompt', '--demo', '--copy'], env);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('Copied prompt to clipboard'));
  assert.ok(fs.readFileSync(capture, 'utf8').includes('# Workflow optimization task'));
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// CLI integration
// ---------------------------------------------------------------------------

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

function promptEnv(dir: string): Record<string, string> {
  const home = path.join(dir, 'home');
  return {
    CALIPER_HOME: path.join(dir, 'state'),
    CALIPER_OPENCODE_DATA_DIR: path.join(dir, 'none'),
    CALIPER_OPENCODE_CONFIG_DIR: path.join(dir, 'none'),
    CALIPER_CODEX_HOME: path.join(dir, 'none'),
    CALIPER_CLAUDE_HOME: path.join(dir, 'none'),
    CODEX_HOME: '',
    CLAUDE_CONFIG_DIR: '',
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    NO_COLOR: '1',
  };
}

test('cli: prompt --demo emits a fix prompt and exits 0', () => {
  const dir = tempDir();
  const r = runCli(['prompt', '--demo'], promptEnv(dir));
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('# Workflow optimization task'));
  assert.ok(r.stdout.includes('## Prioritized fixes'));
  cleanup(dir);
});

test('cli: prompt --demo does not persist a last-audit artifact', () => {
  const dir = tempDir();
  const env = promptEnv(dir);
  const r = runCli(['prompt', '--demo'], env);
  assert.equal(r.status, 0);
  assert.ok(!fs.existsSync(path.join(env['CALIPER_HOME']!, 'last-audit.json')));
  cleanup(dir);
});

test('cli: prompt --demo --agent claude tailors to CLAUDE.md', () => {
  const dir = tempDir();
  const r = runCli(['prompt', '--demo', '--agent', 'claude'], promptEnv(dir));
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('CLAUDE.md'));
  cleanup(dir);
});

test('cli: prompt --demo --min-severity high filters fixes', () => {
  const dir = tempDir();
  const r = runCli(['prompt', '--demo', '--min-severity', 'high'], promptEnv(dir));
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('2 recommendations'));
  assert.ok(!r.stdout.includes('[MEDIUM]'));
  cleanup(dir);
});

test('cli: prompt --demo --json emits structured payload with the prompt', () => {
  const dir = tempDir();
  const r = runCli(['prompt', '--demo', '--json'], promptEnv(dir));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.mode, 'demo');
  assert.equal(out.agent, 'generic');
  assert.equal(out.minSeverity, 'low');
  assert.equal(out.recommendationCount, 8);
  assert.equal(out.findingCount, 13);
  assert.ok(typeof out.prompt === 'string' && out.prompt.includes('# Workflow optimization task'));
  cleanup(dir);
});

test('cli: prompt --demo --output writes the prompt to a file', () => {
  const dir = tempDir();
  const out = path.join(dir, 'fix.md');
  const r = runCli(['prompt', '--demo', '--output', out], promptEnv(dir));
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('Wrote prompt to'));
  const written = fs.readFileSync(out, 'utf8');
  assert.ok(written.includes('# Workflow optimization task'));
  assert.ok(written.includes('## Definition of done'));
  cleanup(dir);
});

test('cli: prompt without a saved audit exits 1 with NO_AUDIT', () => {
  const dir = tempDir();
  const r = runCli(['prompt'], promptEnv(dir));
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('error[NO_AUDIT]'));
  assert.ok(r.stderr.includes('--demo'));
  cleanup(dir);
});

test('cli: prompt uses the last real audit when present', () => {
  const dir = tempDir();
  const env = promptEnv(dir);
  // Seed a saved audit by running the demo audit through `audit` is not possible
  // (demo never persists); instead write a minimal valid artifact via a real
  // audit of an empty environment, which persists last-audit.json.
  const audit = runCli(['audit', '--json'], env);
  assert.equal(audit.status, 0);
  const r = runCli(['prompt', '--json'], env);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.mode, 'real');
  assert.ok(typeof out.prompt === 'string');
  cleanup(dir);
});

test('cli: prompt --agent with an unknown value exits 2', () => {
  const dir = tempDir();
  const r = runCli(['prompt', '--demo', '--agent', 'gemini'], promptEnv(dir));
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('error[USAGE]'));
  assert.ok(r.stderr.includes('Unknown prompt agent'));
  cleanup(dir);
});

test('cli: prompt --min-severity with an invalid value exits 2', () => {
  const dir = tempDir();
  const r = runCli(['prompt', '--demo', '--min-severity', 'critical'], promptEnv(dir));
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('error[USAGE]'));
  assert.ok(r.stderr.includes('Invalid --min-severity'));
  cleanup(dir);
});
