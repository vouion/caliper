/**
 * Recommendations are derived deterministically from findings.
 * v0.1 never applies changes automatically and never claims experimental
 * verification: `tested` is always false with an explicit note.
 */
import type { Finding, Recommendation } from '../core/types.ts';

interface Template {
  what: string;
  why: string;
  change: string;
  benefits: string;
  tradeoffs: string;
  apply: string[];
  rollback: string[];
}

const TEMPLATES: Record<string, Template> = {
  'repeated-tool-failures': {
    what: 'The agent repeatedly issued byte-identical tool calls that failed.',
    why: 'Identical retries cannot succeed when the precondition is unchanged; they consume tokens and time and mask the real blocker.',
    change:
      'Add a failure-handling instruction to your agent instructions (e.g. AGENTS.md): after a tool failure, diagnose the error and change the approach before retrying; never repeat an identical failing call more than once.',
    benefits: 'Fewer wasted tokens and faster sessions; failures surface their root cause earlier.',
    tradeoffs: 'Slightly more verbose reasoning on failures; occasional legitimate retries (transient network errors) may be deferred.',
    apply: [
      'Open your global or project instruction file (AGENTS.md / agent config instructions).',
      'Add a rule: "When a tool call fails, read the error, verify preconditions (paths, file content, dependencies), and change strategy before retrying. Do not repeat an identical failing call."',
      'Re-run havrin audit after a week of normal work to compare failure counts.',
    ],
    rollback: ['Remove the added instruction paragraph; no other state is changed.'],
  },
  'retry-loops': {
    what: 'Sessions show consecutive identical tool calls or consecutive assistant-level errors/retries.',
    why: 'Loops are the most expensive failure mode in agent workflows: cost grows linearly while probability of success does not.',
    change:
      'Add a circuit-breaker instruction: after two failed attempts at the same sub-goal, stop and re-plan (re-read current state, decompose the task, or ask the user). If provider retries dominate, review model/provider rate limits.',
    benefits: 'Bounds worst-case token burn per sub-goal; encourages explicit re-planning.',
    tradeoffs: 'May interrupt occasionally-useful persistence; requires the agent to follow instructions reliably.',
    apply: [
      'Add to AGENTS.md: "After two failed attempts at the same step, stop, summarize what failed, and choose a different approach or ask for guidance."',
      'If retries are provider-side, check provider status/rate limits and consider a fallback model.',
    ],
    rollback: ['Remove the added instruction paragraph.'],
  },
  'redundant-file-reads': {
    what: 'Files were re-read multiple times without the agent modifying them in between.',
    why: 'Re-reads of unchanged content spend input tokens and context window, accelerating compaction.',
    change:
      'Add an instruction to track already-read files and avoid re-reading unchanged content; prefer targeted grep/glob over full re-reads when locating code.',
    benefits: 'Lower input-token usage and longer effective context per session.',
    tradeoffs: 'After compaction some re-reads are necessary; the instruction must allow re-reading when context was lost.',
    apply: [
      'Add to AGENTS.md: "Avoid re-reading files you have already read in this session unless they changed or context was compacted. Prefer grep/glob for locating code."',
    ],
    rollback: ['Remove the added instruction paragraph.'],
  },
  'missing-test-verification': {
    what: 'Sessions modified files without any observed test execution.',
    why: 'Unverified changes move defect discovery downstream, where fixes cost more. (Tests may have run outside the agent; this is session-level evidence.)',
    change:
      'Require verification after meaningful edits: an instruction to run the project test command, or a stop-hook that runs tests before the agent finishes.',
    benefits: 'Earlier defect detection; higher confidence in agent-produced changes.',
    tradeoffs: 'Longer sessions and more tool calls; slow test suites may need a fast subset.',
    apply: [
      'Identify the fastest meaningful test command for the project (e.g. npm test, pytest -x).',
      'Add to project AGENTS.md: "After meaningful edits, run <test command> and fix failures before finishing."',
      'Alternatively configure an agent stop-hook that runs the test command.',
    ],
    rollback: ['Remove the instruction or disable the hook.'],
  },
  'context-compaction-pressure': {
    what: 'Sessions required multiple context compactions.',
    why: 'Compaction discards detail; frequent compaction correlates with re-reads, repeated questions, and drift.',
    change:
      'Reduce context pressure: split large tasks into focused sessions, cap verbose tool output, and keep instructions/skills lean.',
    benefits: 'More coherent long sessions; fewer compaction-related regressions.',
    tradeoffs: 'More session management overhead; some tasks genuinely need long context.',
    apply: [
      'Break multi-feature tasks into one-session-per-feature.',
      'Audit installed skills/MCP servers for unused tool definitions (see unused-mcp-servers findings).',
      'Prefer truncated output options for shell/search tools where available.',
    ],
    rollback: ['No configuration change required; revert workflow habits if they do not help.'],
  },
  'unused-mcp-servers': {
    what: 'Configured MCP servers were never invoked in the analyzed sessions.',
    why: 'Every configured server injects tool definitions into each prompt and adds attack surface, even when unused.',
    change: 'Disable or remove the unused MCP server entries from the agent config.',
    benefits: 'Smaller prompts (lower input tokens), reduced attack surface, faster tool selection.',
    tradeoffs: 'If you use the server occasionally, re-enabling takes one config edit; absence in the analysis window is not proof of never using it.',
    apply: [
      'Back up the config file listed in the evidence.',
      'Remove or disable the listed server entries (OpenCode: mcp.servers.<name>.enabled=false or delete the entry; Codex: remove [mcp_servers.<name>]; Claude Code: remove the entry from the project .mcp.json mcpServers).',
      'Restart the agent and re-run havrin audit after representative usage.',
    ],
    rollback: ['Restore the backed-up config file, or re-add the removed server entry.'],
  },
  'skill-name-collisions': {
    what: 'The same skill id exists in multiple skill directories.',
    why: 'Precedence between duplicate skills is agent-specific; behavior becomes inconsistent and updates unpredictable.',
    change: 'Keep a single authoritative copy of each colliding skill; remove or rename duplicates.',
    benefits: 'Deterministic skill resolution across agents; simpler maintenance.',
    tradeoffs: 'If duplicates intentionally differ per agent, renaming is required instead of deletion.',
    apply: [
      'Compare the colliding copies listed in the evidence.',
      'Keep the intended version; delete or rename the others (back them up first).',
    ],
    rollback: ['Restore the removed/renamed skill directories from your backup.'],
  },
  'plaintext-config-secrets': {
    what: 'Agent config files contain secret-looking keys with literal values.',
    why: 'Plaintext credentials leak via backups, dotfile repos, and screen shares; env-var references keep them out of files.',
    change: 'Move each literal secret to an environment variable and reference it from the config; rotate any credential that may have been exposed.',
    benefits: 'Credentials no longer travel with config files; smaller blast radius on accidental disclosure.',
    tradeoffs: 'Requires managing environment variables in your shell/service environment.',
    apply: [
      'For each listed key, create an environment variable (e.g. in your shell profile or a secrets manager).',
      'Replace the literal value with the agent-supported reference syntax (OpenCode: {env:VAR_NAME}).',
      'Rotate the credential if the file was ever committed, shared, or backed up off-machine.',
    ],
    rollback: ['Restore the previous config from backup if the env-var setup fails (then fix the env setup).'],
  },
};

export function buildRecommendations(findings: Finding[]): Recommendation[] {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byRule.get(f.ruleId) ?? [];
    list.push(f);
    byRule.set(f.ruleId, list);
  }
  const recommendations: Recommendation[] = [];
  for (const [ruleId, group] of byRule) {
    const template = TEMPLATES[ruleId];
    if (!template) continue;
    const evidence = group
      .flatMap((f) => f.evidence.slice(0, 3).map((e) => e.description))
      .slice(0, 8);
    recommendations.push({
      id: `rec-${ruleId}`,
      findingRuleIds: [ruleId],
      state: 'proposed',
      what: template.what,
      why: template.why,
      change: template.change,
      evidence,
      tested: false,
      testedNote:
        'Not experimentally verified. Based on deterministic observation of your sessions/environment; Havrin v0.1 does not run experiments.',
      benefits: template.benefits,
      tradeoffs: template.tradeoffs,
      apply: template.apply,
      rollback: template.rollback,
    });
  }
  return recommendations;
}
