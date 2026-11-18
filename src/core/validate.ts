/**
 * Structural validators for untrusted/persisted data.
 * Used by the cache/artifact loaders (semantic corruption must be rejected
 * safely, never crash the pipeline) and the experiment registry.
 */
import type { SessionEvent, SessionRecord, ToolCall, Finding, Recommendation, SessionSummary, AuditSummary } from './types.ts';

export function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

export function isArr(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

const AGENTS = new Set(['opencode', 'codex', 'claude']);
const EVENT_KINDS = new Set([
  'user', 'assistant', 'compaction', 'model-switch', 'agent-switch', 'idle', 'turn-aborted', 'tool',
]);
const TOOL_STATUSES = new Set(['completed', 'error', 'running', 'unknown']);

export function isValidToolCall(v: unknown): v is ToolCall {
  if (!isObj(v)) return false;
  return (
    isStr(v['name']) &&
    isStr(v['status']) &&
    TOOL_STATUSES.has(v['status']) &&
    isStr(v['inputFingerprint']) &&
    (v['targetPath'] === undefined || isStr(v['targetPath'])) &&
    (v['errorMessage'] === undefined || isStr(v['errorMessage'])) &&
    (v['errorType'] === undefined || isStr(v['errorType']))
  );
}

export function isValidEvent(v: unknown): v is SessionEvent {
  if (!isObj(v) || !isStr(v['kind']) || !EVENT_KINDS.has(v['kind']) || !isNum(v['at'])) return false;
  switch (v['kind']) {
    case 'user':
      return isStr(v['id']) && isNum(v['textChars']) && isNum(v['fileCount']);
    case 'assistant':
      return (
        isStr(v['id']) &&
        isArr(v['tools']) &&
        v['tools'].every(isValidToolCall) &&
        isNum(v['textChars']) &&
        isNum(v['reasoningChars'])
      );
    case 'tool':
      return isValidToolCall(v['tool']);
    case 'compaction':
    case 'model-switch':
    case 'agent-switch':
    case 'idle':
    case 'turn-aborted':
      return true;
    default:
      return false;
  }
}

export function isValidSessionRecord(v: unknown): v is SessionRecord {
  if (!isObj(v)) return false;
  if (!isStr(v['agent']) || !AGENTS.has(v['agent'])) return false;
  if (!isStr(v['id']) || !isNum(v['createdAt']) || !isNum(v['updatedAt'])) return false;
  if (!isBool(v['partial']) || !isArr(v['parseWarnings']) || !v['parseWarnings'].every(isStr)) return false;
  if (!isArr(v['events']) || !v['events'].every(isValidEvent)) return false;
  const source = v['source'];
  if (!isObj(source) || !isStr(source['kind']) || !isStr(source['location']) || !isStr(source['signature'])) return false;
  if (v['reportedTotals'] !== undefined && !isObj(v['reportedTotals'])) return false;
  if (v['reportedCost'] !== undefined && !isNum(v['reportedCost'])) return false;
  if (v['title'] !== undefined && !isStr(v['title'])) return false;
  if (v['directory'] !== undefined && !isStr(v['directory'])) return false;
  if (v['subagentStats'] !== undefined) {
    const s = v['subagentStats'];
    if (!isObj(s) || !isNum(s['turns']) || !isNum(s['toolCalls']) || !isNum(s['toolErrors'])) return false;
  }
  return true;
}

const SEVERITIES = new Set(['high', 'medium', 'low', 'info']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);

export function isValidFinding(v: unknown): v is Finding {
  if (!isObj(v)) return false;
  return (
    isStr(v['ruleId']) &&
    isStr(v['title']) &&
    isStr(v['severity']) &&
    SEVERITIES.has(v['severity']) &&
    isStr(v['confidence']) &&
    CONFIDENCES.has(v['confidence']) &&
    isStr(v['consequence']) &&
    isStr(v['suggestion']) &&
    isArr(v['evidence']) &&
    v['evidence'].every((e) => isObj(e) && isStr(e['description']))
  );
}

export function isValidRecommendation(v: unknown): v is Recommendation {
  if (!isObj(v)) return false;
  return (
    isStr(v['id']) &&
    isStr(v['what']) &&
    isStr(v['why']) &&
    isStr(v['change']) &&
    isBool(v['tested']) &&
    isStr(v['testedNote']) &&
    isStr(v['benefits']) &&
    isStr(v['tradeoffs']) &&
    isArr(v['evidence']) &&
    v['evidence'].every(isStr) &&
    isArr(v['apply']) &&
    v['apply'].every(isStr) &&
    isArr(v['rollback']) &&
    v['rollback'].every(isStr) &&
    isArr(v['findingRuleIds']) &&
    v['findingRuleIds'].every(isStr)
  );
}

export function isValidSessionSummary(v: unknown): v is SessionSummary {
  if (!isObj(v)) return false;
  return (
    isStr(v['agent']) &&
    AGENTS.has(v['agent']) &&
    isStr(v['id']) &&
    isNum(v['createdAt']) &&
    isNum(v['updatedAt']) &&
    isObj(v['tokens']) &&
    isNum(v['cost']) &&
    isNum(v['userTurns']) &&
    isNum(v['assistantTurns']) &&
    isNum(v['toolCalls']) &&
    isNum(v['toolErrors']) &&
    isNum(v['compactions']) &&
    isBool(v['partial'])
  );
}

export function isValidAuditSummary(v: unknown): v is AuditSummary {
  if (!isObj(v)) return false;
  if (!isNum(v['generatedAt']) || (v['mode'] !== 'real' && v['mode'] !== 'demo')) return false;
  if (!isObj(v['window']) || !isNum(v['window']['since']) || !isNum(v['window']['until'])) return false;
  if (!isNum(v['sessionsAnalyzed']) || !isNum(v['findingsTotal'])) return false;
  if (!isObj(v['severity']) || !isObj(v['rules'])) return false;
  for (const s of ['high', 'medium', 'low', 'info']) if (!isNum(v['severity'][s])) return false;
  for (const key of Object.keys(v['rules'])) if (!isNum(v['rules'][key])) return false;
  return true;
}
