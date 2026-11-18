/**
 * Audit trend: content-free comparison of the current audit against the previous
 * one. Counts, rule ids, and timestamps only — never session content. Decreases
 * may reflect real fixes OR sessions aging out of the analysis window; the trend
 * surfaces the window change so the reader can interpret it honestly.
 */
import type { AuditReport, AuditSummary, AuditTrend, Severity, TrendDelta } from '../core/types.ts';

const SEVERITIES: Severity[] = ['high', 'medium', 'low', 'info'];

/** Compact, content-free snapshot of an audit for the history ring buffer. */
export function summarizeAudit(report: AuditReport): AuditSummary {
  const severity: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  const rules: Record<string, number> = {};
  for (const f of report.findings) {
    severity[f.severity]++;
    rules[f.ruleId] = (rules[f.ruleId] ?? 0) + 1;
  }
  return {
    generatedAt: report.generatedAt,
    mode: report.mode,
    window: { since: report.window.since, until: report.window.until },
    sessionsAnalyzed: report.coverage.sessionsAnalyzed,
    findingsTotal: report.findings.length,
    severity,
    rules,
  };
}

/** Compare two audit snapshots. Pure and deterministic. */
export function computeTrend(previous: AuditSummary, current: AuditSummary): AuditTrend {
  const delta = (p: number, c: number): TrendDelta => ({ previous: p, current: c, delta: c - p });
  const sev = (s: Severity): TrendDelta => delta(previous.severity[s] ?? 0, current.severity[s] ?? 0);
  const ruleIds = [...new Set([...Object.keys(previous.rules), ...Object.keys(current.rules)])].sort();
  const rules = ruleIds.map((ruleId) => {
    const p = previous.rules[ruleId] ?? 0;
    const c = current.rules[ruleId] ?? 0;
    return { ruleId, previous: p, current: c, delta: c - p };
  });
  const prevDuration = previous.window.until - previous.window.since;
  const curDuration = current.window.until - current.window.since;
  const severity = {} as Record<Severity, TrendDelta>;
  for (const s of SEVERITIES) severity[s] = sev(s);
  return {
    previousGeneratedAt: previous.generatedAt,
    windowChanged: prevDuration !== curDuration,
    findings: delta(previous.findingsTotal, current.findingsTotal),
    severity,
    rules,
    newRules: ruleIds.filter((id) => (previous.rules[id] ?? 0) === 0 && (current.rules[id] ?? 0) > 0),
    goneRules: ruleIds.filter((id) => (previous.rules[id] ?? 0) > 0 && (current.rules[id] ?? 0) === 0),
    sessionsAnalyzed: delta(previous.sessionsAnalyzed, current.sessionsAnalyzed),
  };
}

/** "+3" / "-6" / "0" */
export function formatDelta(d: number): string {
  return d > 0 ? `+${d}` : String(d);
}
