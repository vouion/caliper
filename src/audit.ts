/**
 * Audit orchestrator: detect → ingest (incremental) → environment →
 * diagnostics → recommendations → report. Pure orchestration; all analysis
 * lives in adapters/rules so it can be tested without touching real data.
 */
import type {
  AgentId,
  AgentInstallation,
  AuditCoverage,
  AuditReport,
  AuditWindow,
  SessionRecord,
} from './core/types.ts';
import type { AgentAdapter } from './adapters/adapter.ts';
import { OpenCodeAdapter } from './adapters/opencode.ts';
import { CodexAdapter } from './adapters/codex.ts';
import { ClaudeAdapter } from './adapters/claude.ts';
import { scanEnvironment } from './env/environment.ts';
import { assembleReport } from './report/assemble.ts';
import { loadCache, saveCache, saveLastAudit } from './store.ts';
import { errorMessage } from './core/errors.ts';

export const ADAPTERS: AgentAdapter[] = [new OpenCodeAdapter(), new CodexAdapter(), new ClaudeAdapter()];

export interface AuditOptions {
  /** Restrict to specific agents. Default: all supported. */
  agents?: AgentId[];
  /** Analyze sessions updated within this many ms before now. Default 30 days. */
  sinceMs?: number;
  /** Max sessions per agent. Default 100. */
  limit?: number;
  /** Project dir for environment scan. Default cwd. */
  projectDir?: string;
  /** Bypass the incremental cache (still writes it). */
  noCache?: boolean;
  /** Persist last-audit.json + cache. Default true. */
  persist?: boolean;
}

export const DEFAULT_SINCE_MS = 30 * 86_400_000;
export const DEFAULT_LIMIT = 100;

export interface AuditOutcome {
  report: AuditReport;
  /** Non-fatal problems worth surfacing (cache writes, adapter issues). */
  notices: string[];
}

export function runAudit(opts: AuditOptions = {}): AuditOutcome {
  const now = Date.now();
  const window: AuditWindow = {
    since: now - (opts.sinceMs ?? DEFAULT_SINCE_MS),
    until: now,
    limit: opts.limit ?? DEFAULT_LIMIT,
  };
  const selected = ADAPTERS.filter((a) => !opts.agents || opts.agents.includes(a.id));
  const notices: string[] = [];

  const installations: AgentInstallation[] = [];
  const sessions: SessionRecord[] = [];
  const coverage: AuditCoverage = {
    sessionsDiscovered: 0,
    sessionsAnalyzed: 0,
    sessionsSkippedWindow: 0,
    sessionsSkippedLimit: 0,
    sessionsFailedRead: 0,
    sessionsFromCache: 0,
    partialSessions: 0,
    parseWarnings: [],
  };

  for (const adapter of selected) {
    let installation: AgentInstallation;
    try {
      installation = adapter.detect();
    } catch (err) {
      installation = { agent: adapter.id, issues: [`detection failed: ${errorMessage(err)}`] };
    }
    installations.push(installation);
    for (const issue of installation.issues) notices.push(`[${adapter.id}] ${issue}`);
    if (
      installation.layout !== 'sqlite-v2' &&
      installation.layout !== 'jsonl-rollout' &&
      installation.layout !== 'jsonl-projects'
    )
      continue;

    let metas;
    try {
      metas = adapter.listSessions(installation);
    } catch (err) {
      notices.push(`[${adapter.id}] session listing failed: ${errorMessage(err)}`);
      continue;
    }
    coverage.sessionsDiscovered += metas.length;
    const inWindow = metas.filter((m) => m.updatedAt >= window.since && m.updatedAt <= window.until);
    coverage.sessionsSkippedWindow += metas.length - inWindow.length;
    const chosen = inWindow.slice(0, window.limit);
    coverage.sessionsSkippedLimit += inWindow.length - chosen.length;

    const cache = loadCache(adapter.id);
    const nextCache = new Map(cache);
    for (const meta of chosen) {
      const cached = opts.noCache ? undefined : cache.get(meta.id);
      let record: SessionRecord;
      if (cached && cached.signature === meta.signature) {
        record = cached.record;
        coverage.sessionsFromCache++;
      } else {
        try {
          record = adapter.readSession(installation, meta);
        } catch (err) {
          coverage.sessionsFailedRead++;
          notices.push(`[${adapter.id}] session ${meta.id} skipped: ${errorMessage(err)}`);
          continue;
        }
      }
      nextCache.set(meta.id, { signature: meta.signature, record });
      sessions.push(record);
      coverage.sessionsAnalyzed++;
      if (record.partial) {
        coverage.partialSessions++;
        for (const w of record.parseWarnings.slice(0, 3)) {
          if (coverage.parseWarnings.length < 20) coverage.parseWarnings.push(`[${adapter.id}/${meta.id}] ${w}`);
        }
      }
    }
    if (opts.persist !== false) {
      const cacheErr = saveCache(adapter.id, nextCache);
      if (cacheErr) notices.push(`[${adapter.id}] ${cacheErr}`);
    }
  }

  const environment = scanEnvironment(opts.projectDir !== undefined ? { projectDir: opts.projectDir } : {});
  environment.agents = installations;
  for (const w of environment.warnings) notices.push(`[env] ${w}`);

  const report = assembleReport({
    mode: 'real',
    generatedAt: now,
    window,
    environment,
    coverage,
    sessions,
  });

  if (opts.persist !== false) {
    try {
      saveLastAudit(report);
    } catch (err) {
      notices.push(`last-audit write failed: ${errorMessage(err)}`);
    }
  }
  return { report, notices };
}
