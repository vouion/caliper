/** Shared report assembly used by both real audits and the synthetic demo. */
import type {
  AuditCoverage,
  AuditReport,
  AuditWindow,
  EnvironmentInfo,
  SessionRecord,
  SessionSummary,
} from '../core/types.ts';
import { emptyTokens, addTokens } from '../core/types.ts';
import { sessionTokens, sessionCost, countEvents, toolStats } from '../core/session.ts';
import { runDiagnostics } from '../diagnostics/rules.ts';
import { buildRecommendations } from '../optimize/recommend.ts';
import { HAVRIN_VERSION } from '../version.ts';

export function assembleReport(args: {
  mode: 'real' | 'demo';
  generatedAt: number;
  window: AuditWindow;
  environment: EnvironmentInfo;
  coverage: AuditCoverage;
  sessions: SessionRecord[];
}): AuditReport {
  const { sessions, environment } = args;
  const findings = runDiagnostics({ sessions, environment });
  const recommendations = buildRecommendations(findings);

  let tokens = emptyTokens();
  let cost = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let userTurns = 0;
  let assistantTurns = 0;
  const summaries: SessionSummary[] = [];
  for (const s of sessions) {
    const t = sessionTokens(s);
    const c = sessionCost(s);
    const stats = toolStats(s);
    tokens = addTokens(tokens, t);
    cost += c;
    toolCalls += stats.calls;
    toolErrors += stats.errors;
    const users = countEvents(s, 'user');
    const assistants = countEvents(s, 'assistant');
    userTurns += users;
    assistantTurns += assistants;
    const summary: SessionSummary = {
      agent: s.agent,
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      tokens: t,
      cost: c,
      userTurns: users,
      assistantTurns: assistants,
      toolCalls: stats.calls,
      toolErrors: stats.errors,
      compactions: countEvents(s, 'compaction'),
      partial: s.partial,
    };
    if (s.title) summary.title = s.title;
    if (s.directory) summary.directory = s.directory;
    if (s.model) summary.model = s.model;
    summaries.push(summary);
  }
  summaries.sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    schemaVersion: '1',
    havrinVersion: HAVRIN_VERSION,
    generatedAt: args.generatedAt,
    mode: args.mode,
    window: args.window,
    environment,
    coverage: args.coverage,
    sessions: summaries,
    findings,
    recommendations,
    totals: { tokens, cost, toolCalls, toolErrors, userTurns, assistantTurns },
  };
}
