/**
 * Claude Code privacy contract: sentinels embedded in EVERY content-bearing
 * record type observed in real 2.1.x transcripts must never reach the
 * normalized record, report, artifact, or cache.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { runAudit } from '../src/audit.ts';
import { ClaudeAdapter } from '../src/adapters/claude.ts';
import {
  tempDir,
  cleanup,
  withEnv,
  writeClaudeTranscript,
  ccBase,
  ccAssistant,
  ccToolUse,
  ccCostState,
} from './helpers.ts';

const NOW = Date.now();
const SID = 'ffffffff-1111-2222-3333-444444444444';

const SENTINELS = [
  'CC-USER-TEXT-SECRET',
  'CC-ASSISTANT-TEXT-SECRET',
  'CC-THINKING-SECRET',
  'CC-TOOL-INPUT-SECRET',
  'CC-TOOL-OUTPUT-SECRET',
  'CC-STDOUT-SECRET',
  'CC-API-BLOB-SECRET',
  'CC-ATTACHMENT-SECRET',
  'CC-LAST-PROMPT-SECRET',
  'CC-QUEUE-SECRET',
  'CC-SNAPSHOT-SECRET',
  'CC-SUMMARY-SECRET',
  'CC-IDENTITY-SECRET',
  'CC-CREDENTIAL-TOKEN',
  'sk-ccsecretkey123456789',
  'CC-MCP-ENV-SECRET',
];

function setup() {
  const dir = tempDir();
  const home = path.join(dir, 'home');
  const claudeHome = path.join(home, '.claude');
  const project = path.join(dir, 'project');
  fs.mkdirSync(claudeHome, { recursive: true });
  fs.mkdirSync(project, { recursive: true });

  const at = (offset: number) => new Date(NOW - offset).toISOString();
  writeClaudeTranscript(claudeHome, '-fixture-project', SID, [
    ccBase('user', at(9000), { message: { role: 'user', content: 'CC-USER-TEXT-SECRET please help' } }),
    ccAssistant({
      messageId: 'msg_priv',
      at: at(8000),
      blocks: [
        { type: 'thinking', thinking: 'CC-THINKING-SECRET' },
        { type: 'text', text: 'CC-ASSISTANT-TEXT-SECRET' },
        ccToolUse('tu_1', 'Bash', { command: 'echo CC-TOOL-INPUT-SECRET' }),
        ccToolUse('tu_2', 'Write', { file_path: '/x.ts', content: 'CC-TOOL-INPUT-SECRET file body' }),
      ],
    }),
    ccBase('user', at(7000), {
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'CC-TOOL-OUTPUT-SECRET', is_error: true }] },
      toolUseResult: { stdout: 'CC-STDOUT-SECRET', stderr: 'CC-STDOUT-SECRET err', interrupted: false },
    }),
    ccBase('user', at(6500), {
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: 'ok' }] },
      toolUseResult: { stdout: 'CC-STDOUT-SECRET', structuredPatch: [{ lines: ['CC-TOOL-INPUT-SECRET'] }] },
    }),
    { type: 'api-request-blob', sessionId: SID, hash: 'h', message: { role: 'user', content: 'CC-API-BLOB-SECRET' } },
    { type: 'api-request', sessionId: SID, params: { prompt: 'CC-API-BLOB-SECRET' }, timestamp: at(6000) },
    ccBase('attachment', at(5500), { attachment: { type: 'hook', content: 'CC-ATTACHMENT-SECRET', stdout: 'CC-ATTACHMENT-SECRET', command: 'echo CC-ATTACHMENT-SECRET' } }),
    { type: 'last-prompt', sessionId: SID, lastPrompt: 'CC-LAST-PROMPT-SECRET', leafUuid: 'x' },
    { type: 'queue-operation', sessionId: SID, operation: 'enqueue', content: 'CC-QUEUE-SECRET', timestamp: at(5000) },
    { type: 'file-history-snapshot', messageId: 'm', snapshot: { files: { '/x.ts': 'CC-SNAPSHOT-SECRET' } }, isSnapshotUpdate: false },
    { type: 'summary', summary: 'CC-SUMMARY-SECRET', leafUuid: 'x' },
    { type: 'session-owner', sessionId: SID, accountUuid: 'CC-IDENTITY-SECRET', organizationUuid: 'CC-IDENTITY-SECRET' },
    { type: 'bridge-session', sessionId: SID, bridgeSessionId: 'b', ownerAccountUuid: 'CC-IDENTITY-SECRET', ownerOrganizationUuid: 'CC-IDENTITY-SECRET', lastSequenceNum: 1 },
    ccBase('system', at(4000), { subtype: 'local_command', content: 'CC-ATTACHMENT-SECRET', commandRun: { command: 'echo CC-TOOL-INPUT-SECRET', args: '' } }),
    ccCostState({ costUSD: 0.01 }),
  ]);

  // Credential stores that must NEVER be opened.
  fs.writeFileSync(path.join(claudeHome, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'CC-CREDENTIAL-TOKEN', refreshToken: 'CC-CREDENTIAL-TOKEN' } }));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { token: 'CC-CREDENTIAL-TOKEN' }, projects: {} }));
  // Config with a literal secret (structural scan only).
  fs.writeFileSync(path.join(claudeHome, 'settings.json'), JSON.stringify({ apiKey: 'sk-ccsecretkey123456789', env: { SAFE: 'ok' } }));
  // Project MCP config with a secret env value.
  fs.writeFileSync(path.join(project, '.mcp.json'), JSON.stringify({ mcpServers: { demo: { command: 'demo-mcp', env: { TOKEN: 'CC-MCP-ENV-SECRET' } } } }));

  return { dir, home, claudeHome, project };
}

function envFor(s: ReturnType<typeof setup>): Record<string, string | undefined> {
  return {
    HAVRIN_HOME: path.join(s.dir, 'state'),
    HAVRIN_CLAUDE_HOME: s.claudeHome,
    CLAUDE_CONFIG_DIR: undefined,
    HAVRIN_OPENCODE_DATA_DIR: path.join(s.dir, 'no-oc'),
    HAVRIN_OPENCODE_CONFIG_DIR: path.join(s.dir, 'no-oc-cfg'),
    HAVRIN_CODEX_HOME: path.join(s.dir, 'no-cx'),
    CODEX_HOME: undefined,
    HOME: s.home,
    USERPROFILE: s.home,
    XDG_CONFIG_HOME: path.join(s.home, '.config'),
  };
}

test('claude: normalized record contains no content sentinels', () => {
  const s = setup();
  withEnv(envFor(s), () => {
    const adapter = new ClaudeAdapter();
    const inst = adapter.detect();
    const metas = adapter.listSessions(inst);
    const record = adapter.readSession(inst, metas[0]!);
    const serialized = JSON.stringify(record);
    for (const sentinel of SENTINELS) {
      assert.ok(!serialized.includes(sentinel), `normalized record leaked: ${sentinel}`);
    }
    // But the diagnostic signal survives: the errored tool is still counted.
    const tools = record.events.flatMap((e) => (e.kind === 'assistant' ? e.tools : []));
    assert.equal(tools.filter((t) => t.status === 'error').length, 1);
    assert.equal(tools.find((t) => t.name === 'Bash')?.commandCategory, 'other');
  });
  cleanup(s.dir);
});

test('claude: full audit report, artifact, and cache contain no sentinels', () => {
  const s = setup();
  withEnv(envFor(s), () => {
    const { report } = runAudit({ sinceMs: 86_400_000, projectDir: s.project });
    assert.ok(report.coverage.sessionsAnalyzed >= 1);
    const serialized = JSON.stringify(report);
    for (const sentinel of SENTINELS) {
      assert.ok(!serialized.includes(sentinel), `report leaked: ${sentinel}`);
    }
    // Secret exposure is flagged structurally without the value.
    assert.ok(report.findings.some((f) => f.ruleId === 'plaintext-config-secrets'));
    // MCP server discovered from .mcp.json, env value not retained.
    assert.ok(report.environment.mcpServers.some((m) => m.agent === 'claude' && m.names.includes('demo')));

    const artifact = fs.readFileSync(path.join(s.dir, 'state', 'last-audit.json'), 'utf8');
    for (const sentinel of SENTINELS) {
      assert.ok(!artifact.includes(sentinel), `artifact leaked: ${sentinel}`);
    }
    const cacheDir = path.join(s.dir, 'state', 'cache');
    for (const f of fs.readdirSync(cacheDir)) {
      const cached = fs.readFileSync(path.join(cacheDir, f), 'utf8');
      for (const sentinel of SENTINELS) {
        assert.ok(!cached.includes(sentinel), `cache leaked: ${sentinel}`);
      }
    }
  });
  cleanup(s.dir);
});

test('claude: credential files remain untouched and unread into state', () => {
  const s = setup();
  const credPath = path.join(s.claudeHome, '.credentials.json');
  const globalPath = path.join(s.home, '.claude.json');
  const credBefore = fs.readFileSync(credPath);
  const globalBefore = fs.readFileSync(globalPath);
  withEnv(envFor(s), () => {
    runAudit({ sinceMs: 86_400_000, projectDir: s.project });
  });
  assert.ok(credBefore.equals(fs.readFileSync(credPath)));
  assert.ok(globalBefore.equals(fs.readFileSync(globalPath)));
  cleanup(s.dir);
});
