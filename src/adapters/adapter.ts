import type { AgentId, AgentInstallation, SessionRecord } from '../core/types.ts';

/** Lightweight session listing used for windowing and incremental ingestion. */
export interface SessionMeta {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Change signature; cached records with a different signature are re-read. */
  signature: string;
  title?: string;
  directory?: string;
}

export interface AgentAdapter {
  readonly id: AgentId;
  /** Detect installation, storage layout, and basic health. Never throws for absence. */
  detect(): AgentInstallation;
  /** List sessions cheaply (no message parsing). [] when no data. */
  listSessions(installation: AgentInstallation): SessionMeta[];
  /** Fully parse one session. Must never modify source data. */
  readSession(installation: AgentInstallation, meta: SessionMeta): SessionRecord;
}
