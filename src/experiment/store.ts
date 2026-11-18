/**
 * Persistent local experiment registry.
 *
 * Layout under havrinHome()/experiments/<id>/:
 *   experiment.json   — definition, configs, fingerprints, trial results
 *   run.lock          — pid lock while running (stale-lock recovery)
 *   scratch/          — transient execution artifacts (deleted after trials)
 *   workspaces/       — trial workspaces (deleted unless --keep-workspaces)
 *
 * Integrity: schemaVersion + deep shape validation on load; benchmark source
 * fingerprint recorded at creation and re-checked before runs. No raw
 * conversation content or credentials are ever stored here.
 */
import path from 'node:path';
import fs from 'node:fs';
import type { ExperimentRecord, TrialResult } from './types.ts';
import { havrinHome, writeJsonAtomic } from '../core/fs.ts';
import { HavrinError, errorMessage } from '../core/errors.ts';
import { isObj, isStr, isNum, isArr, isBool } from '../core/validate.ts';

export function experimentsDir(): string {
  return path.join(havrinHome(), 'experiments');
}

export function experimentDir(id: string): string {
  return path.join(experimentsDir(), id);
}

export function experimentFile(id: string): string {
  return path.join(experimentDir(id), 'experiment.json');
}

export function newExperimentId(): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `exp-${ts}-${rand}`;
}

function validTrial(v: unknown): v is TrialResult {
  if (!isObj(v) || !isStr(v['trialId']) || !isStr(v['configId']) || !isNum(v['order']) || !isNum(v['startedAt'])) return false;
  if (!['pending', 'running', 'completed', 'timeout', 'error', 'interrupted'].includes(v['status'] as string)) return false;
  if (v['verification'] !== undefined) {
    const ver = v['verification'];
    if (!isObj(ver) || !isBool(ver['success']) || !isArr(ver['checks']) || !isNum(ver['durationMs'])) return false;
  }
  if (v['sessionMetrics'] !== undefined) {
    const m = v['sessionMetrics'];
    if (!isObj(m) || !isObj(m['tokens']) || !isNum(m['toolCalls']) || !isNum(m['toolErrors'])) return false;
  }
  return true;
}

export function isValidExperimentRecord(v: unknown): v is ExperimentRecord {
  if (!isObj(v)) return false;
  if (v['schemaVersion'] !== '1' || !isStr(v['id']) || !isNum(v['createdAt']) || !isNum(v['updatedAt'])) return false;
  if (!['ready', 'running', 'completed', 'interrupted'].includes(v['status'] as string)) return false;
  if (!isObj(v['benchmark']) || !isStr(v['benchmarkFingerprint'])) return false;
  if (!isStr(v['baselineConfigId']) || !isArr(v['configs']) || v['configs'].length === 0) return false;
  if (!isObj(v['configFingerprints']) || !isNum(v['trialsPerConfig']) || !isNum(v['orderSeed'])) return false;
  if (!isArr(v['recommendationIds']) || !isArr(v['trials']) || !v['trials'].every(validTrial)) return false;
  if (!isObj(v['environment'])) return false;
  return true;
}

export function saveExperiment(record: ExperimentRecord): void {
  record.updatedAt = Date.now();
  writeJsonAtomic(experimentFile(record.id), record);
}

export function loadExperiment(id: string): ExperimentRecord {
  if (!/^[a-z0-9-]{1,80}$/.test(id)) {
    throw new HavrinError('USAGE', `Invalid experiment id: ${id}`);
  }
  const file = experimentFile(id);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new HavrinError('NO_DATA', `Experiment not found: ${id}`, 'Run havrin experiment list to see available experiments.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HavrinError('PARSE', `Experiment record ${id} is corrupted (invalid JSON).`);
  }
  if (!isValidExperimentRecord(parsed)) {
    throw new HavrinError('PARSE', `Experiment record ${id} failed integrity validation; refusing to load.`);
  }
  return parsed;
}

export function listExperiments(): { id: string; status: string; benchmarkId: string; createdAt: number; trials: number }[] {
  const dir = experimentsDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { id: string; status: string; benchmarkId: string; createdAt: number; trials: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('exp-')) continue;
    try {
      const record = loadExperiment(entry.name);
      out.push({
        id: record.id,
        status: record.status,
        benchmarkId: record.benchmark.id,
        createdAt: record.createdAt,
        trials: record.trials.length,
      });
    } catch {
      // Corrupt records are listed as such, never crash the listing.
      out.push({ id: entry.name, status: 'corrupted', benchmarkId: '?', createdAt: 0, trials: 0 });
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

// ---------------------------------------------------------------------------
// Run lock: protects against duplicated concurrent executions; stale locks
// (dead pid) are recovered automatically.
// ---------------------------------------------------------------------------

function lockPath(id: string): string {
  return path.join(experimentDir(id), 'run.lock');
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireRunLock(id: string): void {
  const file = lockPath(id);
  try {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: number };
    if (typeof existing.pid === 'number' && pidAlive(existing.pid)) {
      throw new HavrinError('IO', `Experiment ${id} is already running (pid ${existing.pid}).`, 'Wait for it to finish; stale locks from dead processes are recovered automatically.');
    }
  } catch (err) {
    if (err instanceof HavrinError) throw err;
    // Missing/corrupt lock → safe to take over.
  }
  fs.mkdirSync(experimentDir(id), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }), { mode: 0o600 });
}

export function releaseRunLock(id: string): void {
  try {
    fs.unlinkSync(lockPath(id));
  } catch {
    /* best effort */
  }
}

/** Mark running trials of a dead run as interrupted (recovery). */
export function recoverInterrupted(record: ExperimentRecord): boolean {
  let changed = false;
  for (const trial of record.trials) {
    if (trial.status === 'running' || trial.status === 'pending') {
      trial.status = 'interrupted';
      trial.finishedAt = Date.now();
      trial.error = 'run interrupted before completion';
      changed = true;
    }
  }
  if (record.status === 'running') {
    record.status = 'interrupted';
    changed = true;
  }
  return changed;
}

export function scratchDir(id: string): string {
  return path.join(experimentDir(id), 'scratch');
}

export function workspacesDir(id: string): string {
  return path.join(experimentDir(id), 'workspaces');
}

export function removeScratch(id: string): void {
  try {
    fs.rmSync(scratchDir(id), { recursive: true, force: true });
  } catch (err) {
    // Non-fatal; transient artifacts contain no retained content anyway.
    void errorMessage(err);
  }
}
