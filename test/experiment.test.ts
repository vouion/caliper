/**
 * Experimentation engine tests: deterministic mock fixtures exercise the
 * full create → run → verify → compare pipeline without paid inference.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createExperiment, runExperiment, runExperimentRecord } from '../src/experiment/runner.ts';
import { runExperimentDemo } from '../src/experiment/demo.ts';
import { listExperiments, loadExperiment, saveExperiment, acquireRunLock, experimentFile } from '../src/experiment/store.ts';
import { compareExperiment, aggregateConfig } from '../src/experiment/compare.ts';
import { parseTestStats } from '../src/experiment/metrics.ts';
import { linkRecommendationStates } from '../src/experiment/link.ts';
import { materializeBuiltinTemplate, builtinBenchmark } from '../src/experiment/builtin.ts';
import { fingerprintSource, materializeWorkspace } from '../src/experiment/workspace.ts';
import { renderExperimentTerminal } from '../src/experiment/report.ts';
import type { ExperimentRecord, TrialResult, Recommendation } from '../src/index.ts';
import { tempDir, cleanup, withEnv, withEnvAsync } from './helpers.ts';

function envFor(dir: string): Record<string, string | undefined> {
  const home = path.join(dir, 'home');
  return {
    HAVRIN_HOME: path.join(dir, 'state'),
    HAVRIN_OPENCODE_DATA_DIR: path.join(dir, 'no-oc'),
    HAVRIN_OPENCODE_CONFIG_DIR: path.join(dir, 'no-oc-cfg'),
    HAVRIN_CODEX_HOME: path.join(dir, 'no-cx'),
    HAVRIN_CLAUDE_HOME: path.join(dir, 'no-claude'),
    CODEX_HOME: undefined,
    CLAUDE_CONFIG_DIR: undefined,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    // PATH stays real: verification runs `node --test` in trial workspaces.
    // Mock-only experiments never probe agent binaries; gate tests only
    // run --version probes (no data access, no execution).
  };
}

function mockConfig(id: string, opts: { fix: boolean; durationMs?: number; outcome?: 'success' | 'failure' | 'timeout' | 'error' }) {
  return {
    id,
    label: id,
    agent: 'mock',
    mockBehavior: {
      durationMs: opts.durationMs ?? 20,
      outcome: opts.outcome ?? 'success',
      edits: opts.fix ? [{ path: 'src/price.js', content: FIXED_SOURCE }] : [],
      metrics: {
        tokens: { input: 1000, output: opts.fix ? 500 : 900, reasoning: 100, cacheRead: 5000, cacheWrite: 200 },
        cost: opts.fix ? 0.05 : 0.09,
        toolCalls: opts.fix ? 5 : 12,
        toolErrors: opts.fix ? 0 : 3,
      },
    },
  };
}

const FIXED_SOURCE = `/**
 * Compute the final price after a discount.
 * Discount applies when the price is at least 100.
 */
export function finalPrice(price, discountRate) {
  if (price >= 100) {
    return Math.round(price * (1 - discountRate) * 100) / 100;
  }
  return price;
}
`;

function createMockExperiment(dir: string, opts: { trials?: number; seed?: number; recommendationIds?: string[] } = {}) {
  return createExperiment({
    benchmarkRef: 'builtin:fix-failing-test',
    baseline: mockConfig('base', { fix: false }),
    candidates: [mockConfig('cand', { fix: true, durationMs: 10 })],
    trialsPerConfig: opts.trials ?? 3,
    ...(opts.seed !== undefined ? { orderSeed: opts.seed } : {}),
    ...(opts.recommendationIds ? { recommendationIds: opts.recommendationIds } : {}),
  });
}

// ---------------------------------------------------------------------------
// Demo: full pipeline, deterministic verdict
// ---------------------------------------------------------------------------

test('experiment demo: complete pipeline with honest correctness verdict', async () => {
  const { record, comparison } = await runExperimentDemo();
  assert.equal(record.status, 'completed');
  assert.equal(record.trials.length, 6);
  const base = comparison.aggregates.find((a) => a.configId === 'baseline-slow');
  const cand = comparison.aggregates.find((a) => a.configId === 'candidate-fast');
  assert.equal(base?.successes, 0);
  assert.equal(cand?.successes, 3);
  assert.equal(base?.testFailures, 3); // real node --test counts, parsed
  assert.equal(cand?.testFailures, 0);
  assert.equal(comparison.verdict.winnerConfigId, 'candidate-fast');
  assert.equal(comparison.verdict.confidence, 'preliminary'); // n=3 < 5
  assert.equal(comparison.verdict.recommendationState, 'experiment-completed');
  // Execution success ≠ task success: baseline completed but failed checks.
  assert.equal(base?.completedTrials, 3);
  for (const t of record.trials.filter((t) => t.configId === 'baseline-slow')) {
    assert.equal(t.status, 'completed');
    assert.equal(t.verification?.success, false);
    assert.equal(t.verification?.checks.find((c) => c.id === 'tests-pass')?.passed, false);
    assert.equal(t.verification?.checks.find((c) => c.id === 'tests-unchanged')?.passed, true);
  }
});

test('experiment demo: deterministic verdict across runs', async () => {
  const a = await runExperimentDemo();
  const b = await runExperimentDemo();
  assert.deepEqual(a.comparison.verdict, b.comparison.verdict);
  assert.deepEqual(
    a.comparison.aggregates.map((x) => [x.configId, x.successes, x.testFailures]),
    b.comparison.aggregates.map((x) => [x.configId, x.successes, x.testFailures]),
  );
});

// ---------------------------------------------------------------------------
// Create validation
// ---------------------------------------------------------------------------

test('create: rejects invalid definitions', async () => {
  const dir = tempDir();
  await withEnvAsync(envFor(dir), async () => {
    const good = mockConfig('cand', { fix: true });
    assert.throws(() => createExperiment({ benchmarkRef: 'builtin:fix-failing-test', baseline: { id: 'BAD ID', label: 'x', agent: 'mock', mockBehavior: { durationMs: 1, outcome: 'success' } }, candidates: [good] }), /kebab-case/);
    assert.throws(() => createExperiment({ benchmarkRef: 'builtin:fix-failing-test', baseline: { id: 'base', label: 'x', agent: 'mock' }, candidates: [good] }), /mockBehavior/);
    assert.throws(() => createExperiment({ benchmarkRef: 'builtin:fix-failing-test', baseline: { id: 'base', label: 'x', agent: 'opencode', mockBehavior: { durationMs: 1, outcome: 'success' } }, candidates: [good] }), /only valid for the mock/);
    assert.throws(() => createExperiment({ benchmarkRef: 'builtin:fix-failing-test', baseline: mockConfig('base', { fix: false }), candidates: [good], trialsPerConfig: 0 }), /between 1 and 20/);
    assert.throws(() => createExperiment({ benchmarkRef: 'builtin:fix-failing-test', baseline: mockConfig('base', { fix: false }), candidates: [] }), /candidate/);
    assert.throws(() => createExperiment({ benchmarkRef: 'builtin:fix-failing-test', baseline: mockConfig('same', { fix: false }), candidates: [mockConfig('same', { fix: true })] }), /unique/);
    assert.throws(() => createExperiment({ benchmarkRef: 'builtin:nonexistent', baseline: mockConfig('base', { fix: false }), candidates: [good] }), /Unknown built-in/);
  });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// Persisted lifecycle: create → run → report → resume dedupe
// ---------------------------------------------------------------------------

test('lifecycle: create, run, list, report, and completed-trial dedupe', async () => {
  const dir = tempDir();
  await withEnvAsync(envFor(dir), async () => {
    const record = createMockExperiment(dir, { seed: 7 });
    assert.equal(record.status, 'ready');
    assert.ok(listExperiments().some((e) => e.id === record.id));

    const outcome = await runExperiment(record.id, {});
    assert.equal(outcome.record.status, 'completed');
    assert.equal(outcome.comparison.verdict.winnerConfigId, 'cand');

    // Second run: completed trials are never re-executed.
    const before = loadExperiment(record.id).trials.map((t) => [t.trialId, t.startedAt]);
    const again = await runExperiment(record.id, {});
    const after = again.record.trials.map((t) => [t.trialId, t.startedAt]);
    assert.deepEqual(after, before);

    const loaded = loadExperiment(record.id);
    const comparison = compareExperiment(loaded);
    const text = renderExperimentTerminal(loaded, comparison, { color: false, width: 90 });
    assert.ok(text.includes('VERDICT'));
    assert.ok(text.includes('Task success'));
    assert.ok(!text.includes('\u001b'));
  });
  cleanup(dir);
});

test('lifecycle: workspaces deleted by default, kept with flag; source untouched', async () => {
  const dir = tempDir();
  await withEnvAsync(envFor(dir), async () => {
    const record = createMockExperiment(dir, { trials: 1 });
    const templateDir = record.benchmark.source.path;
    const sourceBefore = fs.readFileSync(path.join(templateDir, 'src', 'price.js'));
    const outcome = await runExperiment(record.id, {});
    assert.equal(outcome.record.trials.length, 2);
    const wsRoot = path.join(path.dirname(experimentFile(record.id)), 'workspaces');
    assert.ok(!fs.existsSync(wsRoot), 'workspaces must be cleaned up');
    assert.ok(sourceBefore.equals(fs.readFileSync(path.join(templateDir, 'src', 'price.js'))), 'benchmark source modified');

    const kept = createMockExperiment(dir, { trials: 1 });
    const keptOutcome = await runExperiment(kept.id, { keepWorkspaces: true });
    assert.ok(keptOutcome.record.trials.every((t) => t.workspaceKept === true));
    const keptWs = path.join(path.dirname(experimentFile(kept.id)), 'workspaces');
    assert.ok(fs.existsSync(keptWs));
  });
  cleanup(dir);
});

test('lifecycle: transient stdout artifacts never persist', async () => {
  const dir = tempDir();
  await withEnvAsync(envFor(dir), async () => {
    const record = createMockExperiment(dir, { trials: 1 });
    await runExperiment(record.id, {});
    const expDir = path.dirname(experimentFile(record.id));
    assert.ok(!fs.existsSync(path.join(expDir, 'scratch')));
    const serialized = JSON.stringify(loadExperiment(record.id));
    assert.ok(!serialized.includes('stdout'));
  });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// Approval gates and dry-run (no execution)
// ---------------------------------------------------------------------------

test('gates: real agents require --approve-inference; unverified backends need --allow-unverified', async () => {
  const dir = tempDir();
  await withEnvAsync(envFor(dir), async () => {
    const record = createExperiment({
      benchmarkRef: 'builtin:fix-failing-test',
      baseline: { id: 'base', label: 'OpenCode baseline', agent: 'opencode', model: 'fixture/model' },
      candidates: [{ id: 'cand', label: 'Codex candidate', agent: 'codex', model: 'fixture' }],
      trialsPerConfig: 1,
    });
    await assert.rejects(() => runExperiment(record.id, {}), /approve-inference/);
    await assert.rejects(() => runExperiment(record.id, { approveInference: true }), /allow-unverified/);
    // Dry run works without approval and executes nothing.
    const dry = await runExperiment(record.id, { dryRun: true });
    assert.ok(dry.dryRunPlan);
    assert.equal(dry.dryRunPlan?.length, 2);
    assert.equal(loadExperiment(record.id).status, 'ready');
    assert.equal(loadExperiment(record.id).trials.length, 0);
  });
  cleanup(dir);
});

test('order: seeded randomization is reproducible', async () => {
  const dir = tempDir();
  await withEnvAsync(envFor(dir), async () => {
    const a = createMockExperiment(dir, { seed: 1234, trials: 4 });
    const b = createMockExperiment(dir, { seed: 1234, trials: 4 });
    const planA = await runExperiment(a.id, { dryRun: true });
    const planB = await runExperiment(b.id, { dryRun: true });
    assert.deepEqual(
      planA.dryRunPlan?.map((t) => t.trialId),
      planB.dryRunPlan?.map((t) => t.trialId),
    );
    // Order is actually shuffled (not config-blocked) for seed 1234.
    const ids = planA.dryRunPlan?.map((t) => t.configId) ?? [];
    const switches = ids.filter((c, i) => i > 0 && c !== ids[i - 1]).length;
    assert.ok(switches >= 2, 'execution order should interleave configs');
  });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// Failure, timeout, recovery, locking, integrity
// ---------------------------------------------------------------------------

test('failures: mock error and timeout outcomes are recorded honestly', async () => {
  const dir = tempDir();
  await withEnvAsync(envFor(dir), async () => {
    const record = createExperiment({
      benchmarkRef: 'builtin:fix-failing-test',
      baseline: mockConfig('base', { fix: false }),
      candidates: [mockConfig('err', { fix: true, outcome: 'error' }), mockConfig('to', { fix: true, outcome: 'timeout' })],
      trialsPerConfig: 1,
    });
    const outcome = await runExperiment(record.id, {});
    const err = outcome.record.trials.find((t) => t.configId === 'err');
    const to = outcome.record.trials.find((t) => t.configId === 'to');
    assert.equal(err?.status, 'error');
    assert.equal(to?.status, 'timeout');
    // Verification still ran (partial progress measured honestly).
    assert.ok(err?.verification);
    assert.ok(to?.verification);
    assert.equal(outcome.comparison.aggregates.find((a) => a.configId === 'err')?.errors, 1);
    assert.equal(outcome.comparison.aggregates.find((a) => a.configId === 'to')?.timeouts, 1);
  });
  cleanup(dir);
});

test('recovery: interrupted run is recovered and resumable; live lock blocks duplicates', async () => {
  const dir = tempDir();
  await withEnvAsync(envFor(dir), async () => {
    const record = createMockExperiment(dir, { trials: 1 });
    // Simulate a crash mid-run.
    record.status = 'running';
    record.trials = [
      { trialId: 'base-t1', configId: 'base', order: 0, status: 'running', startedAt: Date.now() - 1000 },
      { trialId: 'cand-t1', configId: 'cand', order: 1, status: 'pending', startedAt: 0 },
    ];
    saveExperiment(record);
    const outcome = await runExperiment(record.id, {});
    assert.ok(outcome.notices.some((n) => n.includes('Recovered')));
    assert.equal(outcome.record.status, 'completed');
    assert.equal(outcome.record.trials.length, 2);
    assert.ok(outcome.record.trials.every((t) => t.status === 'completed'));

    // Live lock (our own pid) blocks a concurrent run.
    const other = createMockExperiment(dir, { trials: 1 });
    acquireRunLock(other.id);
    await assert.rejects(() => runExperiment(other.id, {}), /already running/);
  });
  cleanup(dir);
});

test('integrity: changed benchmark source blocks run; corrupt record rejected', async () => {
  const dir = tempDir();
  await withEnvAsync(envFor(dir), async () => {
    const record = createMockExperiment(dir, { trials: 1 });
    fs.appendFileSync(path.join(record.benchmark.source.path, 'README.md'), 'changed\n');
    await assert.rejects(() => runExperiment(record.id, {}), /fingerprint mismatch/);

    const other = createMockExperiment(dir, { trials: 1 });
    fs.writeFileSync(experimentFile(other.id), '{corrupt');
    assert.throws(() => loadExperiment(other.id), /corrupted/);
    assert.ok(listExperiments().some((e) => e.id === other.id && e.status === 'corrupted'));
    fs.writeFileSync(experimentFile(other.id), JSON.stringify({ schemaVersion: '1', id: other.id }));
    assert.throws(() => loadExperiment(other.id), /integrity/);
  });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// Git-source isolation
// ---------------------------------------------------------------------------

test('isolation: git benchmark source clones locally without touching origin', () => {
  const dir = tempDir();
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'file.txt'), 'original');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
  const spec = {
    schemaVersion: '1' as const,
    id: 'git-fixture',
    title: 'Git fixture',
    description: 'x',
    source: { kind: 'git' as const, path: repo },
    taskPrompt: 'do something',
    acceptance: [{ id: 'f', description: 'file exists', kind: 'file-exists' as const, path: 'file.txt' }],
    limits: { timeoutMs: 10_000 },
  };
  const fp = fingerprintSource(spec);
  assert.ok(fp.startsWith('git:'));
  const ws = path.join(dir, 'ws');
  materializeWorkspace(spec, ws);
  assert.equal(fs.readFileSync(path.join(ws, 'file.txt'), 'utf8'), 'original');
  assert.ok(fs.existsSync(path.join(ws, '.git')));
  // Modify workspace; origin must be untouched.
  fs.writeFileSync(path.join(ws, 'file.txt'), 'modified');
  assert.equal(fs.readFileSync(path.join(repo, 'file.txt'), 'utf8'), 'original');
  assert.equal(fingerprintSource(spec), fp);
  // Refuse to overwrite an existing workspace.
  assert.throws(() => materializeWorkspace(spec, ws), /already exists/);
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// Comparison verdict logic (boundary tests)
// ---------------------------------------------------------------------------

function trial(configId: string, i: number, opts: { success: boolean; ms: number; out: number; status?: TrialResult['status'] }): TrialResult {
  return {
    trialId: `${configId}-t${i}`,
    configId,
    order: i,
    status: opts.status ?? 'completed',
    startedAt: 1000 + i,
    executionMs: opts.ms,
    verification: { success: opts.success, checks: [], testStats: { passed: opts.success ? 5 : 4, failed: opts.success ? 0 : 1, total: 5, source: 'node-test-tap' }, durationMs: 10 },
    sessionMetrics: {
      tokens: { input: 1000, output: opts.out, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      cost: null, toolCalls: 5, toolErrors: 0, retries: 0, compactions: 0, userTurns: 1, assistantTurns: 2,
    },
  };
}

function recordWith(trials: TrialResult[], trialsPerConfig: number): ExperimentRecord {
  const dir = tempDir();
  const templateDir = path.join(dir, 'template');
  materializeBuiltinTemplate(templateDir);
  const rec: ExperimentRecord = {
    schemaVersion: '1',
    id: 'exp-test',
    createdAt: 0,
    updatedAt: 0,
    status: 'completed',
    benchmark: builtinBenchmark(templateDir),
    benchmarkFingerprint: 'test',
    baselineConfigId: 'a',
    configs: [
      { id: 'a', label: 'A', agent: 'mock' },
      { id: 'b', label: 'B', agent: 'mock' },
    ],
    configFingerprints: { a: 'fa', b: 'fb' },
    trialsPerConfig,
    orderSeed: 1,
    recommendationIds: [],
    trials,
    environment: { havrinVersion: 'test', platform: 'test', nodeVersion: 'test', agentVersions: {} },
  };
  cleanup(dir);
  return rec;
}

test('verdict: faster-but-incorrect never wins (correctness dominance)', () => {
  const trials = [
    ...Array.from({ length: 5 }, (_, i) => trial('a', i, { success: true, ms: 2000, out: 1000 })),
    ...Array.from({ length: 5 }, (_, i) => trial('b', i, { success: i === 0, ms: 500, out: 200 })),
  ];
  const cmp = compareExperiment(recordWith(trials, 5));
  assert.equal(cmp.verdict.winnerConfigId, 'a');
  assert.equal(cmp.verdict.recommendationState, 'regression-detected');
  assert.ok(cmp.verdict.reasons.some((r) => r.includes('Correctness decides')));
});

test('verdict: comparable correctness + material time AND token gains → efficiency winner', () => {
  const trials = [
    ...Array.from({ length: 5 }, (_, i) => trial('a', i, { success: true, ms: 1000, out: 1000 })),
    ...Array.from({ length: 5 }, (_, i) => trial('b', i, { success: true, ms: 700, out: 800 })),
  ];
  const cmp = compareExperiment(recordWith(trials, 5));
  assert.equal(cmp.verdict.winnerConfigId, 'b');
  assert.equal(cmp.verdict.confidence, 'verified');
  assert.equal(cmp.verdict.recommendationState, 'verified-improvement');
});

test('verdict: faster but token-hungry is a trade-off, not a winner', () => {
  const trials = [
    ...Array.from({ length: 5 }, (_, i) => trial('a', i, { success: true, ms: 1000, out: 1000 })),
    ...Array.from({ length: 5 }, (_, i) => trial('b', i, { success: true, ms: 700, out: 1200 })),
  ];
  const cmp = compareExperiment(recordWith(trials, 5));
  assert.equal(cmp.verdict.winnerConfigId, null);
  assert.ok(cmp.verdict.tradeoffs.some((t) => t.includes('faster')));
});

test('verdict: single trial is never conclusive', () => {
  const trials = [trial('a', 0, { success: false, ms: 1000, out: 1000 }), trial('b', 0, { success: true, ms: 500, out: 500 })];
  const cmp = compareExperiment(recordWith(trials, 1));
  assert.equal(cmp.verdict.confidence, 'inconclusive');
  assert.equal(cmp.verdict.winnerConfigId, null);
});

test('verdict: n=3 correctness gap is preliminary, not verified', () => {
  const trials = [
    ...Array.from({ length: 3 }, (_, i) => trial('a', i, { success: false, ms: 1000, out: 1000 })),
    ...Array.from({ length: 3 }, (_, i) => trial('b', i, { success: true, ms: 1000, out: 1000 })),
  ];
  const cmp = compareExperiment(recordWith(trials, 3));
  assert.equal(cmp.verdict.winnerConfigId, 'b');
  assert.equal(cmp.verdict.confidence, 'preliminary');
});

test('verdict: zero-duration trials do not produce division artifacts', () => {
  const trials = [
    ...Array.from({ length: 5 }, (_, i) => trial('a', i, { success: true, ms: 0, out: 1000 })),
    ...Array.from({ length: 5 }, (_, i) => trial('b', i, { success: true, ms: 0, out: 800 })),
  ];
  const cmp = compareExperiment(recordWith(trials, 5));
  assert.equal(cmp.verdict.winnerConfigId, null);
  assert.ok(Number.isFinite(cmp.aggregates[0]?.executionMs?.mean ?? 0));
});

test('verdict: unavailable metrics stay null, never zero', () => {
  const t = trial('a', 0, { success: true, ms: 100, out: 100 });
  delete t.sessionMetrics;
  const agg = aggregateConfig('a', 'A', [t]);
  assert.equal(agg.tokens, null);
  assert.equal(agg.cost, null);
  assert.equal(agg.toolCalls, null);
  assert.equal(agg.successRate, 1);
});

// ---------------------------------------------------------------------------
// Test-stats parsing
// ---------------------------------------------------------------------------

test('parseTestStats: node spec, TAP, pytest, and exit-code-only', () => {
  const dir = tempDir();
  const file = path.join(dir, 'out');
  fs.writeFileSync(file, 'ℹ tests 6\nℹ pass 5\nℹ fail 1\n');
  assert.deepEqual(parseTestStats(file, 1), { passed: 5, failed: 1, total: 6, source: 'node-test-tap' });
  fs.writeFileSync(file, '# pass 3\n# fail 2\n');
  assert.deepEqual(parseTestStats(file, 1), { passed: 3, failed: 2, total: 5, source: 'node-test-tap' });
  fs.writeFileSync(file, '===== 4 passed, 1 failed in 0.2s =====');
  assert.deepEqual(parseTestStats(file, 1), { passed: 4, failed: 1, total: 5, source: 'pytest' });
  fs.writeFileSync(file, 'some unparseable output');
  assert.deepEqual(parseTestStats(file, 0), { passed: 0, failed: 0, total: 0, source: 'exit-code-only' });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// Recommendation linking (observe → diagnose → experiment → verify)
// ---------------------------------------------------------------------------

test('link: recommendation states reflect experiment lifecycle', async () => {
  const dir = tempDir();
  await withEnvAsync(envFor(dir), async () => {
    const recs: Recommendation[] = [
      { id: 'rec-repeated-tool-failures', findingRuleIds: ['repeated-tool-failures'], state: 'proposed', what: 'x', why: 'x', change: 'x', evidence: [], tested: false, testedNote: 'x', benefits: 'x', tradeoffs: 'x', apply: ['x'], rollback: ['x'] },
    ];
    linkRecommendationStates(recs);
    assert.equal(recs[0]?.state, 'proposed');

    const record = createMockExperiment(dir, { trials: 1, recommendationIds: ['rec-repeated-tool-failures'] });
    linkRecommendationStates(recs);
    assert.equal(recs[0]?.state, 'ready-for-testing');
    assert.equal(recs[0]?.experimentId, record.id);

    await runExperiment(record.id, {});
    linkRecommendationStates(recs);
    // Mock candidate fixes the task → correctness win at n=1 → inconclusive.
    assert.equal(recs[0]?.state, 'inconclusive');
  });
  cleanup(dir);
});

// ---------------------------------------------------------------------------
// Privacy: registry content contract
// ---------------------------------------------------------------------------

test('privacy: trial results and verification carry no file/output content', async () => {
  const dir = tempDir();
  await withEnvAsync(envFor(dir), async () => {
    const sentinelConfig = {
      id: 'sent',
      label: 'sentinel',
      agent: 'mock',
      mockBehavior: {
        durationMs: 5,
        outcome: 'success',
        edits: [{ path: 'src/price.js', content: FIXED_SOURCE + '\n// WORKSPACE-CONTENT-SENTINEL' }],
        metrics: { tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, toolCalls: 1, toolErrors: 0 },
      },
    };
    const record = createExperiment({
      benchmarkRef: 'builtin:fix-failing-test',
      baseline: mockConfig('base', { fix: false }),
      candidates: [sentinelConfig],
      trialsPerConfig: 1,
    });
    const outcome = await runExperiment(record.id, {});
    const serializedTrials = JSON.stringify(outcome.record.trials);
    assert.ok(!serializedTrials.includes('WORKSPACE-CONTENT-SENTINEL'), 'trial results leaked workspace content');
    assert.ok(!serializedTrials.includes('finalPrice'), 'trial results leaked source code');
    for (const t of outcome.record.trials) {
      for (const c of t.verification?.checks ?? []) {
        assert.ok(!c.detail?.includes('SENTINEL'));
        assert.ok((c.detail ?? '').length < 60, 'verification detail must be structural only');
      }
    }
    // Config definitions legitimately contain mock fixture content; real
    // agents never contribute content to the registry (no session text path).
    assert.ok(JSON.stringify(outcome.record.configs).includes('WORKSPACE-CONTENT-SENTINEL'));
  });
  cleanup(dir);
});
