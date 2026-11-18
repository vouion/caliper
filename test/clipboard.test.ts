/**
 * Clipboard helper tests. Uses a fake clipboard utility on PATH (writes stdin
 * to a capture file) so the spawn + stdin delivery is verified without a real
 * display server or touching the user's clipboard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { detectClipboardTool, copyToClipboard } from '../src/optimize/clipboard.ts';
import { tempDir, cleanup, withEnv } from './helpers.ts';

function fakeTool(dir: string, capture: string): void {
  const fake = path.join(dir, 'wl-copy');
  fs.writeFileSync(fake, `#!/bin/sh\ncat > "${capture}"\n`);
  fs.chmodSync(fake, 0o755);
}

test('clipboard: detects a Wayland tool and delivers the full text via stdin', () => {
  const dir = tempDir();
  const capture = path.join(dir, 'captured.txt');
  fakeTool(dir, capture);
  withEnv({ PATH: `${dir}:${process.env['PATH'] ?? ''}`, WAYLAND_DISPLAY: 'wayland-0' }, () => {
    const tool = detectClipboardTool();
    assert.ok(tool);
    assert.equal(tool!.cmd, 'wl-copy');
    copyToClipboard('PROMPT-BODY-123\nline two');
    assert.equal(fs.readFileSync(capture, 'utf8'), 'PROMPT-BODY-123\nline two');
  });
  cleanup(dir);
});

test('clipboard: clear error when no utility is available', () => {
  const dir = tempDir();
  withEnv({ PATH: dir, WAYLAND_DISPLAY: undefined }, () => {
    assert.equal(detectClipboardTool(), undefined);
    assert.throws(() => copyToClipboard('x'), /No clipboard utility/);
  });
  cleanup(dir);
});
