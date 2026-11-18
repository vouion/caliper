/** Validation for experiment definitions (untrusted user input). */
import type { BenchmarkSpec, ExperimentConfig, AcceptanceCheck, MockBehavior } from './types.ts';
import { isObj, isStr, isNum, isArr } from '../core/validate.ts';
import { HavrinError } from '../core/errors.ts';

const AGENTS = new Set(['opencode', 'codex', 'claude', 'mock']);
const CHECK_KINDS = new Set(['test-command', 'file-exists', 'file-hash', 'command-succeeds']);

function fail(msg: string): never {
  throw new HavrinError('USAGE', `Invalid experiment definition: ${msg}`);
}

function validCheck(v: unknown): v is AcceptanceCheck {
  if (!isObj(v) || !isStr(v['id']) || !isStr(v['description']) || !isStr(v['kind']) || !CHECK_KINDS.has(v['kind'])) return false;
  // check.id is used in scratch filenames; restrict charset to prevent path
  // traversal via a crafted benchmark definition (defense in depth).
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(v['id'])) return false;
  switch (v['kind']) {
    case 'test-command':
    case 'command-succeeds':
      return isStr(v['command']) && (v['timeoutMs'] === undefined || isNum(v['timeoutMs']));
    case 'file-exists':
      return isStr(v['path']);
    case 'file-hash':
      return isStr(v['path']) && isStr(v['sha256']) && /^[0-9a-f]{64}$/.test(v['sha256']);
    default:
      return false;
  }
}

export function validateBenchmark(v: unknown): BenchmarkSpec {
  if (!isObj(v)) fail('benchmark must be an object');
  if (v['schemaVersion'] !== '1') fail('benchmark schemaVersion must be "1"');
  if (!isStr(v['id']) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(v['id'])) fail('benchmark id must be lowercase kebab-case (max 64 chars)');
  if (!isStr(v['title']) || !isStr(v['description']) || !isStr(v['taskPrompt']) || v['taskPrompt'].length === 0) {
    fail('benchmark requires title, description, taskPrompt');
  }
  const source = v['source'];
  if (!isObj(source) || (source['kind'] !== 'template' && source['kind'] !== 'git') || !isStr(source['path'])) {
    fail('benchmark source must be {kind: template|git, path}');
  }
  if (!isArr(v['acceptance']) || v['acceptance'].length === 0 || !v['acceptance'].every(validCheck)) {
    fail('benchmark requires at least one valid acceptance check');
  }
  const ids = v['acceptance'].map((c) => (c as AcceptanceCheck).id);
  if (new Set(ids).size !== ids.length) fail('acceptance check ids must be unique');
  const limits = v['limits'];
  if (!isObj(limits) || !isNum(limits['timeoutMs']) || limits['timeoutMs'] < 1000 || limits['timeoutMs'] > 3_600_000) {
    fail('limits.timeoutMs must be between 1s and 1h');
  }
  return v as unknown as BenchmarkSpec;
}

function validMockBehavior(v: unknown): v is MockBehavior {
  if (!isObj(v)) return false;
  if (!isNum(v['durationMs']) || v['durationMs'] < 0) return false;
  if (!['success', 'failure', 'timeout', 'error'].includes(v['outcome'] as string)) return false;
  if (v['edits'] !== undefined) {
    if (!isArr(v['edits'])) return false;
    for (const e of v['edits']) {
      if (!isObj(e) || !isStr(e['path']) || !isStr(e['content'])) return false;
      if (e['path'].startsWith('/') || e['path'].split('/').includes('..')) return false;
    }
  }
  if (v['metrics'] !== undefined) {
    const m = v['metrics'];
    if (!isObj(m) || !isObj(m['tokens']) || !isNum(m['toolCalls']) || !isNum(m['toolErrors'])) return false;
  }
  return true;
}

export function validateConfig(v: unknown): ExperimentConfig {
  if (!isObj(v)) fail('config must be an object');
  if (!isStr(v['id']) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(v['id'])) fail('config id must be lowercase kebab-case');
  if (!isStr(v['label']) || v['label'].length === 0) fail('config requires a label');
  if (!isStr(v['agent']) || !AGENTS.has(v['agent'])) fail('config agent must be opencode|codex|claude|mock');
  if (v['model'] !== undefined && !isStr(v['model'])) fail('config model must be a string');
  if (v['agentName'] !== undefined && !isStr(v['agentName'])) fail('config agentName must be a string');
  if (v['instructions'] !== undefined && !isStr(v['instructions'])) fail('config instructions must be a string');
  if (v['agent'] === 'mock') {
    if (!validMockBehavior(v['mockBehavior'])) fail('mock config requires a valid mockBehavior');
  } else if (v['mockBehavior'] !== undefined) {
    fail('mockBehavior is only valid for the mock agent');
  }
  return v as unknown as ExperimentConfig;
}
