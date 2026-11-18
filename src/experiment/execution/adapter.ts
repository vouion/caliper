/**
 * Experiment EXECUTION adapters — distinct from session-reading adapters.
 * Session adapters observe history; execution adapters run agents headlessly
 * inside isolated trial workspaces under explicit user approval.
 *
 * Safety contract:
 * - Fixed argv, never a shell string.
 * - Hard timeout with process-group termination (SIGTERM → SIGKILL grace).
 * - stdout/stderr streamed to a transient capped file, never retained in
 *   memory or persisted by the registry (privacy).
 * - Real-agent execution requires explicit --approve-inference at the CLI.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { ExecutionAgent, ExperimentConfig } from '../types.ts';

export interface ExecutionRequest {
  workspace: string;
  /** Full prompt (instructions variant + task). */
  prompt: string;
  config: ExperimentConfig;
  timeoutMs: number;
  /** Pre-generated session id for agents that support caller-chosen ids. */
  sessionId: string;
  /** Human-readable run label (used as session title where supported). */
  runLabel: string;
  /** Transient stdout artifact path; deleted by the runner after parsing. */
  stdoutPath: string;
  /** Epoch ms before which the session cannot have started (discovery aid). */
  startedAt: number;
}

export interface ExecutionOutcome {
  status: 'completed' | 'timeout' | 'error';
  exitCode?: number;
  durationMs: number;
  /** Session id when known/provided; metrics discovery verifies it. */
  sessionId?: string;
  error?: string;
}

export interface ExecutionAdapter {
  readonly agent: ExecutionAgent;
  /** Whether this backend has been verified against a real install. */
  readonly verified: boolean;
  execute(req: ExecutionRequest): Promise<ExecutionOutcome>;
}

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const KILL_GRACE_MS = 5000;

export interface SpawnOutcome {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  spawnError?: string;
}

/**
 * Spawn a controlled subprocess: fixed argv, no shell, hard timeout,
 * process-group kill, capped output streaming to a transient file.
 */
export function spawnControlled(
  argv: string[],
  opts: { cwd: string; timeoutMs: number; stdoutPath?: string },
): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    const start = performance.now();
    const [cmd, ...args] = argv;
    if (!cmd) {
      resolve({ exitCode: null, signal: null, timedOut: false, durationMs: 0, spawnError: 'empty argv' });
      return;
    }
    let out: fs.WriteStream | undefined;
    let written = 0;
    if (opts.stdoutPath) {
      out = fs.createWriteStream(opts.stdoutPath, { flags: 'w' });
    }
    // Strip test-runner context so nested `node --test` verification runs
    // behave as standalone processes when Havrin itself runs under node:test.
    const env = { ...process.env };
    delete env['NODE_TEST_CONTEXT'];
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      // New process group so timeouts can terminate the whole tree.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (outcome: SpawnOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      out?.end();
      resolve(outcome);
    };

    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (process.platform === 'win32' || child.pid === undefined) {
          child.kill(signal);
        } else {
          process.kill(-child.pid, signal);
        }
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* already dead */
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup('SIGTERM');
      killTimer = setTimeout(() => killGroup('SIGKILL'), KILL_GRACE_MS);
    }, opts.timeoutMs);

    const capture = (chunk: Buffer) => {
      if (!out || written >= MAX_OUTPUT_BYTES) return;
      const allowed = Math.min(chunk.length, MAX_OUTPUT_BYTES - written);
      out.write(chunk.subarray(0, allowed));
      written += allowed;
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    child.stdout?.on('error', () => {});
    child.stderr?.on('error', () => {});
    out?.on('error', () => {});

    child.on('error', (err) => {
      finish({
        exitCode: null,
        signal: null,
        timedOut,
        durationMs: Math.round(performance.now() - start),
        spawnError: err.message,
      });
    });
    child.on('close', (code, signal) => {
      finish({
        exitCode: code,
        signal: signal ?? null,
        timedOut,
        durationMs: Math.round(performance.now() - start),
      });
    });
  });
}

/** Build the full prompt from a config's instruction variant + task. */
export function buildPrompt(config: ExperimentConfig, taskPrompt: string): string {
  if (config.instructions && config.instructions.trim().length > 0) {
    return `${config.instructions.trim()}\n\n---\n\n${taskPrompt}`;
  }
  return taskPrompt;
}
