import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDemoAudit } from '../src/demo/dataset.ts';
import { renderTerminal } from '../src/report/terminal.ts';
import { RULES } from '../src/diagnostics/rules.ts';

test('demo: deterministic output', () => {
  const a = runDemoAudit();
  const b = runDemoAudit();
  assert.deepEqual(a, b);
});

test('demo: exercises every v0.1 rule and labels itself synthetic', () => {
  const report = runDemoAudit();
  assert.equal(report.mode, 'demo');
  const fired = new Set(report.findings.map((f) => f.ruleId));
  for (const rule of RULES) {
    assert.ok(fired.has(rule.id), `demo does not exercise ${rule.id}`);
  }
  for (const s of report.sessions) {
    assert.ok(s.id.startsWith('demo-'));
    assert.ok(s.title?.startsWith('Demo:'));
  }
  assert.ok(report.recommendations.length >= RULES.length);
});

test('demo: healthy sessions produce no session-scoped findings', () => {
  const report = runDemoAudit();
  const healthy = ['demo-oc-healthy', 'demo-cx-healthy', 'demo-cc-healthy'];
  for (const f of report.findings) {
    for (const e of f.evidence) {
      assert.ok(!healthy.includes(e.sessionId ?? ''), `healthy session flagged: ${f.ruleId}`);
    }
  }
});

test('terminal renderer: respects width and color flag', () => {
  const report = runDemoAudit();
  const plain = renderTerminal(report, { color: false, width: 72 });
  assert.ok(!plain.includes('\u001b['));
  for (const line of plain.split('\n')) {
    assert.ok(line.length <= 100, `line too long (${line.length}): ${line.slice(0, 60)}`);
  }
  const colored = renderTerminal(report, { color: true, width: 72 });
  assert.ok(colored.includes('\u001b['));
});

test('terminal renderer: zero-coverage report explains and suggests demo', () => {
  const report = runDemoAudit();
  report.coverage = { ...report.coverage, sessionsAnalyzed: 0, sessionsDiscovered: 0 };
  report.sessions = [];
  report.findings = report.findings.filter((f) => f.scope === 'environment');
  const out = renderTerminal(report, { color: false, width: 80 });
  assert.ok(out.includes('No session data was analyzed'));
  assert.ok(out.includes('caliper demo'));
});
