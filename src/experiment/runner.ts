/**
 * Experiment runner: create → run → measure → compare.
 *
 * Safety gates:
 * - Real-agent execution requires explicit approveInference (paid inference).
 * - Unverified backends (codex/claude live execution) additionally require
 *   allowUnverified.
 * - Run lock prevents duplicated concurrent execution; interrupted runs are
 *   recoverable and resumable (completed trials are never re-executed).
 * - Every trial gets a fresh isolated workspace; transient stdout artifacts
 *   are deleted after structural parsing; workspaces are deleted unless
 *   explicitly kept.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  ExperimentRecord,
  TrialResult,
  ExecutionAgent,
  ExperimentComparison,
} from './types.ts';
import { CaliperError } from '../core/errors.ts';
import { fingerprint, sanitizeFreeText } from '../core/util.ts';
import { caliperHome } from '../core/fs.ts';
import { CALIPER_VERSION } from '../version.ts';
import { loadBenchmark, validateSource, fingerprintSource, materializeWorkspace, removeWorkspace } from './workspace.ts';
import { validateConfig } from './validate.ts';
import {
  newExperimentId,
  saveExperiment,
  loadExperiment,
  acquireRunLock,
  releaseRunLock,
  recoverInterrupted,
  scratchDir,
  workspacesDir,
  removeScratch,
} from './store.ts';
import type { ExecutionAdapter } from './execution/adapter.ts';
import { buildPrompt } from './execution/adapter.ts';
import { MockExecutionAdapter } from './execution/mock.ts';
import { OpenCodeExecutionAdapter } from './execution/opencode.ts';
import { CodexExecutionAdapter } from './execution/codex.ts';
import { ClaudeExecutionAdapter } from './execution/claude.ts';
import { runVerification, collectSessionMetrics } from './metrics.ts';
import { compareExperiment } from './compare.ts';
import { OpenCodeAdapter } from '../adapters/opencode.ts';
import { CodexAdapter } from '../adapters/codex.ts';
import { ClaudeAdapter } from '../adapters/claude.ts';

const EXECUTION_ADAPTERS: Record<ExecutionAgent, ExecutionAdapter> = {
  mock: new MockExecutionAdapter(),
  opencode: new OpenCodeExecutionAdapter(),
  codex: new CodexExecutionAdapter(),
  claude: new ClaudeExecutionAdapter(),
};

export interface CreateOptions {
  benchmarkRef: string;
  baseline: unknown;
  candidates: unknown[];
  trialsPerConfig?: number;
  recommendationIds?: string[];
  orderSeed?: number;
  /** false = build in memory without persisting (demo mode). */
  persist?: boolean;
}

export function createExperiment(opts: CreateOptions): ExperimentRecord {
  const benchmark = loadBenchmark(opts.benchmarkRef, caliperHome());
  validateSource(benchmark);
  const benchmarkFingerprint = fingerprintSource(benchmark);

  const baseline = validateConfig(opts.baseline);
  const candidates = opts.candidates.map(validateConfig);
  if (candidates.length === 0) throw new CaliperError('USAGE', 'At least one candidate configuration is required.');
  const configs = [baseline, ...candidates];
  const ids = configs.map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw new CaliperError('USAGE', 'Configuration ids must be unique.');

  const trialsPerConfig = opts.trialsPerConfig ?? 3;
  if (!Number.isInteger(trialsPerConfig) || trialsPerConfig < 1 || trialsPerConfig > 20) {
    throw new CaliperError('USAGE', 'trialsPerConfig must be an integer between 1 and 20.');
  }

  const configFingerprints: Record<string, string> = {};
  for (const config of configs) {
    configFingerprints[config.id] = fingerprint({
      agent: config.agent,
      model: config.model ?? null,
      agentName: config.agentName ?? null,
      instructions: config.instructions ?? null,
      mockBehavior: config.mockBehavior ?? null,
    });
  }

  const agentVersions: Record<string, string | null> = {};
  for (const agent of new Set(configs.map((c) => c.agent))) {
    if (agent === 'mock') continue;
    try {
      const sessionAdapter =
        agent === 'opencode' ? new OpenCodeAdapter() : agent === 'codex' ? new CodexAdapter() : new ClaudeAdapter();
      const inst = sessionAdapter.detect();
      agentVersions[agent] = inst.version ?? null;
    } catch {
      agentVersions[agent] = null;
    }
  }

  const record: ExperimentRecord = {
    schemaVersion: '1',
    id: newExperimentId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'ready',
    benchmark,
    benchmarkFingerprint,
    baselineConfigId: baseline.id,
    configs,
    configFingerprints,
    trialsPerConfig,
    orderSeed: opts.orderSeed ?? Math.floor(Math.random() * 2 ** 31),
    recommendationIds: opts.recommendationIds ?? [],
    trials: [],
    environment: {
      caliperVersion: CALIPER_VERSION,
      platform: `${process.platform}/${process.arch}`,
      nodeVersion: process.versions.node,
      agentVersions,
    },
  };
  if (opts.persist !== false) saveExperiment(record);
  return record;
}

/** Deterministic PRNG (mulberry32) for reproducible execution order. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RunOptions {
  approveInference?: boolean;
  allowUnverified?: boolean;
  dryRun?: boolean;
  keepWorkspaces?: boolean;
  timeoutMs?: number;
  /** In-memory execution with temp dirs; nothing persisted (demo mode). */
  ephemeral?: boolean;
}

export interface RunOutcome {
  record: ExperimentRecord;
  comparison: ExperimentComparison;
  notices: string[];
  dryRunPlan?: { trialId: string; configId: string; agent: ExecutionAgent; order: number }[];
}

function sessionIdFor(agent: ExecutionAgent): string {
  if (agent === 'opencode') return `ses_${randomBytes(13).toString('hex')}`;
  if (agent === 'claude') return randomUUID();
  return '';
}

export async function runExperiment(id: string, opts: RunOptions = {}): Promise<RunOutcome> {
  const record = loadExperiment(id);
  return runExperimentRecord(record, opts);
}

/** Execute an experiment record (persisted or ephemeral). */
export async function runExperimentRecord(record: ExperimentRecord, opts: RunOptions = {}): Promise<RunOutcome> {
  const notices: string[] = [];
  const persist = opts.ephemeral !== true;
  const save = () => {
    if (persist) saveExperiment(record);
  };
  const id = record.id;

  // Recover any interrupted prior run before planning.
  if (recoverInterrupted(record)) {
    notices.push('Recovered interrupted trials from a previous run.');
    save();
  }

  // Integrity: benchmark source must not have changed since creation.
  try {
    const current = fingerprintSource(record.benchmark);
    if (current !== record.benchmarkFingerprint) {
      throw new CaliperError(
        'IO',
        `Benchmark source changed since experiment creation (fingerprint mismatch).`,
        'Create a new experiment to benchmark the updated source; results must be reproducible.',
      );
    }
  } catch (err) {
    if (err instanceof CaliperError) throw err;
    throw new CaliperError('IO', 'Benchmark source is no longer readable; cannot verify reproducibility.');
  }

  // Build the full trial plan (configs × trials), resumable.
  const existing = new Map(record.trials.map((t) => [t.trialId, t]));
  const plan: TrialResult[] = [];
  for (const config of record.configs) {
    for (let i = 0; i < record.trialsPerConfig; i++) {
      const trialId = `${config.id}-t${i + 1}`;
      const prev = existing.get(trialId);
      if (prev && prev.status === 'completed') {
        plan.push(prev); // never re-execute completed trials (dup protection)
        continue;
      }
      plan.push({
        trialId,
        configId: config.id,
        order: 0,
        status: 'pending',
        startedAt: 0,
      });
    }
  }
  // Seeded shuffle of executable trials; completed trials keep their slots.
  const rng = mulberry32(record.orderSeed);
  const executable = plan.filter((t) => t.status !== 'completed');
  for (let i = executable.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = executable[i];
    const b = executable[j];
    if (a && b) {
      executable[i] = b;
      executable[j] = a;
    }
  }
  executable.forEach((t, idx) => {
    t.order = idx;
  });

  if (opts.dryRun) {
    return {
      record,
      comparison: compareExperiment(record),
      notices,
      dryRunPlan: executable.map((t) => ({
        trialId: t.trialId,
        configId: t.configId,
        agent: record.configs.find((c) => c.id === t.configId)?.agent ?? 'mock',
        order: t.order,
      })),
    };
  }

  // Approval gates (after dry-run: previewing the plan never needs approval).
  const realAgents = record.configs.filter((c) => c.agent !== 'mock');
  if (realAgents.length > 0 && !opts.approveInference) {
    throw new CaliperError(
      'USAGE',
      'This experiment runs real coding agents (paid model inference, code modification in isolated workspaces); explicit approval via --approve-inference is required.',
      'Re-run with --approve-inference to explicitly approve. Use --dry-run to preview the plan, or mock configurations for a free demonstration.',
    );
  }
  const unverified = realAgents.filter((c) => !EXECUTION_ADAPTERS[c.agent].verified);
  if (unverified.length > 0 && !opts.allowUnverified) {
    throw new CaliperError(
      'USAGE',
      `Execution backend(s) not yet verified against a live install: ${[...new Set(unverified.map((c) => c.agent))].join(', ')}; --allow-unverified is required.`,
      'OpenCode is the verified backend. Pass --allow-unverified to proceed at your own risk.',
    );
  }

  if (persist) acquireRunLock(id);
  record.status = 'running';
  record.trials = plan;
  save();

  const timeoutMs = opts.timeoutMs ?? record.benchmark.limits.timeoutMs;
  const ephemeralBase = opts.ephemeral ? fs.mkdtempSync(path.join(os.tmpdir(), 'caliper-exp-')) : undefined;
  const scratch = ephemeralBase ? path.join(ephemeralBase, 'scratch') : scratchDir(id);
  fs.mkdirSync(scratch, { recursive: true });
  const wsRoot = ephemeralBase ? path.join(ephemeralBase, 'workspaces') : workspacesDir(id);
  fs.mkdirSync(wsRoot, { recursive: true });

  try {
    for (const trial of executable) {
      const config = record.configs.find((c) => c.id === trial.configId);
      if (!config) {
        trial.status = 'error';
        trial.error = 'configuration missing from experiment record';
        trial.finishedAt = Date.now();
        save();
        continue;
      }
      const adapter = EXECUTION_ADAPTERS[config.agent];
      const workspace = path.join(wsRoot, trial.trialId);
      const stdoutPath = path.join(scratch, `${trial.trialId}.out`);
      const startedAt = Date.now();
      trial.status = 'running';
      trial.startedAt = startedAt;
      save();

      try {
        // Fresh isolated workspace per attempt.
        removeWorkspace(workspace);
        materializeWorkspace(record.benchmark, workspace);

        const sessionId = sessionIdFor(config.agent);
        const outcome = await adapter.execute({
          workspace,
          prompt: buildPrompt(config, record.benchmark.taskPrompt),
          config,
          timeoutMs,
          sessionId,
          runLabel: `caliper ${record.id} ${trial.trialId}`,
          stdoutPath,
          startedAt,
        });
        trial.status = outcome.status;
        trial.executionMs = outcome.durationMs;
        if (outcome.exitCode !== undefined) trial.exitCode = outcome.exitCode;
        if (outcome.sessionId) trial.sessionId = outcome.sessionId;
        if (outcome.error) trial.error = outcome.error;

        // Deterministic verification by Caliper (always, even after timeouts:
        // partial progress is measured honestly).
        const verification = await runVerification(record.benchmark, workspace, scratch);
        trial.verification = verification;

        // Content-free session metrics via existing adapters.
        if (config.agent === 'mock' && config.mockBehavior?.metrics) {
          const m = config.mockBehavior.metrics;
          trial.sessionMetrics = {
            tokens: m.tokens,
            cost: m.cost ?? null,
            toolCalls: m.toolCalls,
            toolErrors: m.toolErrors,
            retries: m.retries ?? 0,
            compactions: m.compactions ?? 0,
            userTurns: 1,
            assistantTurns: Math.max(1, Math.ceil(m.toolCalls / 3)),
          };
        } else {
          const metrics = collectSessionMetrics(config.agent, outcome.sessionId, workspace, startedAt);
          if (metrics) trial.sessionMetrics = metrics;
          else if (config.agent !== 'mock') notices.push(`Trial ${trial.trialId}: session metrics unavailable (session not found/readable).`);
        }
      } catch (err) {
        trial.status = 'error';
        // Defense in depth: error text is structural in practice (fs/spawn
        // errors), but sanitize so no unexpected path can carry content.
        trial.error = sanitizeFreeText(err instanceof Error ? err.message : String(err), 300);
        trial.finishedAt = Date.now();
      }

      // Privacy: transient artifacts never persist.
      try {
        fs.unlinkSync(stdoutPath);
      } catch {
        /* already gone */
      }
      for (const check of record.benchmark.acceptance) {
        if (check.kind === 'test-command' || check.kind === 'command-succeeds') {
          try {
            fs.unlinkSync(path.join(scratch, `check-${check.id}.out`));
          } catch {
            /* already gone */
          }
        }
      }
      if (!opts.keepWorkspaces) removeWorkspace(workspace);
      else trial.workspaceKept = true;

      trial.finishedAt = Date.now();
      save();
    }
    record.status = 'completed';
    save();
  } finally {
    if (persist) {
      releaseRunLock(id);
      removeScratch(id);
      if (!opts.keepWorkspaces) {
        try {
          fs.rmSync(wsRoot, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    } else if (ephemeralBase) {
      try {
        fs.rmSync(ephemeralBase, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }

  return { record, comparison: compareExperiment(record), notices };
}
