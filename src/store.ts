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
// Normalized records are content-free and small (~KB each); 2000 entries
// cover large active collections (verified: 5.4k-session Claude install)
// without meaningful disk/memory cost. Oldest-updated entries evict first.
const MAX_CACHED_SESSIONS = 2000;

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
    const out = new Map<string, { signature: string; record: SessionRecord }>();
    for (const [id, entry] of Object.entries(parsed.entries ?? {})) {
      // Shape-validate: semantically corrupt entries must be dropped, not
      // trusted into the pipeline (valid JSON ≠ valid cache).
      if (
        entry !== null &&
        typeof entry === 'object' &&
        typeof entry.signature === 'string' &&
        entry.record !== null &&
        typeof entry.record === 'object' &&
        typeof entry.record.id === 'string' &&
        Array.isArray(entry.record.events) &&
        typeof entry.record.updatedAt === 'number'
      ) {
        out.set(id, entry);
      }
    }
    return out;
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
    // Minimal shape validation: a hand-edited or semantically corrupt
    // artifact must not crash the renderer.
    if (
      parsed.schemaVersion !== '1' ||
      (parsed.mode !== 'real' && parsed.mode !== 'demo') ||
      !Array.isArray(parsed.sessions) ||
      !Array.isArray(parsed.findings) ||
      !Array.isArray(parsed.recommendations) ||
      parsed.environment === null ||
      typeof parsed.environment !== 'object' ||
      parsed.coverage === null ||
      typeof parsed.coverage !== 'object' ||
      parsed.totals === null ||
      typeof parsed.totals !== 'object' ||
      parsed.window === null ||
      typeof parsed.window !== 'object'
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}
