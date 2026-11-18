/**
 * Experiment comparison and verdicts.
 *
 * Deterministic decision rules (documented, tested at boundaries):
 * 1. CORRECTNESS DOMINATES. A faster configuration that produces incorrect
 *    code is never superior. Success-rate gaps ≥ 1/3 with n ≥ 3 decide the
 *    winner on correctness alone.
 * 2. Efficiency (time + tokens) only decides when correctness is comparable
 *    (both ≥ 80% success, gap < 1/3) AND both time and tokens improve
 *    materially (≥20% time, ≥10% tokens). Mixed efficiency = trade-off, no
 *    automatic winner.
 * 3. Confidence: n ≥ 5 and large gaps → 'verified'; n ≥ 3 → 'preliminary';
 *    n < 3 → 'inconclusive'. One successful run NEVER establishes improvement.
 *
 * These are conservative engineering thresholds, not a full statistical
 * test; variance is reported so readers can judge. No p-values are invented.
 */
import type {
  ConfigAggregate,
  ExperimentComparison,
  ExperimentRecord,
  ExperimentVerdict,
  RecommendationState,
  TrialResult,
  VerdictConfidence,
} from './types.ts';

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function aggregateConfig(configId: string, label: string, trials: TrialResult[]): ConfigAggregate {
  const completed = trials.filter((t) => t.status === 'completed');
  const successes = trials.filter((t) => t.verification?.success === true);
  const times = trials.map((t) => t.executionMs).filter((t): t is number => t !== undefined);
  const withMetrics = trials.filter((t) => t.sessionMetrics !== undefined);
  const withStats = trials.filter((t) => t.verification?.testStats && t.verification.testStats.source !== 'exit-code-only');

  const tokens = withMetrics.length
    ? withMetrics.reduce(
        (acc, t) => {
          const m = t.sessionMetrics!;
          acc.input += m.tokens.input;
          acc.output += m.tokens.output;
          acc.cacheRead += m.tokens.cacheRead;
          acc.cacheWrite += m.tokens.cacheWrite;
          acc.reasoning += m.tokens.reasoning;
          return acc;
        },
        { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      )
    : null;

  const costs = withMetrics.map((t) => t.sessionMetrics!.cost).filter((c): c is number => c !== null);
  const toolCalls = withMetrics.length ? withMetrics.reduce((a, t) => a + t.sessionMetrics!.toolCalls, 0) : null;
  const toolErrors = withMetrics.length ? withMetrics.reduce((a, t) => a + t.sessionMetrics!.toolErrors, 0) : null;
  const testFailures = withStats.length
    ? withStats.reduce((a, t) => a + (t.verification!.testStats!.failed), 0)
    : null;

  return {
    configId,
    label,
    trials: trials.length,
    completedTrials: completed.length,
    successes: successes.length,
    successRate: trials.length > 0 ? successes.length / trials.length : null,
    timeouts: trials.filter((t) => t.status === 'timeout').length,
    errors: trials.filter((t) => t.status === 'error' || t.status === 'interrupted').length,
    executionMs: times.length
      ? { mean: mean(times), median: median(times), stddev: stddev(times), min: Math.min(...times), max: Math.max(...times) }
      : null,
    tokens,
    cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    toolCalls,
    toolErrors,
    testFailures,
  };
}

const CORRECTNESS_GAP = 1 / 3;
const MIN_TRIALS_PRELIMINARY = 3;
const MIN_TRIALS_VERIFIED = 5;
const TIME_IMPROVEMENT = 0.2;
const TOKEN_IMPROVEMENT = 0.1;
const COMPARABLE_SUCCESS = 0.8;

interface Pairwise {
  winner: string | null;
  basis: 'correctness' | 'efficiency' | 'none';
  confidence: VerdictConfidence;
  reasons: string[];
  tradeoffs: string[];
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function comparePair(base: ConfigAggregate, cand: ConfigAggregate, n: number): Pairwise {
  const reasons: string[] = [];
  const tradeoffs: string[] = [];
  const srB = base.successRate ?? 0;
  const srC = cand.successRate ?? 0;

  if (n < MIN_TRIALS_PRELIMINARY) {
    reasons.push(`Only ${n} trial(s) per configuration — below the minimum of ${MIN_TRIALS_PRELIMINARY} for any claim.`);
    return { winner: null, basis: 'none', confidence: 'inconclusive', reasons, tradeoffs };
  }

  // 1. Correctness dominance.
  if (Math.abs(srC - srB) >= CORRECTNESS_GAP) {
    const winner = srC > srB ? cand.configId : base.configId;
    const confidence: VerdictConfidence = n >= MIN_TRIALS_VERIFIED && Math.abs(srC - srB) >= 0.4 ? 'verified' : 'preliminary';
    reasons.push(
      `Correctness decides: task success ${base.successes}/${base.trials} (${pct(srB)}) vs ${cand.successes}/${cand.trials} (${pct(srC)}). ` +
        `A faster configuration that produces incorrect code is not superior.`,
    );
    if (cand.timeouts > 0) tradeoffs.push(`${cand.label}: ${cand.timeouts} timeout(s) in ${cand.trials} trials.`);
    if (base.timeouts > 0) tradeoffs.push(`${base.label}: ${base.timeouts} timeout(s) in ${base.trials} trials.`);
    return { winner, basis: 'correctness', confidence, reasons, tradeoffs };
  }

  // 2. Efficiency only when correctness is comparable and high.
  if (srB >= COMPARABLE_SUCCESS && srC >= COMPARABLE_SUCCESS && base.executionMs && cand.executionMs && base.executionMs.mean > 0 && cand.executionMs.mean > 0 && base.tokens && cand.tokens) {
    const timeGain = 1 - cand.executionMs.mean / base.executionMs.mean;
    const outGain = base.tokens.output > 0 ? 1 - cand.tokens.output / base.tokens.output : 0;
    const inGain = base.tokens.input > 0 ? 1 - cand.tokens.input / base.tokens.input : 0;
    const tokenGain = Math.max(inGain, outGain);
    if (timeGain >= TIME_IMPROVEMENT && tokenGain >= TOKEN_IMPROVEMENT) {
      const confidence: VerdictConfidence = n >= MIN_TRIALS_VERIFIED ? 'verified' : 'preliminary';
      reasons.push(
        `Correctness comparable (${pct(srB)} vs ${pct(srC)}); ${cand.label} is ${pct(timeGain)} faster on average ` +
          `and uses ${pct(tokenGain)} fewer tokens.`,
      );
      if (cand.executionMs.stddev > base.executionMs.stddev * 1.5 && cand.executionMs.stddev > 0) {
        tradeoffs.push(`${cand.label} shows higher timing variance (stddev ${Math.round(cand.executionMs.stddev)}ms vs ${Math.round(base.executionMs.stddev)}ms).`);
      }
      return { winner: cand.configId, basis: 'efficiency', confidence, reasons, tradeoffs };
    }
    if (timeGain >= TIME_IMPROVEMENT && tokenGain < TOKEN_IMPROVEMENT) {
      tradeoffs.push(`${cand.label} is ${pct(timeGain)} faster but does not materially reduce token usage (${pct(Math.max(0, tokenGain))}).`);
    }
    if (tokenGain >= TOKEN_IMPROVEMENT && timeGain < TIME_IMPROVEMENT) {
      tradeoffs.push(`${cand.label} uses ${pct(tokenGain)} fewer tokens but is not materially faster (${pct(Math.max(0, timeGain))}).`);
    }
    reasons.push('No material combined efficiency advantage; correctness is comparable.');
    return { winner: null, basis: 'none', confidence: n >= MIN_TRIALS_VERIFIED ? 'preliminary' : 'inconclusive', reasons, tradeoffs };
  }

  reasons.push(
    `Success rates ${pct(srB)} vs ${pct(srC)} are too close or too low to decide; efficiency comparison requires ≥ ${pct(COMPARABLE_SUCCESS)} success on both sides.`,
  );
  return { winner: null, basis: 'none', confidence: 'inconclusive', reasons, tradeoffs };
}

export function compareExperiment(record: ExperimentRecord): ExperimentComparison {
  const byConfig = new Map<string, TrialResult[]>();
  for (const config of record.configs) byConfig.set(config.id, []);
  for (const trial of record.trials) {
    byConfig.get(trial.configId)?.push(trial);
  }
  const aggregates = record.configs.map((c) => aggregateConfig(c.id, c.label, byConfig.get(c.id) ?? []));
  const baseline = aggregates.find((a) => a.configId === record.baselineConfigId);
  const candidates = aggregates.filter((a) => a.configId !== record.baselineConfigId);

  const unavailable: string[] = [];
  if (aggregates.every((a) => a.tokens === null)) unavailable.push('Token usage unavailable (no session metrics collected).');
  if (aggregates.every((a) => a.cost === null)) unavailable.push('Inference cost unavailable (agent did not report reliable pricing).');
  if (aggregates.every((a) => a.testFailures === null)) unavailable.push('Per-test counts unavailable (exit-code-only verification).');
  if (aggregates.every((a) => a.executionMs === null)) unavailable.push('Execution time unavailable.');

  const reasons: string[] = [];
  const tradeoffs: string[] = [];
  let winner: string | null = null;
  let confidence: VerdictConfidence = 'inconclusive';
  let state: RecommendationState = 'inconclusive';

  if (!baseline || candidates.length === 0 || record.trials.length === 0) {
    reasons.push('No trials recorded yet.');
  } else {
    const n = Math.min(...aggregates.map((a) => a.trials));
    let best: Pairwise | null = null;
    for (const cand of candidates) {
      const pair = comparePair(baseline, cand, n);
      reasons.push(...pair.reasons.map((r) => `[${cand.label}] ${r}`));
      tradeoffs.push(...pair.tradeoffs);
      if (pair.winner === cand.configId) {
        if (!best || pair.confidence === 'verified' || (pair.confidence === 'preliminary' && best.confidence === 'inconclusive')) {
          best = pair;
          winner = cand.configId;
          confidence = pair.confidence;
        }
      } else if (pair.winner === baseline.configId && pair.basis === 'correctness') {
        // Candidate regressed on correctness — strongest negative signal.
        winner = baseline.configId;
        confidence = pair.confidence;
        best = pair;
        state = 'regression-detected';
      }
    }
    if (state !== 'regression-detected') {
      if (winner && winner !== baseline.configId) {
        state = confidence === 'verified' ? 'verified-improvement' : 'experiment-completed';
        if (confidence !== 'verified') {
          reasons.push('Preliminary result: repeat with more trials before treating this as a verified improvement.');
        }
      } else if (winner === baseline.configId) {
        state = 'no-meaningful-improvement';
        reasons.push('Baseline retained: no candidate demonstrated a defensible advantage.');
      } else {
        state = 'inconclusive';
        if (n < MIN_TRIALS_PRELIMINARY) reasons.push(`Increase trials to at least ${MIN_TRIALS_PRELIMINARY} per configuration.`);
      }
    }
  }

  const verdict: ExperimentVerdict = {
    winnerConfigId: winner,
    confidence,
    reasons,
    tradeoffs,
    recommendationState: state,
  };

  return {
    experimentId: record.id,
    benchmarkId: record.benchmark.id,
    generatedAt: Date.now(),
    aggregates,
    verdict,
    unavailable,
  };
}
