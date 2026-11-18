/**
 * Claude Code execution backend (interface verified against 2.1.327
 * `claude --help`; LIVE EXECUTION NOT YET VERIFIED — marked unverified).
 *
 * argv: claude -p <prompt> --output-format json --session-id <uuid>
 *       --permission-mode bypassPermissions [--model model]
 *
 * SECURITY: bypassPermissions removes Claude's permission prompts. It is
 * used ONLY inside disposable trial workspaces and ONLY behind the explicit
 * --approve-inference gate. The transcript is written to the user's normal
 * Claude projects dir (Claude controls that); Havrin reads it read-only via
 * the existing session adapter and never retains conversation content.
 */
import type { ExecutionAdapter, ExecutionRequest, ExecutionOutcome } from './adapter.ts';
import { spawnControlled } from './adapter.ts';
import { whichSync } from '../../core/fs.ts';

export class ClaudeExecutionAdapter implements ExecutionAdapter {
  readonly agent = 'claude' as const;
  readonly verified = false;

  async execute(req: ExecutionRequest): Promise<ExecutionOutcome> {
    const binary = whichSync('claude');
    if (!binary) {
      return { status: 'error', durationMs: 0, error: 'claude binary not found on PATH' };
    }
    const argv = [
      binary,
      '-p', req.prompt,
      '--output-format', 'json',
      '--session-id', req.sessionId,
      '--permission-mode', 'bypassPermissions',
    ];
    if (req.config.model) argv.push('--model', req.config.model);

    const outcome = await spawnControlled(argv, {
      cwd: req.workspace,
      timeoutMs: req.timeoutMs,
      stdoutPath: req.stdoutPath,
    });
    const result: ExecutionOutcome = {
      status: outcome.timedOut ? 'timeout' : outcome.spawnError || outcome.exitCode !== 0 ? 'error' : 'completed',
      durationMs: outcome.durationMs,
      sessionId: req.sessionId,
    };
    if (outcome.exitCode !== null) result.exitCode = outcome.exitCode;
    if (outcome.spawnError) result.error = outcome.spawnError;
    else if (outcome.timedOut) result.error = `execution exceeded ${req.timeoutMs}ms and was terminated`;
    else if (outcome.exitCode !== 0) result.error = `claude exited with code ${outcome.exitCode}`;
    return result;
  }
}
