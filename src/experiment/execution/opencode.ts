/**
 * OpenCode execution backend (PRIMARY, interface verified against v2.3.1
 * `opencode run --help`; live paid runs require explicit user approval).
 *
 * argv: opencode run <prompt> --format json --session <id> --title <label>
 *       --archived --auto --standalone [--model provider/model] [--agent name]
 *
 * --session creates the session with our chosen id when it does not exist,
 * which lets the existing OpenCode SESSION adapter ingest metrics afterwards
 * (reuse, not duplication). --archived keeps experiment sessions out of the
 * user's normal session list. --auto auto-approves permissions inside the
 * isolated trial workspace; this is why real runs are approval-gated.
 *
 * No agent configuration files are read or modified by this adapter.
 */
import type { ExecutionAdapter, ExecutionRequest, ExecutionOutcome } from './adapter.ts';
import { spawnControlled } from './adapter.ts';
import { whichSync } from '../../core/fs.ts';

export class OpenCodeExecutionAdapter implements ExecutionAdapter {
  readonly agent = 'opencode' as const;
  readonly verified = true;

  async execute(req: ExecutionRequest): Promise<ExecutionOutcome> {
    const binary = whichSync('opencode');
    if (!binary) {
      return { status: 'error', durationMs: 0, error: 'opencode binary not found on PATH' };
    }
    const argv = [
      binary,
      'run',
      req.prompt,
      '--format', 'json',
      '--session', req.sessionId,
      '--title', req.runLabel,
      '--archived',
      '--auto',
      '--standalone',
    ];
    if (req.config.model) argv.push('--model', req.config.model);
    if (req.config.agentName) argv.push('--agent', req.config.agentName);

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
    else if (outcome.exitCode !== 0) result.error = `opencode exited with code ${outcome.exitCode}`;
    return result;
  }
}
