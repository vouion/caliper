/**
 * Codex execution backend (interface verified against codex-cli 0.169.1
 * `codex exec --help`; LIVE EXECUTION NOT YET VERIFIED — marked unverified).
 *
 * argv: codex exec <prompt> -s workspace-write -C <workspace> --json
 *       --skip-git-repo-check [-m model]
 *
 * workspace-write sandbox confines agent writes to the trial workspace.
 * Session id is chosen by Codex; metrics discovery finds the rollout by
 * cwd + start time afterwards.
 */
import type { ExecutionAdapter, ExecutionRequest, ExecutionOutcome } from './adapter.ts';
import { spawnControlled } from './adapter.ts';
import { whichSync } from '../../core/fs.ts';

export class CodexExecutionAdapter implements ExecutionAdapter {
  readonly agent = 'codex' as const;
  readonly verified = false;

  async execute(req: ExecutionRequest): Promise<ExecutionOutcome> {
    const binary = whichSync('codex');
    if (!binary) {
      return { status: 'error', durationMs: 0, error: 'codex binary not found on PATH' };
    }
    const argv = [
      binary,
      'exec',
      req.prompt,
      '-s', 'workspace-write',
      '-C', req.workspace,
      '--json',
      '--skip-git-repo-check',
    ];
    if (req.config.model) argv.push('-m', req.config.model);

    const outcome = await spawnControlled(argv, {
      cwd: req.workspace,
      timeoutMs: req.timeoutMs,
      stdoutPath: req.stdoutPath,
    });
    const result: ExecutionOutcome = {
      status: outcome.timedOut ? 'timeout' : outcome.spawnError || outcome.exitCode !== 0 ? 'error' : 'completed',
      durationMs: outcome.durationMs,
    };
    if (outcome.exitCode !== null) result.exitCode = outcome.exitCode;
    if (outcome.spawnError) result.error = outcome.spawnError;
    else if (outcome.timedOut) result.error = `execution exceeded ${req.timeoutMs}ms and was terminated`;
    else if (outcome.exitCode !== 0) result.error = `codex exited with code ${outcome.exitCode}`;
    return result;
  }
}
