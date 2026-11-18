/**
 * Synthetic demonstration dataset.
 *
 * Clearly labeled, fully fabricated sessions that exercise every
 * diagnostic rule, so new users can experience Caliper without importing
 * personal session data. Demo audits never touch the real cache or the
 * last-audit artifact.
 */
import type {
  AuditCoverage,
  AuditReport,
  EnvironmentInfo,
  SessionEvent,
  SessionRecord,
  ToolCall,
} from '../core/types.ts';
import { fingerprint } from '../core/util.ts';
import { classifyCommand } from '../core/classify.ts';
import { assembleReport } from '../report/assemble.ts';

const BASE = Date.UTC(2026, 0, 15, 9, 0, 0);
const MIN = 60_000;

function tool(partial: Partial<ToolCall> & { name: string; input: unknown }): ToolCall {
  const t: ToolCall = {
    name: partial.name,
    status: partial.status ?? 'completed',
    statusSource: partial.statusSource ?? 'reported',
    inputFingerprint: fingerprint(partial.input),
  };
  if (partial.targetPath) t.targetPath = partial.targetPath;
  if (partial.commandCategory) t.commandCategory = partial.commandCategory;
  if (partial.errorType) t.errorType = partial.errorType;
  if (partial.errorMessage) t.errorMessage = partial.errorMessage;
  return t;
}

function shell(command: string, status: ToolCall['status'] = 'completed'): ToolCall {
  return tool({ name: 'shell', input: { command }, commandCategory: classifyCommand(command), status });
}

function assistant(at: number, id: string, tools: ToolCall[], tokens = { input: 1200, output: 400, reasoning: 100, cacheRead: 8000, cacheWrite: 200 }): SessionEvent {
  return { kind: 'assistant', at, id, tools, textChars: 300, reasoningChars: 150, tokens, cost: 0.004, model: { provider: 'demo-provider', model: 'demo-model' } };
}

function user(at: number, id: string): SessionEvent {
  return { kind: 'user', at, id, textChars: 80, fileCount: 0 };
}

function session(args: {
  agent: 'opencode' | 'codex' | 'claude';
  id: string;
  title: string;
  start: number;
  events: SessionEvent[];
}): SessionRecord {
  const end = args.start + args.events.length * MIN;
  return {
    agent: args.agent,
    id: args.id,
    title: args.title,
    directory: '/demo/project',
    createdAt: args.start,
    updatedAt: end,
    model: { provider: 'demo-provider', model: 'demo-model' },
    events: args.events,
    partial: false,
    parseWarnings: [],
    source: { kind: args.agent === 'opencode' ? 'sqlite' : 'jsonl', location: 'synthetic-demo', signature: 'demo', version: 'demo' },
  };
}

export function demoSessions(): SessionRecord[] {
  const sessions: SessionRecord[] = [];

  // 1. Stuck edit loop: 5 identical failing edits (repeated-tool-failures high,
  //    retry-loops).
  {
    const failingInput = { path: '/demo/project/src/config.ts', oldString: 'timeout: 30', newString: 'timeout: 60' };
    const events: SessionEvent[] = [user(BASE, 'demo-u1')];
    for (let i = 0; i < 5; i++) {
      events.push(
        assistant(BASE + (i + 1) * MIN, `demo-a${i}`, [
          tool({
            name: 'edit',
            input: failingInput,
            status: 'error',
            targetPath: '/demo/project/src/config.ts',
            errorType: 'tool.execution',
            errorMessage: 'Could not find oldString in /demo/project/src/config.ts. It must match exactly.',
          }),
        ]),
      );
    }
    sessions.push(session({ agent: 'opencode', id: 'demo-oc-stuck-edit', title: 'Demo: stuck edit loop', start: BASE, events }));
  }

  // 2. Re-read churn + compaction pressure.
  {
    const events: SessionEvent[] = [user(BASE + 60 * MIN, 'demo-u2')];
    for (let i = 0; i < 4; i++) {
      events.push(
        assistant(BASE + (61 + i) * MIN, `demo-b${i}`, [
          tool({ name: 'read', input: { path: '/demo/project/src/server.ts' }, targetPath: '/demo/project/src/server.ts' }),
        ]),
      );
    }
    events.push({ kind: 'compaction', at: BASE + 66 * MIN, reason: 'auto' });
    events.push(assistant(BASE + 67 * MIN, 'demo-b4', [shell('grep -n "listen" src/server.ts')]));
    events.push({ kind: 'compaction', at: BASE + 68 * MIN, reason: 'auto' });
    sessions.push(session({ agent: 'opencode', id: 'demo-oc-reread', title: 'Demo: re-read churn', start: BASE + 60 * MIN, events }));
  }

  // 3. Unverified refactor: 4 completed writes, zero test commands.
  {
    const events: SessionEvent[] = [
      user(BASE + 120 * MIN, 'demo-u3'),
      assistant(BASE + 121 * MIN, 'demo-c0', [
        tool({ name: 'edit', input: { path: '/demo/project/src/a.ts', oldString: 'a', newString: 'b' }, targetPath: '/demo/project/src/a.ts' }),
        tool({ name: 'edit', input: { path: '/demo/project/src/b.ts', oldString: 'a', newString: 'b' }, targetPath: '/demo/project/src/b.ts' }),
      ]),
      assistant(BASE + 122 * MIN, 'demo-c1', [
        tool({ name: 'write', input: { path: '/demo/project/src/c.ts', content: 'export const c = 1;' }, targetPath: '/demo/project/src/c.ts' }),
        shell('npm run build'),
      ]),
      assistant(BASE + 123 * MIN, 'demo-c2', [
        tool({ name: 'edit', input: { path: '/demo/project/src/d.ts', oldString: 'x', newString: 'y' }, targetPath: '/demo/project/src/d.ts' }),
        shell('git status'),
      ]),
    ];
    sessions.push(session({ agent: 'opencode', id: 'demo-oc-unverified', title: 'Demo: unverified refactor', start: BASE + 120 * MIN, events }));
  }

  // 4. Healthy baseline: reads, one edit, tests run.
  {
    const events: SessionEvent[] = [
      user(BASE + 180 * MIN, 'demo-u4'),
      assistant(BASE + 181 * MIN, 'demo-d0', [
        tool({ name: 'read', input: { path: '/demo/project/src/util.ts' }, targetPath: '/demo/project/src/util.ts' }),
      ]),
      assistant(BASE + 182 * MIN, 'demo-d1', [
        tool({ name: 'edit', input: { path: '/demo/project/src/util.ts', oldString: 'v1', newString: 'v2' }, targetPath: '/demo/project/src/util.ts' }),
        shell('npm test'),
      ]),
    ];
    sessions.push(session({ agent: 'opencode', id: 'demo-oc-healthy', title: 'Demo: healthy baseline', start: BASE + 180 * MIN, events }));
  }

  // 5. Codex exec failures (heuristic error detection → medium confidence).
  {
    const events: SessionEvent[] = [user(BASE + 240 * MIN, 'demo-u5')];
    for (let i = 0; i < 3; i++) {
      events.push({
        kind: 'tool',
        at: BASE + (241 + i) * MIN,
        tool: tool({
          name: 'exec',
          input: 'node scripts/deploy.js --env staging',
          status: 'error',
          statusSource: 'heuristic',
          commandCategory: 'run',
          errorMessage: 'inferred failure: error/exit marker in tool output',
        }),
      });
    }
    events.push({ kind: 'assistant', at: BASE + 244 * MIN, id: 'demo-e0', tools: [], textChars: 200, reasoningChars: 0 });
    sessions.push(session({ agent: 'codex', id: 'demo-cx-exec-fail', title: 'Demo: failing deploy script', start: BASE + 240 * MIN, events }));
  }

  // 6. Codex healthy session.
  {
    const events: SessionEvent[] = [
      user(BASE + 300 * MIN, 'demo-u6'),
      {
        kind: 'tool',
        at: BASE + 301 * MIN,
        tool: tool({ name: 'apply_patch', input: '*** Update File: src/lib.py\n@@\n-old\n+new', targetPath: 'src/lib.py' }),
      },
      {
        kind: 'tool',
        at: BASE + 302 * MIN,
        tool: tool({ name: 'exec', input: 'pytest -x tests/', commandCategory: 'test' }),
      },
      { kind: 'assistant', at: BASE + 303 * MIN, id: 'demo-f0', tools: [], textChars: 150, reasoningChars: 0 },
    ];
    sessions.push(session({ agent: 'codex', id: 'demo-cx-healthy', title: 'Demo: verified patch', start: BASE + 300 * MIN, events }));
  }

  // 7. Claude Code stuck Bash loop (tool_result.is_error failures).
  {
    const bashInput = { command: 'npm run migrate:prod', description: 'run migrations' };
    const events: SessionEvent[] = [user(BASE + 360 * MIN, 'demo-u7')];
    for (let i = 0; i < 3; i++) {
      events.push(
        assistant(BASE + (361 + i) * MIN, `demo-g${i}`, [
          tool({
            name: 'Bash',
            input: bashInput,
            status: 'error',
            commandCategory: classifyCommand('npm run migrate:prod'),
            errorType: 'tool_result.is_error',
          }),
        ]),
      );
    }
    sessions.push(session({ agent: 'claude', id: 'demo-cc-stuck-bash', title: 'Demo: failing migration loop', start: BASE + 360 * MIN, events }));
  }

  // 8. Claude Code healthy session with a subagent sidechain.
  {
    const events: SessionEvent[] = [
      user(BASE + 420 * MIN, 'demo-u8'),
      assistant(BASE + 421 * MIN, 'demo-h0', [
        tool({ name: 'Read', input: { file_path: '/demo/project/src/app.ts' }, targetPath: '/demo/project/src/app.ts' }),
      ]),
      assistant(BASE + 422 * MIN, 'demo-h1', [
        tool({ name: 'Edit', input: { file_path: '/demo/project/src/app.ts', old_string: 'a', new_string: 'b' }, targetPath: '/demo/project/src/app.ts' }),
        tool({ name: 'Bash', input: { command: 'npm test' }, commandCategory: 'test' }),
      ]),
      // Sidechain turn (subagent) — represented as a normal assistant event;
      // subagentStats on the record carries the aggregate.
      assistant(BASE + 423 * MIN, 'demo-h2', [
        tool({ name: 'Bash', input: { command: 'grep -rn TODO src/' }, commandCategory: 'search' }),
      ]),
    ];
    const rec = session({ agent: 'claude', id: 'demo-cc-healthy', title: 'Demo: verified edit with subagent', start: BASE + 420 * MIN, events });
    rec.subagentStats = { turns: 1, toolCalls: 1, toolErrors: 0 };
    sessions.push(rec);
  }

  return sessions;
}

export function demoEnvironment(): EnvironmentInfo {
  return {
    agents: [
      { agent: 'opencode', version: '2.3.1 (demo)', dataDir: 'synthetic-demo', layout: 'sqlite-v2', sessionCount: 4, issues: [] },
      { agent: 'codex', version: '0.169.0 (demo)', dataDir: 'synthetic-demo', layout: 'jsonl-rollout', sessionCount: 2, issues: [] },
      { agent: 'claude', version: '2.1.327 (demo)', dataDir: 'synthetic-demo', layout: 'jsonl-projects', sessionCount: 2, issues: [] },
    ],
    mcpServers: [
      { agent: 'opencode', configPath: '/demo/.config/opencode/opencode.json', names: ['playwright', 'context7'] },
      { agent: 'claude', configPath: '/demo/project/.mcp.json', names: ['github'] },
    ],
    skills: [
      { agent: 'opencode', dir: '/demo/.config/opencode/skills', ids: ['deploy', 'review'] },
      { agent: 'shared', dir: '/demo/.agents/skills', ids: ['deploy', 'test-runner'] },
    ],
    instructionFiles: [
      { path: '/demo/.config/opencode/AGENTS.md', bytes: 1200, sha256: 'demo' },
      { path: '/demo/project/AGENTS.md', bytes: 800, sha256: 'demo' },
    ],
    secretExposures: [
      { configPath: '/demo/.config/opencode/opencode.json', keyPath: 'provider.demo-provider.options.apiKey' },
    ],
    warnings: [],
  };
}

export function runDemoAudit(): AuditReport {
  const sessions = demoSessions();
  const coverage: AuditCoverage = {
    sessionsDiscovered: sessions.length,
    sessionsAnalyzed: sessions.length,
    sessionsSkippedWindow: 0,
    sessionsSkippedLimit: 0,
    sessionsFailedRead: 0,
    sessionsFromCache: 0,
    partialSessions: 0,
    parseWarnings: [],
  };
  return assembleReport({
    mode: 'demo',
    generatedAt: BASE + 480 * MIN,
    window: { since: BASE - 86_400_000, until: BASE + 480 * MIN, limit: 50 },
    environment: demoEnvironment(),
    coverage,
    sessions,
  });
}
