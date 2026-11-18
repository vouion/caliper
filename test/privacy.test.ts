/**
 * Privacy contract tests: reports must never contain user message text,
 * tool output content, credentials from any source, or raw tool input.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { runAudit } from '../src/audit.ts';
import { buildFixPrompt } from '../src/optimize/prompt.ts';
import {
  tempDir,
  cleanup,
  createOpencodeFixture,
  insertFixtureSession,
  insertFixtureMessage,
  assistantData,
  toolPart,
  writeCodexRollout,
  codexLine,
  sessionMetaPayload,
  withEnv,
} from './helpers.ts';

const NOW = Date.now();
const SECRETS = [
  'SUPER-SECRET-ACCESS-TOKEN',
  'SUPER-SECRET-REFRESH',
  'sk-user-secret-key-99999',
  'ghp_usersupersecrettoken1234567890',
  'USER-PRIVATE-MESSAGE-CONTENT',
  'TOOL-OUTPUT-SENSITIVE-DATA',
  'RAW-TOOL-INPUT-SECRET',
];

function setup() {
  const dir = tempDir();
  const home = path.join(dir, 'home');
  const dataDir = path.join(dir, 'opencode-data');
  const ocConfig = path.join(home, '.config', 'opencode');
  const codexHome = path.join(home, '.codex');
  fs.mkdirSync(ocConfig, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });

  const db = createOpencodeFixture(dataDir);
  insertFixtureSession(db, { id: 'ses_priv', createdAt: NOW - 1000, updatedAt: NOW, title: 'Privacy fixture' });
  insertFixtureMessage(db, 'ses_priv', 'user', { time: { created: NOW - 900 }, text: 'USER-PRIVATE-MESSAGE-CONTENT please use sk-user-secret-key-99999', files: [] }, NOW - 900);
  insertFixtureMessage(
    db,
    'ses_priv',
    'assistant',
    assistantData({
      at: NOW - 800,
      text: 'assistant reply with ghp_usersupersecrettoken1234567890',
      tools: [
        toolPart({ name: 'shell', input: { command: 'echo RAW-TOOL-INPUT-SECRET' }, at: NOW - 800 }),
        toolPart({
          name: 'edit',
          input: { path: '/x.ts', oldString: 'RAW-TOOL-INPUT-SECRET', newString: 'y' },
          status: 'error',
          error: { type: 'tool.execution', message: 'failed echoing sk-user-secret-key-99999 in /x.ts' },
          at: NOW - 700,
        }),
      ],
    }),
    NOW - 800,
  );
  db.close();

  // Config with a literal secret.
  fs.writeFileSync(path.join(ocConfig, 'opencode.json'), JSON.stringify({ provider: { x: { options: { apiKey: 'sk-user-secret-key-99999' } } } }));

  // Codex rollout with sensitive output text.
  const sid = '01a1priv-0000-0000-0000-000000000001';
  writeCodexRollout(codexHome, sid, [
    codexLine('session_meta', sessionMetaPayload(sid)),
    codexLine('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'USER-PRIVATE-MESSAGE-CONTENT' }] }, new Date(NOW - 500).toISOString()),
    codexLine('response_item', { type: 'custom_tool_call', call_id: 'c1', name: 'exec', input: 'echo RAW-TOOL-INPUT-SECRET', status: 'completed' }, new Date(NOW - 400).toISOString()),
    codexLine('response_item', { type: 'custom_tool_call_output', call_id: 'c1', output: 'TOOL-OUTPUT-SENSITIVE-DATA exit_code:0' }, new Date(NOW - 300).toISOString()),
    codexLine('response_item', { type: 'custom_tool_call', call_id: 'c2', name: 'exec', input: 'node fail.js', status: 'completed' }, new Date(NOW - 250).toISOString()),
    codexLine('response_item', { type: 'custom_tool_call_output', call_id: 'c2', output: 'Error: TOOL-OUTPUT-SENSITIVE-DATA\n"exit_code":1' }, new Date(NOW - 200).toISOString()),
  ]);

  return { dir, home, dataDir, ocConfig, codexHome };
}

test('audit report contains no secrets, user text, tool output, or raw input', () => {
  const s = setup();
  withEnv(
    {
      CALIPER_HOME: path.join(s.dir, 'caliper-state'),
      CALIPER_OPENCODE_DATA_DIR: s.dataDir,
      CALIPER_OPENCODE_CONFIG_DIR: s.ocConfig,
      CALIPER_CODEX_HOME: s.codexHome,
      CALIPER_CLAUDE_HOME: path.join(s.dir, 'no-claude'),
      CODEX_HOME: undefined,
      CLAUDE_CONFIG_DIR: undefined,
      HOME: s.home,
      USERPROFILE: s.home,
      XDG_CONFIG_HOME: path.join(s.home, '.config'),
    },
    () => {
      const { report } = runAudit({ sinceMs: 86_400_000 });
      assert.ok(report.coverage.sessionsAnalyzed >= 2);
      const serialized = JSON.stringify(report);
      for (const secret of SECRETS) {
        assert.ok(!serialized.includes(secret), `report leaked: ${secret}`);
      }
      // The sanitized tool error message may appear, but redacted.
      assert.ok(!serialized.includes('sk-user-secret-key-99999'));
      // Persisted artifact obeys the same contract.
      const artifact = fs.readFileSync(path.join(s.dir, 'caliper-state', 'last-audit.json'), 'utf8');
      for (const secret of SECRETS) {
        assert.ok(!artifact.includes(secret), `artifact leaked: ${secret}`);
      }
      // Cache obeys the same contract.
      for (const f of fs.readdirSync(path.join(s.dir, 'caliper-state', 'cache'))) {
        const cached = fs.readFileSync(path.join(s.dir, 'caliper-state', 'cache', f), 'utf8');
        for (const secret of SECRETS) {
          assert.ok(!cached.includes(secret), `cache leaked: ${secret}`);
        }
      }
    },
  );
  cleanup(s.dir);
});

test('state files are written with restrictive permissions', () => {
  const s = setup();
  withEnv(
    {
      CALIPER_HOME: path.join(s.dir, 'caliper-state'),
      CALIPER_OPENCODE_DATA_DIR: s.dataDir,
      CALIPER_OPENCODE_CONFIG_DIR: s.ocConfig,
      CALIPER_CODEX_HOME: s.codexHome,
      CALIPER_CLAUDE_HOME: path.join(s.dir, 'no-claude'),
      CODEX_HOME: undefined,
      CLAUDE_CONFIG_DIR: undefined,
      HOME: s.home,
      USERPROFILE: s.home,
      XDG_CONFIG_HOME: path.join(s.home, '.config'),
    },
    () => {
      runAudit({ sinceMs: 86_400_000 });
      const mode = fs.statSync(path.join(s.dir, 'caliper-state', 'last-audit.json')).mode & 0o777;
      assert.equal(mode, 0o600);
    },
  );
  cleanup(s.dir);
});

test('fix prompt contains no secrets, user text, tool output, or raw input', () => {
  const s = setup();
  withEnv(
    {
      CALIPER_HOME: path.join(s.dir, 'caliper-state'),
      CALIPER_OPENCODE_DATA_DIR: s.dataDir,
      CALIPER_OPENCODE_CONFIG_DIR: s.ocConfig,
      CALIPER_CODEX_HOME: s.codexHome,
      CALIPER_CLAUDE_HOME: path.join(s.dir, 'no-claude'),
      CODEX_HOME: undefined,
      CLAUDE_CONFIG_DIR: undefined,
      HOME: s.home,
      USERPROFILE: s.home,
      XDG_CONFIG_HOME: path.join(s.home, '.config'),
    },
    () => {
      const { report } = runAudit({ sinceMs: 86_400_000 });
      assert.ok(report.recommendations.length > 0);
      // The generated prompt (default + every agent tailoring) must obey the
      // same content-free contract as the report itself.
      for (const agent of ['generic', 'opencode', 'codex', 'claude'] as const) {
        const prompt = buildFixPrompt(report, { agent });
        for (const secret of SECRETS) {
          assert.ok(!prompt.includes(secret), `prompt (${agent}) leaked: ${secret}`);
        }
      }
    },
  );
  cleanup(s.dir);
});
