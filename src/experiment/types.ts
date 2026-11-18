/**
 * Experimentation engine data model (v0.3).
 *
 * Privacy contract extends to experiments: the registry stores benchmark
 * definitions (user-authored task prompts), configuration fingerprints,
 * execution metadata, and content-free metrics. It NEVER stores raw agent
 * conversation content, tool outputs, or credentials. Agent stdout is
 * captured to a transient file during execution, parsed only for structural
 * data (session id, exit status), and deleted.
 *
 * Honesty contract: every metric is tagged by availability. null means
 * "unavailable", never zero. Verdicts are deterministic functions of trial
 * results with explicit uncertainty; nothing is claimed as verified without
 * sufficient repeated evidence.
 */
import type { AgentId } from '../core/types.ts';
import type { TokenUsage, RecommendationState } from '../core/types.ts';

export type ExecutionAgent = AgentId | 'mock';

/** How a benchmark's starting workspace is materialized. */
export type BenchmarkSource =
  | { kind: 'template'; /** Directory of files copied into each trial workspace. */ path: string }
  | { kind: 'git'; /** Local repository cloned with --local --no-hardlinks (no network). */ path: string };

export type AcceptanceCheck =
  | { id: string; description: string; kind: 'test-command'; command: string; timeoutMs?: number }
  | { id: string; description: string; kind: 'file-exists'; path: string }
  | { id: string; description: string; kind: 'file-hash'; path: string; sha256: string }
  | { id: string; description: string; kind: 'command-succeeds'; command: string; timeoutMs?: number };

export interface BenchmarkSpec {
  schemaVersion: '1';
  id: string;
  title: string;
  description: string;
  source: BenchmarkSource;
  /** The task given to the agent. User-authored; stored for reproducibility. */
  taskPrompt: string;
  /** Deterministic checks run by Caliper AFTER the agent finishes. */
  acceptance: AcceptanceCheck[];
  limits: {
    /** Per-trial agent execution timeout. */
    timeoutMs: number;
  };
}

/** A competing development configuration. */
export interface ExperimentConfig {
  id: string;
  label: string;
  agent: ExecutionAgent;
  /** provider/model for opencode; model id for codex/claude; ignored for mock. */
  model?: string;
  /** OpenCode agent profile name. */
  agentName?: string;
  /**
   * Explicit instruction variant, prepended to the task prompt. This is how
   * instruction experiments work WITHOUT modifying any agent config file.
   */
  instructions?: string;
  /** Mock backend only: deterministic outcome script for fixtures/tests. */
  mockBehavior?: MockBehavior;
}

/** Deterministic mock execution script (tests/demo only; never a real agent). */
export interface MockBehavior {
  /** Simulated wall time per trial (ms). */
  durationMs: number;
  /** Simulated outcome. */
  outcome: 'success' | 'failure' | 'timeout' | 'error';
  /** Files to write into the workspace (simulated edits). Paths relative. */
  edits?: { path: string; content: string }[];
  /** Simulated session metrics (content-free). */
  metrics?: {
    tokens: TokenUsage;
    cost?: number;
    toolCalls: number;
    toolErrors: number;
    retries?: number;
    compactions?: number;
  };
  /** Optional per-trial variation seed for variance simulation. */
  variance?: { durationJitterMs: number; successEvery?: number };
}

export type TrialStatus = 'pending' | 'running' | 'completed' | 'timeout' | 'error' | 'interrupted';

export interface AcceptanceResult {
  id: string;
  description: string;
  passed: boolean;
  /** Structural detail only (exit code, counts) — never command output text. */
  detail?: string;
}

export interface TestStats {
  passed: number;
  failed: number;
  total: number;
  /** Which parser produced this (best-effort, labeled). */
  source: 'node-test-tap' | 'pytest' | 'exit-code-only';
}

export interface TrialResult {
  trialId: string;
  configId: string;
  /** Execution order index (for order-effect analysis). */
  order: number;
  status: TrialStatus;
  startedAt: number;
  finishedAt?: number;
  /** Wall-clock agent execution time (measured). */
  executionMs?: number;
  exitCode?: number;
  /** Agent session id when discoverable (metrics source). */
  sessionId?: string;
  /** Content-free metrics from the existing session adapter, when available. */
  sessionMetrics?: {
    tokens: TokenUsage;
    cost: number | null;
    toolCalls: number;
    toolErrors: number;
    retries: number;
    compactions: number;
    userTurns: number;
    assistantTurns: number;
  };
  /** Caliper-run verification (deterministic; not agent-reported). */
  verification?: {
    /** All acceptance checks passed. */
    success: boolean;
    checks: AcceptanceResult[];
    testStats: TestStats | null;
    durationMs: number;
  };
  error?: string;
  /** Workspace retained for debugging (opt-in). */
  workspaceKept?: boolean;
}

export type ExperimentStatus = 'ready' | 'running' | 'completed' | 'interrupted';

export interface ExperimentRecord {
  schemaVersion: '1';
  id: string;
  createdAt: number;
  updatedAt: number;
  status: ExperimentStatus;
  benchmark: BenchmarkSpec;
  /** sha256 over benchmark source files at creation (integrity/reproducibility). */
  benchmarkFingerprint: string;
  baselineConfigId: string;
  configs: ExperimentConfig[];
  configFingerprints: Record<string, string>;
  trialsPerConfig: number;
  /** Execution order randomization seed (recorded for reproducibility). */
  orderSeed: number;
  /** Linked recommendation ids (observe→diagnose→experiment→verify loop). */
  recommendationIds: string[];
  trials: TrialResult[];
  /** Environment metadata for reproducibility. */
  environment: {
    caliperVersion: string;
    platform: string;
    nodeVersion: string;
    agentVersions: Record<string, string | null>;
  };
  error?: string;
}

export type { RecommendationState };

export type VerdictConfidence = 'verified' | 'preliminary' | 'inconclusive';

export interface ConfigAggregate {
  configId: string;
  label: string;
  trials: number;
  completedTrials: number;
  successes: number;
  successRate: number | null;
  timeouts: number;
  errors: number;
  executionMs: { mean: number; median: number; stddev: number; min: number; max: number } | null;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number } | null;
  cost: number | null;
  toolCalls: number | null;
  toolErrors: number | null;
  testFailures: number | null;
}

export interface ExperimentVerdict {
  /** null when no defensible winner exists. */
  winnerConfigId: string | null;
  confidence: VerdictConfidence;
  /** Deterministic, human-readable reasoning. */
  reasons: string[];
  tradeoffs: string[];
  recommendationState: RecommendationState;
}

export interface ExperimentComparison {
  experimentId: string;
  benchmarkId: string;
  generatedAt: number;
  aggregates: ConfigAggregate[];
  verdict: ExperimentVerdict;
  /** Data availability notes (what could not be measured). */
  unavailable: string[];
}
