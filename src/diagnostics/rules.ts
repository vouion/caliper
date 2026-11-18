/**
 * Deterministic diagnostic rules.
 *
 * Every rule is a pure function of normalized sessions + environment info.
 * No LLM, no network, no randomness. Thresholds are documented per rule and
 * intentionally conservative. Confidence reflects evidence strength, never
 * enthusiasm: heuristic signals (e.g. Codex error inference) cap confidence.
 */
import type { EnvironmentInfo, Evidence, Finding, SessionRecord, Severity } from '../core/types.ts';
import { iterTools, countEvents } from '../core/session.ts';
import { isReadTool, isWriteTool } from '../core/classify.ts';

export interface RuleContext {
  sessions: SessionRecord[];
  environment: EnvironmentInfo;
}

export interface Rule {
  id: string;
  description: string;
  run(ctx: RuleContext): Finding[];
}

const MAX_FINDINGS_PER_RULE = 5;

function sessionLabel(s: SessionRecord): string {
  return s.title ? `${s.title} (${s.id})` : s.id;
}

/** Cap findings per rule, keeping the strongest evidence first. */
function cap(findings: Finding[]): Finding[] {
  return findings
    .sort((a, b) => b.evidence.length - a.evidence.length || severityRank(b.severity) - severityRank(a.severity))
    .slice(0, MAX_FINDINGS_PER_RULE);
}

function severityRank(s: Severity): number {
  return s === 'high' ? 3 : s === 'medium' ? 2 : s === 'low' ? 1 : 0;
}

/**
 * Rule: repeated-tool-failures
 * The same tool with byte-identical input fails ≥2 times in one session.
 * Identical input + repeated failure is strong evidence of a stuck loop,
 * not normal iteration. Threshold: ≥2 identical failures (high confidence);
 * ≥5 raises severity to high.
 */
const repeatedToolFailures: Rule = {
  id: 'repeated-tool-failures',
  description: 'Same tool + identical input failing repeatedly within a session.',
  run({ sessions }) {
    const findings: Finding[] = [];
    for (const session of sessions) {
      const groups = new Map<string, { name: string; count: number; heuristic: number; firstAt: number; lastAt: number; sample?: string }>();
      for (const { tool, at } of iterTools(session)) {
        if (tool.status !== 'error') continue;
        const key = `${tool.name}\u0000${tool.inputFingerprint}`;
        const g = groups.get(key) ?? { name: tool.name, count: 0, heuristic: 0, firstAt: at, lastAt: at };
        g.count++;
        if (tool.statusSource === 'heuristic') g.heuristic++;
        g.lastAt = at;
        if (!g.sample && tool.errorMessage) g.sample = tool.errorMessage;
        groups.set(key, g);
      }
      const repeated = [...groups.values()].filter((g) => g.count >= 2).sort((a, b) => b.count - a.count);
      if (repeated.length === 0) continue;
      const total = repeated.reduce((n, g) => n + g.count, 0);
      const allHeuristic = repeated.every((g) => g.heuristic === g.count);
      const evidence: Evidence[] = repeated.slice(0, 5).map((g) => {
        const e: Evidence = {
          description: `Tool "${g.name}" failed ${g.count}× with identical input${g.sample ? ` (e.g. ${g.sample})` : ''}`,
          sessionId: session.id,
          agent: session.agent,
          at: g.firstAt,
          value: g.count,
        };
        return e;
      });
      findings.push({
        ruleId: 'repeated-tool-failures',
        title: `Repeated identical tool failures in ${sessionLabel(session)}`,
        severity: total >= 5 ? 'high' : 'medium',
        confidence: allHeuristic ? 'medium' : 'high',
        scope: 'sessions',
        agent: session.agent,
        evidence,
        consequence:
          'Identical failing calls burn tokens and wall-clock time without new information, and usually indicate the agent is stuck on an unmet precondition (wrong path, stale content, missing dependency).',
        suggestion:
          'Inspect the first failure in the session and fix the precondition (path, file content, environment) instead of letting the agent retry. Consider instructions that require diagnosing a failure before retrying it.',
      });
    }
    return cap(findings);
  },
};

/**
 * Rule: retry-loops
 * ≥3 consecutive calls of the same tool with identical input (any status),
 * or ≥2 consecutive assistant-level errors/retries in one session.
 */
const retryLoops: Rule = {
  id: 'retry-loops',
  description: 'Consecutive identical tool calls or consecutive assistant errors.',
  run({ sessions }) {
    const findings: Finding[] = [];
    for (const session of sessions) {
      const evidence: Evidence[] = [];
      let runKey = '';
      let runLen = 0;
      let runStart = 0;
      let bestRun = 0;
      let bestName = '';
      const flush = () => {
        if (runLen >= 3 && runLen > bestRun) {
          bestRun = runLen;
          bestName = runKey.split('\u0000')[0] ?? '';
        }
      };
      for (const { tool, at } of iterTools(session)) {
        // Read-only tools are covered by redundant-file-reads; counting them
        // here would double-report the same behavior.
        if (isReadTool(tool.name)) {
          flush();
          runKey = '';
          runLen = 0;
          continue;
        }
        const key = `${tool.name}\u0000${tool.inputFingerprint}`;
        if (key === runKey) {
          runLen++;
        } else {
          flush();
          runKey = key;
          runLen = 1;
          runStart = at;
        }
      }
      flush();
      if (bestRun >= 3) {
        evidence.push({
          description: `Tool "${bestName}" called ${bestRun}× consecutively with identical input`,
          sessionId: session.id,
          agent: session.agent,
          at: runStart,
          value: bestRun,
        });
      }
      let consecutiveErrors = 0;
      let maxConsecutiveErrors = 0;
      let retryTotal = 0;
      for (const ev of session.events) {
        if (ev.kind !== 'assistant') continue;
        if (ev.error || (ev.retries ?? 0) > 0) {
          consecutiveErrors++;
          maxConsecutiveErrors = Math.max(maxConsecutiveErrors, consecutiveErrors);
        } else {
          consecutiveErrors = 0;
        }
        retryTotal += ev.retries ?? 0;
      }
      if (maxConsecutiveErrors >= 2) {
        evidence.push({
          description: `${maxConsecutiveErrors} consecutive assistant turns ended in errors/retries`,
          sessionId: session.id,
          agent: session.agent,
          value: maxConsecutiveErrors,
        });
      }
      if (retryTotal >= 3) {
        evidence.push({
          description: `${retryTotal} provider-reported retries across the session`,
          sessionId: session.id,
          agent: session.agent,
          value: retryTotal,
        });
      }
      if (evidence.length === 0) continue;
      findings.push({
        ruleId: 'retry-loops',
        title: `Retry loop behavior in ${sessionLabel(session)}`,
        severity: 'medium',
        confidence: 'high',
        scope: 'sessions',
        agent: session.agent,
        evidence,
        consequence:
          'Loops multiply token spend and latency while rarely converging; provider retries also indicate rate limits or unstable model/provider configuration.',
        suggestion:
          'Add a workflow instruction to change strategy after two failed attempts (re-read state, ask the user, or decompose the task). For provider retries, check rate limits and model availability.',
      });
    }
    return cap(findings);
  },
};

/**
 * Rule: redundant-file-reads
 * The same file read ≥3 times in one session with no intervening write to
 * that file by the agent. Re-reading unchanged files wastes context tokens.
 * Only structured read tools are counted; shell `cat` is opaque by design.
 */
const redundantFileReads: Rule = {
  id: 'redundant-file-reads',
  description: 'Same file read repeatedly without intervening modification.',
  run({ sessions }) {
    const findings: Finding[] = [];
    for (const session of sessions) {
      const reads = new Map<string, number[]>();
      const writes = new Map<string, number[]>();
      let idx = 0;
      for (const { tool } of iterTools(session)) {
        idx++;
        if (!tool.targetPath) continue;
        if (isReadTool(tool.name) && tool.status !== 'error') {
          const list = reads.get(tool.targetPath) ?? [];
          list.push(idx);
          reads.set(tool.targetPath, list);
        } else if (isWriteTool(tool.name) && tool.status === 'completed') {
          const list = writes.get(tool.targetPath) ?? [];
          list.push(idx);
          writes.set(tool.targetPath, list);
        }
      }
      const evidence: Evidence[] = [];
      for (const [file, positions] of reads) {
        if (positions.length < 3) continue;
        const writePositions = writes.get(file) ?? [];
        // Reads per segment between writes: the first read in each segment is
        // legitimate; extras are re-reads of content the agent already saw.
        const segments = new Map<number, number>();
        let wi = 0;
        let seg = 0;
        for (const pos of positions) {
          while (wi < writePositions.length && (writePositions[wi] ?? 0) < pos) {
            seg++;
            wi++;
          }
          segments.set(seg, (segments.get(seg) ?? 0) + 1);
        }
        const redundant = [...segments.values()].reduce((n, c) => n + Math.max(0, c - 1), 0);
        if (redundant < 2) continue;
        evidence.push({
          description: `File ${file} read ${positions.length}× with ${redundant} re-reads of unchanged content`,
          sessionId: session.id,
          agent: session.agent,
          value: redundant,
        });
      }
      if (evidence.length === 0) continue;
      evidence.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
      findings.push({
        ruleId: 'redundant-file-reads',
        title: `Redundant file reads in ${sessionLabel(session)}`,
        severity: 'low',
        confidence: 'high',
        scope: 'sessions',
        agent: session.agent,
        evidence: evidence.slice(0, 5),
        consequence:
          'Each re-read of an unchanged file consumes context window and input tokens, and pushes useful context out of the window sooner (earlier compaction).',
        suggestion:
          'Encourage note-taking of file structure in the session (or agent instructions to avoid re-reading unchanged files). Some redundancy is normal after compaction; the counts above exclude post-write re-reads.',
      });
    }
    return cap(findings);
  },
};

/**
 * Rule: missing-test-verification
 * Sessions with ≥3 completed file-modifying tool calls but zero test-category
 * commands. Medium confidence: tests may run outside the agent session.
 */
const missingTestVerification: Rule = {
  id: 'missing-test-verification',
  description: 'File modifications without any observed test execution.',
  run({ sessions }) {
    const findings: Finding[] = [];
    for (const session of sessions) {
      let writes = 0;
      let tests = 0;
      let assistantTurns = 0;
      for (const ev of session.events) if (ev.kind === 'assistant') assistantTurns++;
      for (const { tool } of iterTools(session)) {
        if (isWriteTool(tool.name) && tool.status === 'completed') writes++;
        if (tool.commandCategory === 'test' && tool.status !== 'error') tests++;
      }
      if (writes < 3 || tests > 0 || assistantTurns < 3) continue;
      findings.push({
        ruleId: 'missing-test-verification',
        title: `No test execution observed after edits in ${sessionLabel(session)}`,
        severity: 'medium',
        confidence: 'medium',
        scope: 'sessions',
        agent: session.agent,
        evidence: [
          {
            description: `${writes} completed file-modifying tool calls, 0 test commands observed in-session`,
            sessionId: session.id,
            agent: session.agent,
            value: writes,
          },
        ],
        consequence:
          'Unverified edits shift defect detection to later, more expensive stages. This is an observation about the session, not proof that no tests ran elsewhere.',
        suggestion:
          'Add an instruction requiring the agent to run the project test command after meaningful edits, or wire a stop-hook that runs tests before the agent finishes.',
      });
    }
    return cap(findings);
  },
};

/**
 * Rule: context-compaction-pressure
 * ≥2 compactions in one session. Compaction discards working context; frequent
 * compaction indicates tasks too large for the context budget or verbose tooling.
 */
const contextCompactionPressure: Rule = {
  id: 'context-compaction-pressure',
  description: 'Frequent context compaction within a session.',
  run({ sessions }) {
    const findings: Finding[] = [];
    for (const session of sessions) {
      const compactions = session.events.filter((e) => e.kind === 'compaction');
      if (compactions.length < 2) continue;
      const firstCompaction = compactions[0];
      const ev: Evidence = {
        description: `${compactions.length} compaction events in one session`,
        sessionId: session.id,
        agent: session.agent,
        value: compactions.length,
      };
      if (firstCompaction) ev.at = firstCompaction.at;
      findings.push({
        ruleId: 'context-compaction-pressure',
        title: `Frequent context compaction in ${sessionLabel(session)}`,
        severity: compactions.length >= 4 ? 'medium' : 'low',
        confidence: 'high',
        scope: 'sessions',
        agent: session.agent,
        evidence: [ev],
        consequence:
          'Each compaction summarizes away detail; repeated compaction correlates with lost context, repeated questions, and re-reads. It is a signal of context pressure, not a defect by itself.',
        suggestion:
          'Split large tasks into smaller sessions, reduce verbose tool output (e.g. truncated shell output), or use a model/configuration with a larger effective context budget.',
      });
    }
    return cap(findings);
  },
};

/**
 * Rule: unused-mcp-servers
 * Configured MCP servers with no matching tool calls in any analyzed session.
 * OpenCode exposes MCP tools as "<server>_<tool>"; matching is prefix-based.
 * Medium confidence: naming convention is inferred, and absence of use in the
 * analyzed window is not proof of never using the server.
 */
const unusedMcpServers: Rule = {
  id: 'unused-mcp-servers',
  description: 'Configured MCP servers never invoked in analyzed sessions.',
  run({ sessions, environment }) {
    const toolNames = new Set<string>();
    let toolCalls = 0;
    for (const session of sessions) {
      for (const { tool } of iterTools(session)) {
        toolNames.add(tool.name);
        toolCalls++;
      }
    }
    if (toolCalls === 0) return []; // no evidence either way
    const findings: Finding[] = [];
    for (const group of environment.mcpServers) {
      const unused = group.names.filter(
        (name) => ![...toolNames].some((t) => t === name || t.startsWith(`${name}_`) || t.startsWith(`${name}-`)),
      );
      if (unused.length === 0) continue;
      findings.push({
        ruleId: 'unused-mcp-servers',
        title: `MCP server(s) configured but unused: ${unused.join(', ')}`,
        severity: 'low',
        confidence: 'medium',
        scope: 'environment',
        agent: group.agent,
        evidence: [
          {
            description: `Configured in ${group.configPath}; no matching tool calls across ${sessions.length} analyzed sessions (${toolCalls} tool calls observed)`,
            agent: group.agent,
            value: unused.length,
          },
        ],
        consequence:
          'Unused MCP servers still inject tool definitions into every prompt (context cost) and expand the attack surface of the agent without providing value.',
        suggestion:
          'Disable or remove the unused server(s) from the config, or start using them. Re-run havrin audit after a representative work period to confirm.',
      });
    }
    return cap(findings);
  },
};

/**
 * Rule: skill-name-collisions
 * The same skill id present in multiple skill directories. Shadowing order is
 * agent-specific; collisions make behavior unpredictable across agents.
 */
const skillNameCollisions: Rule = {
  id: 'skill-name-collisions',
  description: 'Same skill id defined in multiple skill directories.',
  run({ environment }) {
    const byId = new Map<string, string[]>();
    for (const group of environment.skills) {
      for (const id of group.ids) {
        const dirs = byId.get(id) ?? [];
        dirs.push(group.dir);
        byId.set(id, dirs);
      }
    }
    const collisions = [...byId.entries()].filter(([, dirs]) => dirs.length >= 2);
    if (collisions.length === 0) return [];
    return [
      {
        ruleId: 'skill-name-collisions',
        title: `Skill id collisions: ${collisions.map(([id]) => id).join(', ')}`,
        severity: 'low',
        confidence: 'high',
        scope: 'environment',
        evidence: collisions.slice(0, 5).map(([id, dirs]) => ({
          description: `Skill "${id}" defined in ${dirs.length} directories: ${dirs.join(' ; ')}`,
          value: dirs.length,
        })),
        consequence:
          'Which definition wins depends on agent-specific precedence. Collisions cause inconsistent behavior between agents and make skill updates unpredictable.',
        suggestion:
          'Keep one authoritative copy per skill id; remove or rename duplicates. Shared skills can live in a single shared directory referenced by each agent.',
      },
    ];
  },
};

/**
 * Rule: plaintext-config-secrets
 * Secret-looking keys with literal string values in agent config files.
 * Values are never read into reports — only key path + file.
 */
const plaintextConfigSecrets: Rule = {
  id: 'plaintext-config-secrets',
  description: 'Secret-looking literal values in agent configuration files.',
  run({ environment }) {
    if (environment.secretExposures.length === 0) return [];
    return [
      {
        ruleId: 'plaintext-config-secrets',
        title: `${environment.secretExposures.length} secret-looking value(s) stored in plaintext config`,
        severity: 'high',
        confidence: 'high',
        scope: 'environment',
        evidence: environment.secretExposures.slice(0, 8).map((e) => ({
          description: `Key "${e.keyPath}" in ${e.configPath} holds a literal value (value not inspected or stored by Havrin)`,
        })),
        consequence:
          'Plaintext credentials in config files leak through backups, dotfile repos, screen shares, and any tool that reads the config. Environment-variable references avoid this.',
        suggestion:
          'Move the value to an environment variable and reference it (e.g. {env:MY_API_KEY} in OpenCode config). Rotate the credential if the file was ever shared or committed.',
      },
    ];
  },
};

export const RULES: Rule[] = [
  repeatedToolFailures,
  retryLoops,
  redundantFileReads,
  missingTestVerification,
  contextCompactionPressure,
  unusedMcpServers,
  skillNameCollisions,
  plaintextConfigSecrets,
];

export function runDiagnostics(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    findings.push(...rule.run(ctx));
  }
  return findings.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      b.evidence.length - a.evidence.length ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}
