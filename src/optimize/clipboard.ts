/**
 * Clipboard copy for generated prompts (caliper prompt --copy).
 *
 * Security review (new subprocess surface): this spawns a trusted system
 * clipboard utility with FIXED argv (no shell, no interpolation), delivers the
 * prompt via stdin, bounds execution with a timeout, and retains no output.
 * The prompt goes only to the local clipboard — never to the network. The
 * prompt itself is content-free (metrics/paths/evidence; session titles are the
 * disclosed free-text exception). Detection uses the existing fixed-argv PATH
 * lookup (whichSync), not a shell probe.
 */
import { spawnSync } from 'node:child_process';
import { whichSync } from '../core/fs.ts';
import { CaliperError } from '../core/errors.ts';

export interface ClipboardTool {
  cmd: string;
  args: string[];
}

/** Detect an available clipboard utility, preferring the active display server. */
export function detectClipboardTool(): ClipboardTool | undefined {
  if (process.platform === 'darwin') {
    return whichSync('pbcopy') ? { cmd: 'pbcopy', args: [] } : undefined;
  }
  if (process.env['WAYLAND_DISPLAY'] && whichSync('wl-copy')) return { cmd: 'wl-copy', args: [] };
  if (whichSync('xclip')) return { cmd: 'xclip', args: ['-selection', 'clipboard'] };
  if (whichSync('xsel')) return { cmd: 'xsel', args: ['--clipboard', '--input'] };
  if (whichSync('wl-copy')) return { cmd: 'wl-copy', args: [] };
  return undefined;
}

/** Copy text to the system clipboard. Throws a clear error if unavailable. */
export function copyToClipboard(text: string): void {
  const tool = detectClipboardTool();
  if (!tool) {
    throw new CaliperError(
      'UNSUPPORTED',
      'No clipboard utility found.',
      'Install wl-clipboard (Wayland) or xclip/xsel (X11), or use --output <file> instead.',
    );
  }
  const res = spawnSync(tool.cmd, tool.args, { input: text, timeout: 5000, encoding: 'utf8' });
  if (res.error) {
    throw new CaliperError('IO', `Clipboard copy failed: ${res.error.message}`, 'Use --output <file> instead.');
  }
  if (res.status !== 0) {
    throw new CaliperError('IO', `Clipboard utility exited with code ${res.status}.`, 'Use --output <file> instead.');
  }
}
