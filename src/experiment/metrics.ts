/**
 * Measurement system.
 *
 * Correctness is evaluated by CALIPER running deterministic acceptance checks
 * in the trial workspace AFTER the agent finishes — never by the agent's own
 * claims, never by an LLM judge. Session metrics are collected by reusing the
 * existing content-free session adapters (no duplicated ingestion logic).
 *
 * Availability contract: null = unavailable, never zero.
 */
import path from 'node:path';
import fs from 'node:fs';
import type { AcceptanceCheck, AcceptanceResult, BenchmarkSpec, TestStats, TrialResult, ExecutionAgent } from './types.ts';
import { spawnControlled } from './execution/adapter.ts';
import { sha256 } from '../core/util.ts';
import { OpenCodeAdapter } from '../adapters/opencode.ts';
import { CodexAdapter } from '../adapters/codex.ts';
import { ClaudeAdapter } from '../adapters/claude.ts';
import { sessionTokens, sessionCost, toolStats, countEvents } from '../core/session.ts';
import type { SessionRecord } from '../core/types.ts';

const DEFAULT_CHECK_TIMEOUT_MS = 60_000;

/** Run a benchmark command inside the workspace via the platform shell. */
async function runCheckCommand(
  command: string,
  workspace: string,
  timeoutMs: number,
  stdoutPath: string,
): Promise<{ exitCode: number | null; timedOut: boolean }> {
  // Benchmark commands are user-authored definitions (trusted local input),
  // passed as a single argv element — Caliper never interpolates into them.
  const argv =
    process.platform === 'win32'
      ? ['cmd.exe', '/d', '/s', '/c', command]
      : ['/bin/sh', '-c', command];
  const outcome = await spawnControlled(argv, { cwd: workspace, timeoutMs, stdoutPath });
  return { exitCode: outcome.exitCode, timedOut: outcome.timedOut };
}

/** Best-effort structural test counts from common reporters. Never output text. */
export function parseTestStats(stdoutPath: string, exitCode: number | null): TestStats | null {
  let text: string;
  try {
    text = fs.readFileSync(stdoutPath, 'utf8').slice(0, 256 * 1024);
  } catch {
    return exitCode === null ? null : { passed: 0, failed: 0, total: 0, source: 'exit-code-only' };
  }
  // node:test spec reporter (ℹ pass N / ℹ fail N) and TAP (# pass N / # fail N)
  const specPass = /ℹ pass (\d+)/.exec(text);
  const specFail = /ℹ fail (\d+)/.exec(text);
  const tapPass = /^# pass (\d+)/m.exec(text);
  const tapFail = /^# fail (\d+)/m.exec(text);
  const pass = specPass ?? tapPass;
  const fail = specFail ?? tapFail;
  if (pass && fail) {
    const passed = Number(pass[1]);
    const failed = Number(fail[1]);
    return { passed, failed, total: passed + failed, source: 'node-test-tap' };
  }
  // pytest summary: "N passed", "N failed"
  const pyPass = /(\d+) passed/.exec(text);
  const pyFail = /(\d+) failed/.exec(text);
  if (pyPass || pyFail) {
    const passed = pyPass ? Number(pyPass[1]) : 0;
    const failed = pyFail ? Number(pyFail[1]) : 0;
    return { passed, failed, total: passed + failed, source: 'pytest' };
  }
  return { passed: 0, failed: 0, total: 0, source: 'exit-code-only' };
}

function insideWorkspace(workspace: string, rel: string): string | undefined {
  const target = path.resolve(workspace, rel);
  const relCheck = path.relative(workspace, target);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) return undefined;
  return target;
}

export interface VerificationOutcome {
  success: boolean;
  checks: AcceptanceResult[];
  testStats: TestStats | null;
  durationMs: number;
}

/** Run all acceptance checks deterministically in the trial workspace. */
export async function runVerification(
  spec: BenchmarkSpec,
  workspace: string,
  scratchDir: string,
): Promise<VerificationOutcome> {
  const start = performance.now();
  const checks: AcceptanceResult[] = [];
  let testStats: TestStats | null = null;

  for (const check of spec.acceptance) {
    const result = await runCheck(check, workspace, scratchDir);
    checks.push(result);
    if (check.kind === 'test-command' && result.detail?.startsWith('exit=')) {
      const statsFile = path.join(scratchDir, `check-${check.id}.out`);
      const exit = Number(result.detail.slice(5));
      const stats = parseTestStats(statsFile, Number.isFinite(exit) ? exit : null);
      if (stats && stats.source !== 'exit-code-only') testStats = stats;
      else if (!testStats && stats) testStats = stats;
    }
  }
  return {
    success: checks.every((c) => c.passed),
    checks,
    testStats,
    durationMs: Math.round(performance.now() - start),
  };
}

async function runCheck(check: AcceptanceCheck, workspace: string, scratchDir: string): Promise<AcceptanceResult> {
  const base = { id: check.id, description: check.description };
  try {
    switch (check.kind) {
      case 'file-exists': {
        const target = insideWorkspace(workspace, check.path);
        const ok = target !== undefined && fs.existsSync(target);
        return { ...base, passed: ok, detail: ok ? 'present' : 'missing-or-escaped-workspace' };
      }
      case 'file-hash': {
        const target = insideWorkspace(workspace, check.path);
        if (target === undefined || !fs.existsSync(target)) {
          return { ...base, passed: false, detail: 'missing-or-escaped-workspace' };
        }
        const actual = sha256(fs.readFileSync(target, 'utf8'));
        const ok = actual === check.sha256;
        return { ...base, passed: ok, detail: ok ? 'hash-match' : 'hash-mismatch' };
      }
      case 'test-command':
      case 'command-succeeds': {
        const stdoutPath = path.join(scratchDir, `check-${check.id}.out`);
        const { exitCode, timedOut } = await runCheckCommand(
          check.command,
          workspace,
          check.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
          stdoutPath,
        );
        const ok = !timedOut && exitCode === 0;
        return { ...base, passed: ok, detail: `exit=${timedOut ? 'timeout' : exitCode}` };
      }
      default:
        return { ...base, passed: false, detail: 'unknown-check-kind' };
    }
  } catch {
    return { ...base, passed: false, detail: 'check-error' };
  }
}

type SessionMetrics = NonNullable<TrialResult['sessionMetrics']>;

function metricsFromRecord(record: SessionRecord): SessionMetrics {
  const stats = toolStats(record);
  let retries = 0;
  let sawCost = record.reportedCost !== undefined;
  for (const ev of record.events) {
    if (ev.kind === 'assistant') {
      retries += ev.retries ?? 0;
      if (ev.cost !== undefined) sawCost = true;
    } else if (ev.kind === 'compaction' && ev.cost !== undefined) {
      sawCost = true;
    }
  }
  return {
    tokens: sessionTokens(record),
    cost: sawCost ? sessionCost(record) : null,
    toolCalls: stats.calls,
    toolErrors: stats.errors,
    retries,
    compactions: countEvents(record, 'compaction'),
    userTurns: countEvents(record, 'user'),
    assistantTurns: countEvents(record, 'assistant'),
  };
}

/**
 * Collect content-free session metrics via the existing session adapters.
 * Returns null when the session cannot be found/read (unavailable ≠ zero).
 */
export function collectSessionMetrics(
  agent: ExecutionAgent,
  sessionId: string | undefined,
  workspace: string,
  startedAt: number,
): SessionMetrics | null {
  if (agent === 'mock') return null; // runner uses mockBehavior metrics directly
  try {
    if (agent === 'opencode') {
      if (!sessionId) return null;
      const adapter = new OpenCodeAdapter();
      const inst = adapter.detect();
      if (inst.layout !== 'sqlite-v2') return null;
      const record = adapter.readSession(inst, { id: sessionId, createdAt: startedAt, updatedAt: startedAt, signature: 'experiment' });
      return metricsFromRecord(record);
    }
    if (agent === 'claude') {
      if (!sessionId) return null;
      const adapter = new ClaudeAdapter();
      const inst = adapter.detect();
      if (inst.layout !== 'jsonl-projects') return null;
      const record = adapter.readSession(inst, { id: sessionId, createdAt: startedAt, updatedAt: startedAt, signature: 'experiment' });
      return metricsFromRecord(record);
    }
    // codex: session id is agent-chosen; discover by cwd + start time.
    const adapter = new CodexAdapter();
    const inst = adapter.detect();
    if (inst.layout !== 'jsonl-rollout') return null;
    const metas = adapter
      .listSessions(inst)
      .filter((m) => m.directory === workspace && m.updatedAt >= startedAt - 1000);
    const meta = metas[0];
    if (!meta) return null;
    return metricsFromRecord(adapter.readSession(inst, meta));
  } catch {
    return null;
  }
}
