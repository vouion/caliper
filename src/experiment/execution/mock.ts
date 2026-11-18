/**
 * Mock execution backend: deterministic, zero-cost, zero-risk.
 * Used by all automated tests and `havrin experiment demo`.
 * Simulates edits, outcomes, timing, and content-free session metrics.
 */
import path from 'node:path';
import fs from 'node:fs';
import { sha256 } from '../../core/util.ts';
import type { ExecutionAdapter, ExecutionRequest, ExecutionOutcome } from './adapter.ts';

export class MockExecutionAdapter implements ExecutionAdapter {
  readonly agent = 'mock' as const;
  readonly verified = true;

  async execute(req: ExecutionRequest): Promise<ExecutionOutcome> {
    const behavior = req.config.mockBehavior;
    if (!behavior) {
      return { status: 'error', durationMs: 0, error: 'mock config missing mockBehavior' };
    }
    const start = performance.now();
    // Deterministic per-session jitter (stable for a given session id).
    let duration = behavior.durationMs;
    const jitter = behavior.variance?.durationJitterMs ?? 0;
    if (jitter > 0) {
      const h = sha256(req.sessionId || req.runLabel);
      const n = parseInt(h.slice(0, 8), 16);
      duration += (n % (2 * jitter + 1)) - jitter;
    }
    // Simulated work time (real timer so timeout semantics are exercised).
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(duration, 5000))));

    if (behavior.outcome === 'timeout') {
      return { status: 'timeout', durationMs: Math.round(performance.now() - start), sessionId: req.sessionId };
    }
    if (behavior.outcome === 'error') {
      return { status: 'error', durationMs: Math.round(performance.now() - start), error: 'simulated execution failure', sessionId: req.sessionId };
    }

    // Apply simulated edits (relative paths only; validated at create time).
    for (const edit of behavior.edits ?? []) {
      const target = path.join(req.workspace, edit.path);
      const rel = path.relative(req.workspace, target);
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue; // defense in depth
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, edit.content);
    }

    return {
      status: 'completed',
      exitCode: behavior.outcome === 'success' ? 0 : 1,
      durationMs: Math.round(performance.now() - start),
      sessionId: req.sessionId,
    };
  }
}
