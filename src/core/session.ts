import type { SessionEvent, SessionRecord, ToolCall, TokenUsage } from './types.ts';
import { addTokens, emptyTokens } from './types.ts';

export interface ToolOccurrence {
  tool: ToolCall;
  at: number;
  /** Index in the session event stream. */
  index: number;
}

/** Iterate every tool call in stream order, regardless of event grouping. */
export function* iterTools(session: SessionRecord): Generator<ToolOccurrence> {
  for (let i = 0; i < session.events.length; i++) {
    const ev = session.events[i];
    if (!ev) continue;
    if (ev.kind === 'assistant') {
      for (const tool of ev.tools) yield { tool, at: ev.at, index: i };
    } else if (ev.kind === 'tool') {
      yield { tool: ev.tool, at: ev.at, index: i };
    }
  }
}

export function sessionTokens(session: SessionRecord): TokenUsage {
  let total = emptyTokens();
  for (const ev of session.events) {
    if ((ev.kind === 'assistant' || ev.kind === 'compaction') && ev.tokens) {
      total = addTokens(total, ev.tokens);
    }
  }
  // When parsing was partial and nothing usable was extracted, fall back to
  // agent-reported aggregates rather than reporting misleading zeros.
  if (
    session.partial &&
    total.input === 0 &&
    total.output === 0 &&
    session.reportedTotals
  ) {
    return session.reportedTotals;
  }
  return total;
}

export function sessionCost(session: SessionRecord): number {
  let cost = 0;
  let sawCost = false;
  for (const ev of session.events) {
    if ((ev.kind === 'assistant' || ev.kind === 'compaction') && typeof ev.cost === 'number') {
      cost += ev.cost;
      sawCost = true;
    }
  }
  if (!sawCost && typeof session.reportedCost === 'number') return session.reportedCost;
  return cost;
}

export function countEvents(session: SessionRecord, kind: SessionEvent['kind']): number {
  let n = 0;
  for (const ev of session.events) if (ev.kind === kind) n++;
  return n;
}

export function toolStats(session: SessionRecord): { calls: number; errors: number } {
  let calls = 0;
  let errors = 0;
  for (const { tool } of iterTools(session)) {
    calls++;
    if (tool.status === 'error') errors++;
  }
  return { calls, errors };
}
