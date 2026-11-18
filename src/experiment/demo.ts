/**
 * Ephemeral experiment demo: a complete, real verification pipeline using
 * MOCK execution backends against the built-in fix-failing-test benchmark.
 * Nothing is persisted; no agent is invoked; no inference is paid for.
 *
 * The mock "baseline" completes but does not fix the bug (verification
 * honestly fails); the mock "candidate" applies the correct fix (verification
 * passes). This demonstrates execution success ≠ task success.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { ExperimentRecord, ExperimentComparison } from './types.ts';
import { materializeBuiltinTemplate, builtinBenchmark } from './builtin.ts';
import { createExperiment, runExperimentRecord } from './runner.ts';

export interface ExperimentDemoOutcome {
  record: ExperimentRecord;
  comparison: ExperimentComparison;
}

export async function runExperimentDemo(): Promise<ExperimentDemoOutcome> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'havrin-exp-demo-'));
  try {
    const templateDir = path.join(tmp, 'template');
    materializeBuiltinTemplate(templateDir);
    const spec = builtinBenchmark(templateDir);
    const specFile = path.join(tmp, 'benchmark.json');
    fs.writeFileSync(specFile, JSON.stringify(spec, null, 2));

    const buggy = fs.readFileSync(path.join(templateDir, 'src', 'price.js'), 'utf8');
    const fixed = buggy.replace('if (price > 100)', 'if (price >= 100)');

    const record = createExperiment({
      benchmarkRef: specFile,
      baseline: {
        id: 'baseline-slow',
        label: 'Baseline (mock, no fix)',
        agent: 'mock',
        mockBehavior: {
          durationMs: 250,
          outcome: 'success',
          edits: [],
          metrics: {
            tokens: { input: 42000, output: 3800, reasoning: 900, cacheRead: 180000, cacheWrite: 4000 },
            cost: 0.21,
            toolCalls: 14,
            toolErrors: 2,
          },
          variance: { durationJitterMs: 40 },
        },
      },
      candidates: [
        {
          id: 'candidate-fast',
          label: 'Candidate (mock, applies fix)',
          agent: 'mock',
          instructions: 'Diagnose before editing; verify with the test suite after every change.',
          mockBehavior: {
            durationMs: 120,
            outcome: 'success',
            edits: [{ path: 'src/price.js', content: fixed }],
            metrics: {
              tokens: { input: 26000, output: 2400, reasoning: 500, cacheRead: 120000, cacheWrite: 2500 },
              cost: 0.12,
              toolCalls: 9,
              toolErrors: 0,
            },
            variance: { durationJitterMs: 25 },
          },
        },
      ],
      trialsPerConfig: 3,
      orderSeed: 42,
      persist: false,
    });

    const outcome = await runExperimentRecord(record, { ephemeral: true });
    return { record: outcome.record, comparison: outcome.comparison };
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
