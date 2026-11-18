/**
 * Local state: incremental ingestion cache + last audit artifact.
 * Everything lives under havrinHome() (default ~/.local/share/havrin),
 * written atomically with 0600 permissions. Nothing leaves the machine.
 */
import path from 'node:path';
import fs from 'node:fs';
import type { AgentId, AuditReport, SessionRecord } from './core/types.ts';
import { havrinHome, writeJsonAtomic } from './core/fs.ts';
import { errorMessage } from './core/errors.ts';

const CACHE_SCHEMA_VERSION = 1;
const MAX_CACHED_SESSIONS = 500;

interface CacheFile {
  schemaVersion: number;
  agent: AgentId;
  entries: Record<string, { signature: string; record: SessionRecord }>;
}

export function lastAuditPath(): string {
  return path.join(havrinHome(), 'last-audit.json');
}

function cachePath(agent: AgentId): string {
  return path.join(havrinHome(), 'cache', `${agent}.json`);
}

export function loadCache(agent: AgentId): Map<string, { signature: string; record: SessionRecord }> {
  const file = cachePath(agent);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION || parsed.agent !== agent) {
      return new Map();
    }
    return new Map(Object.entries(parsed.entries ?? {}));
  } catch {
    // Missing or corrupt cache is non-fatal: fall back to full ingestion.
    return new Map();
  }
}

export function saveCache(
  agent: AgentId,
  entries: Map<string, { signature: string; record: SessionRecord }>,
): string | undefined {
  // Evict oldest-updated sessions beyond the cap.
  const sorted = [...entries.entries()].sort((a, b) => b[1].record.updatedAt - a[1].record.updatedAt);
  const kept = sorted.slice(0, MAX_CACHED_SESSIONS);
  const file: CacheFile = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    agent,
    entries: Object.fromEntries(kept),
  };
  try {
    writeJsonAtomic(cachePath(agent), file);
    return undefined;
  } catch (err) {
    return `cache write failed: ${errorMessage(err)}`;
  }
}

export function saveLastAudit(report: AuditReport): void {
  writeJsonAtomic(lastAuditPath(), report);
}

export function loadLastAudit(): AuditReport | undefined {
  const file = lastAuditPath();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as AuditReport;
    if (parsed.schemaVersion !== '1') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}
