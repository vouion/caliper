/**
 * Professional terminal report renderer.
 * Color respects NO_COLOR / FORCE_COLOR / TTY. Content-free by construction:
 * it renders only what the normalized model carries.
 */
import type { AuditReport, Finding, Recommendation, Severity } from '../core/types.ts';
import { formatCost, formatDate, formatDuration, formatTokens } from '../core/util.ts';
import { countBySeverity } from '../diagnostics/rules.ts';

const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'HIGH',
  medium: 'MED ',
  low: 'LOW ',
  info: 'INFO',
};

export interface RenderOptions {
  color?: boolean;
  width?: number;
}

export function shouldUseColor(streamIsTTY: boolean | undefined): boolean {
  if (process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '') return false;
  if (process.env['FORCE_COLOR'] !== undefined && process.env['FORCE_COLOR'] !== '0') return true;
  return streamIsTTY === true;
}

class Painter {
  private enabled: boolean;
  constructor(enabled: boolean) {
    this.enabled = enabled;
  }
  private code(n: number, text: string): string {
    return this.enabled ? `\u001b[${n}m${text}\u001b[0m` : text;
  }
  bold = (t: string) => this.code(1, t);
  dim = (t: string) => this.code(2, t);
  red = (t: string) => this.code(31, t);
  green = (t: string) => this.code(32, t);
  yellow = (t: string) => this.code(33, t);
  blue = (t: string) => this.code(34, t);
  magenta = (t: string) => this.code(35, t);
  cyan = (t: string) => this.code(36, t);
}

const ANSI_RE = /\u001b\[[0-9;]*m/g;

function wrap(text: string, width: number, indent = ''): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  // Indents may contain ANSI escapes; budget by visible width only.
  const visibleIndent = indent.replace(ANSI_RE, '').length;
  const max = Math.max(20, width - visibleIndent);
  const pushLine = (l: string) => lines.push(indent + l);
  for (let word of words) {
    // Hard-break unbreakable words (long paths/URLs) instead of overflowing.
    while (word.length > max) {
      if (line.length > 0) {
        pushLine(line);
        line = '';
      }
      pushLine(word.slice(0, max));
      word = word.slice(max);
    }
    if (line.length === 0) {
      line = word;
    } else if (line.length + 1 + word.length <= max) {
      line += ' ' + word;
    } else {
      pushLine(line);
      line = word;
    }
  }
  if (line) pushLine(line);
  return lines;
}

/** Wrap with a label on the first line only; continuation lines align. */
function labeled(label: string, text: string, width: number, baseIndent: string): string[] {
  const visibleLabel = label.replace(ANSI_RE, '');
  const firstPrefix = baseIndent + label;
  const contIndent = baseIndent + ' '.repeat(visibleLabel.length);
  const lines = wrap(text, width, contIndent);
  if (lines.length === 0) return [firstPrefix];
  const first = lines[0] ?? '';
  lines[0] = firstPrefix + first.slice(contIndent.length);
  return lines;
}

export function renderTerminal(report: AuditReport, opts: RenderOptions = {}): string {
  const width = Math.min(opts.width ?? process.stdout.columns ?? 80, 100);
  const p = new Painter(opts.color ?? false);
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);
  const rule = p.dim('─'.repeat(width));

  // Header
  push('');
  push(p.bold(`havrin v${report.havrinVersion}`) + p.dim(' · development environment audit'));
  if (report.mode === 'demo') {
    push(p.yellow(p.bold('SYNTHETIC DEMONSTRATION DATA — fabricated sessions, not your data.')));
  }
  push(p.dim(`generated ${formatDate(report.generatedAt)} · window: last ${formatDuration(report.window.until - report.window.since)} · limit ${report.window.limit}/agent`));
  push(rule);

  // Environment
  push(p.bold('ENVIRONMENT'));
  const detected = report.environment.agents.filter((a) => a.binaryPath ?? a.dataDir);
  if (detected.length === 0) {
    push(p.yellow('  No supported coding agents detected (looked for OpenCode and Codex CLI).'));
  }
  for (const agent of report.environment.agents) {
    if (!agent.binaryPath && !agent.dataDir) continue;
    const bits = [
      agent.version ? `v${agent.version}` : 'version unknown',
      agent.layout ?? 'no storage',
      agent.sessionCount !== undefined ? `${agent.sessionCount} sessions` : undefined,
    ].filter(Boolean);
    const status = agent.issues.length > 0 ? p.yellow('▲') : p.green('●');
    push(`  ${status} ${p.bold(agent.agent.padEnd(9))} ${bits.join(' · ')}`);
    for (const issue of agent.issues) {
      push(...wrap(issue, width, '      ' + p.yellow('▲ ')));
    }
  }
  const mcpCount = report.environment.mcpServers.reduce((n, g) => n + g.names.length, 0);
  const skillCount = report.environment.skills.reduce((n, g) => n + g.ids.length, 0);
  push(p.dim(`  configs: ${report.environment.agents.filter((a) => a.configPath).length} · MCP servers: ${mcpCount} · skills: ${skillCount} · instruction files: ${report.environment.instructionFiles.length}`));
  push('');

  // Coverage
  push(p.bold('COVERAGE'));
  const c = report.coverage;
  push(`  sessions discovered ${c.sessionsDiscovered} · analyzed ${c.sessionsAnalyzed} · from cache ${c.sessionsFromCache}`);
  push(p.dim(`  skipped: ${c.sessionsSkippedWindow} outside window, ${c.sessionsSkippedLimit} over limit, ${c.sessionsFailedRead} failed reads · partial parses: ${c.partialSessions}`));
  if (c.sessionsAnalyzed === 0) {
    push('');
    push(p.yellow(p.bold('  No session data was analyzed.')));
    const reasons: string[] = [];
    if (detected.length === 0) reasons.push('No supported agent installation was found.');
    else if (c.sessionsDiscovered === 0) reasons.push('Agents were detected but no session storage was found.');
    else reasons.push(`No sessions were updated within the analysis window (last ${formatDuration(report.window.until - report.window.since)}). Try --since 90d or --all.`);
    for (const r of reasons) push(...wrap(r, width, '  '));
    push(...wrap('To see Havrin in action without importing personal data, run: havrin demo', width, '  '));
  }
  for (const w of c.parseWarnings.slice(0, 5)) {
    push(p.dim('  parse: ' + w));
  }
  push('');

  // Totals
  if (c.sessionsAnalyzed > 0) {
    push(p.bold('USAGE TOTALS') + p.dim(' (analyzed sessions)'));
    const t = report.totals;
    push(`  tokens: input ${formatTokens(t.tokens.input)} · output ${formatTokens(t.tokens.output)} · reasoning ${formatTokens(t.tokens.reasoning)} · cache read ${formatTokens(t.tokens.cacheRead)} · cache write ${formatTokens(t.tokens.cacheWrite)}`);
    push(`  reported cost: ${formatCost(t.cost)} · tool calls: ${t.toolCalls} (${t.toolErrors} errors) · turns: ${t.userTurns} user / ${t.assistantTurns} assistant`);
    let subTurns = 0;
    let subTools = 0;
    let subErrors = 0;
    let sawSub = false;
    for (const s of report.sessions) {
      if (s.subagentStats) {
        sawSub = true;
        subTurns += s.subagentStats.turns;
        subTools += s.subagentStats.toolCalls;
        subErrors += s.subagentStats.toolErrors;
      }
    }
    if (sawSub) {
      push(`  subagents (sidechains): ${subTurns} turns · ${subTools} tool calls (${subErrors} errors)`);
    }
    if (t.cost === 0) push(p.dim('  cost is agent-reported; $0.00 may mean pricing was unavailable, not free usage.'));
    push('');
  }

  // Findings
  const counts = countBySeverity(report.findings);
  push(p.bold(`FINDINGS (${report.findings.length})`) + p.dim(`  high ${counts.high} · medium ${counts.medium} · low ${counts.low}`));
  if (report.findings.length === 0 && c.sessionsAnalyzed > 0) {
    push(p.green('  No issues matched the v0.1 diagnostic rules in the analyzed data.'));
    push(p.dim('  Rules are conservative; absence of findings is not a guarantee of optimality.'));
  }
  for (const f of report.findings) {
    push('');
    push(...renderFinding(f, p, width));
  }
  push('');

  // Recommendations
  push(p.bold(`RECOMMENDATIONS (${report.recommendations.length})`));
  if (report.recommendations.length === 0) {
    push(p.dim('  Nothing to recommend from the current evidence.'));
  }
  let i = 0;
  for (const r of report.recommendations) {
    i++;
    push('');
    push(...renderRecommendation(r, i, p, width));
  }

  // Footer
  push('');
  push(rule);
  push(p.dim('Privacy: analysis ran entirely on this machine. No session content, tool output,'));
  push(p.dim('or credentials were transmitted or stored in this report. Original agent data'));
  push(p.dim('was opened read-only and never modified.'));
  if (report.mode === 'real') {
    push(p.dim(`Report artifact: ~/.local/share/havrin/last-audit.json (havrin report --format json)`));
  }
  push('');
  return out.join('\n');
}

function severityBadge(p: Painter, s: Severity): string {
  const label = SEVERITY_LABEL[s];
  if (s === 'high') return p.red(p.bold(`[${label}]`));
  if (s === 'medium') return p.yellow(p.bold(`[${label}]`));
  if (s === 'low') return p.cyan(`[${label}]`);
  return p.dim(`[${label}]`);
}

function renderFinding(f: Finding, p: Painter, width: number): string[] {
  const lines: string[] = [];
  lines.push(`  ${severityBadge(p, f.severity)} ${p.bold(f.title)}`);
  lines.push(p.dim(`         rule ${f.ruleId} · confidence ${f.confidence} · scope ${f.scope}${f.agent ? ' · ' + f.agent : ''}`));
  for (const e of f.evidence) {
    lines.push(...wrap('· ' + e.description, width, '         '));
  }
  lines.push(...labeled(p.dim('impact: '), f.consequence, width, '         '));
  lines.push(...labeled(p.dim('suggest: '), f.suggestion, width, '         '));
  return lines;
}

function renderRecommendation(r: Recommendation, index: number, p: Painter, width: number): string[] {
  const lines: string[] = [];
  const indent = '    ';
  lines.push(p.bold(`  ${index}. ${r.what}`));
  const field = (label: string, text: string) => {
    lines.push(...labeled(p.dim(label + ' '), text, width, indent));
  };
  field('why:', r.why);
  field('change:', r.change);
  if (r.evidence.length > 0) {
    lines.push(indent + p.dim('evidence:'));
    for (const e of r.evidence.slice(0, 4)) {
      lines.push(...wrap('· ' + e, width, indent + '  '));
    }
  }
  lines.push(
    ...labeled(
      p.dim('tested: '),
      (r.tested ? 'yes' : 'no') + ' — ' + r.testedNote,
      width,
      indent,
    ),
  );
  field('benefits:', r.benefits);
  field('tradeoffs:', r.tradeoffs);
  lines.push(indent + p.dim('apply:'));
  let step = 0;
  for (const a of r.apply) {
    step++;
    lines.push(...wrap(`${step}) ${a}`, width, indent + '  '));
  }
  lines.push(indent + p.dim('rollback:'));
  for (const rb of r.rollback) {
    lines.push(...wrap('· ' + rb, width, indent + '  '));
  }
  return lines;
}
