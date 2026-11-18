/**
 * Agent-ready fix prompt generation.
 *
 * Turns an audit's evidence-backed findings + recommendations into a single,
 * provider-agnostic prompt the user can paste into ANY coding agent to apply
 * the safe, high-value fixes. Caliper does NOT apply anything itself (no
 * auto-apply invariant) — it generates instructions; the user's agent acts,
 * and the user verifies (tests + re-audit).
 *
 * Deterministic and zero-LLM: the prompt is templated from the content-free
 * normalized model. It contains findings, evidence pointers, and apply/rollback
 * steps — never raw session content. Pasting it into a cloud agent is the
 * user's explicit choice; Caliper itself transmits nothing.
 */
import type { AuditReport, Recommendation, Severity } from '../core/types.ts';
import { formatDate, formatDuration, plural } from '../core/util.ts';

export type PromptAgent = 'generic' | 'opencode' | 'codex' | 'claude';

export interface FixPromptOptions {
  /** Tailor instruction-file references to a specific agent. Default generic. */
  agent?: PromptAgent;
  /** Include recommendations at or above this severity. Default 'low' (all). */
  minSeverity?: Severity;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };

const INSTRUCTION_FILE: Record<PromptAgent, string> = {
  generic: 'your agent instruction file (e.g. AGENTS.md or CLAUDE.md)',
  opencode: 'AGENTS.md (project root, or global ~/.config/opencode/AGENTS.md)',
  codex: 'AGENTS.md (project root, or global ~/.codex/AGENTS.md)',
  claude: 'CLAUDE.md (project root, or global ~/.claude/CLAUDE.md)',
};

/** Max severity among a recommendation's linked findings. */
function recSeverity(rec: Recommendation, report: AuditReport): Severity {
  let best: Severity = 'info';
  for (const f of report.findings) {
    if (rec.findingRuleIds.includes(f.ruleId) && SEVERITY_RANK[f.severity] > SEVERITY_RANK[best]) {
      best = f.severity;
    }
  }
  return best;
}

export function selectRecommendations(report: AuditReport, minSeverity: Severity): { rec: Recommendation; severity: Severity }[] {
  const out: { rec: Recommendation; severity: Severity }[] = [];
  for (const rec of report.recommendations) {
    const severity = recSeverity(rec, report);
    if (SEVERITY_RANK[severity] >= SEVERITY_RANK[minSeverity]) out.push({ rec, severity });
  }
  return out.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

export function buildFixPrompt(report: AuditReport, opts: FixPromptOptions = {}): string {
  const agent = opts.agent ?? 'generic';
  const minSeverity = opts.minSeverity ?? 'low';
  const selected = selectRecommendations(report, minSeverity);
  const instructionFile = INSTRUCTION_FILE[agent];

  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of report.findings) counts[f.severity]++;
  const agents = report.environment.agents.filter((a) => a.binaryPath ?? a.dataDir).map((a) => a.agent);

  const lines: string[] = [];
  lines.push('# Workflow optimization task');
  lines.push('');
  lines.push(
    'You are optimizing this developer’s AI-assisted development workflow. Caliper — a local, ' +
      'evidence-driven analyzer — inspected their coding-agent sessions and configuration and produced ' +
      'the findings below. Apply the safe, high-value fixes, verify each one, and report what you changed.',
  );
  lines.push('');
  lines.push('## Operating rules (read first)');
  lines.push('1. Make minimal, reversible changes. Back up any configuration file before editing it (e.g. copy it to `<file>.bak`).');
  lines.push('2. Never read, print, commit, or transmit secrets or credentials. If a fix involves a secret, move it to an environment variable and reference it — do not echo its value.');
  lines.push('3. Verify every change. After code edits, run the project’s test suite. If Caliper is installed, re-run `caliper audit` to confirm the findings are resolved.');
  lines.push('4. Use judgment. These findings are evidence-backed but observational, not experimentally proven. Skip anything that does not apply to this project, and prefer the least invasive fix.');
  lines.push('5. Never delete or weaken tests to make a check pass.');
  lines.push(`6. Put durable workflow/instruction improvements in ${instructionFile}.`);
  lines.push('7. Finish with a short changelog: what you changed, why, and how to roll each change back.');
  lines.push('');
  lines.push('## Context');
  const windowLabel = report.window.since < 86_400_000 ? 'full history' : `last ${formatDuration(report.window.until - report.window.since)}`;
  lines.push(`- Analysis generated: ${formatDate(report.generatedAt)} · window: ${windowLabel}`);
  lines.push(`- Agents detected: ${agents.length > 0 ? agents.join(', ') : 'none'}`);
  lines.push(`- Sessions analyzed: ${report.coverage.sessionsAnalyzed}`);
  lines.push(`- Findings: ${report.findings.length} (high ${counts.high}, medium ${counts.medium}, low ${counts.low})`);
  lines.push(`- This prompt includes fixes at severity ≥ ${minSeverity}: ${plural(selected.length, 'recommendation')}.`);
  lines.push('');

  if (selected.length === 0) {
    lines.push('## Fixes');
    lines.push('');
    lines.push(
      report.findings.length === 0
        ? 'No issues were detected in the analyzed data. Confirm the project’s tests pass and that agent instructions are clear and non-conflicting; make no speculative changes.'
        : `No recommendations meet the severity threshold (≥ ${minSeverity}). Review lower-severity findings with \`caliper audit\` if desired; make no speculative changes.`,
    );
    lines.push('');
  } else {
    lines.push('## Prioritized fixes');
    lines.push('');
    let i = 0;
    for (const { rec, severity } of selected) {
      i++;
      lines.push(`### ${i}. [${severity.toUpperCase()}] ${rec.what}`);
      lines.push('');
      lines.push(`**Why it matters:** ${rec.why}`);
      lines.push('');
      if (rec.evidence.length > 0) {
        lines.push('**Evidence:**');
        for (const e of rec.evidence) lines.push(`- ${e}`);
        lines.push('');
      }
      lines.push('**Apply:**');
      rec.apply.forEach((step, n) => lines.push(`${n + 1}. ${step}`));
      lines.push('');
      lines.push(`**Rollback:** ${rec.rollback.join(' ')}`);
      lines.push('');
      lines.push(`**Trade-offs:** ${rec.tradeoffs}`);
      lines.push('');
      lines.push(`_Confidence: ${severity} severity · ${rec.tested ? 'experimentally tested' : 'observational (not experimentally verified)'}._`);
      lines.push('');
    }
  }

  lines.push('## Definition of done');
  lines.push('- Every applicable high/medium fix is applied, or explicitly justified as skipped.');
  lines.push('- The project’s tests pass; no test was deleted or weakened.');
  lines.push('- No secret was printed, committed, or transmitted; config backups exist for any config edit.');
  lines.push('- If available, `caliper audit` shows fewer findings than before.');
  lines.push('- A short changelog lists each edit and its rollback step.');
  lines.push('');
  return lines.join('\n');
}
