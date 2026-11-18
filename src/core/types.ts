/**
 * Havrin normalized data model.
 *
 * Adapters translate agent-specific session storage into these shapes.
 * Diagnostics and reporting consume only this model, never raw storage.
 *
 * Privacy contract: normalized records carry NO user message text, NO tool
 * output content, and NO raw tool input. They carry counts, timestamps,
 * fingerprints, tool names, file paths targeted by file tools, and coarse
 * command categories. Truncated tool error messages are retained (tool
 * generated, secret-redacted) because they are primary diagnostic evidence.
 * Session TITLES are the one deliberate free-text exception: they are
 * user-derived (often LLM-summarized), truncated to 120 chars, and disclosed
 * as a residual risk in docs/PRIVACY.md.
 */

export type AgentId = 'opencode' | 'codex' | 'claude';

export interface ModelRef {
  provider: string;
  model: string;
  variant?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

export const emptyTokens = (): TokenUsage => ({
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

export function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

export type ToolStatus = 'completed' | 'error' | 'running' | 'unknown';

/** Coarse classification of shell/exec commands. Raw commands are never stored. */
export type CommandCategory =
  | 'test'
  | 'build'
  | 'install'
  | 'git'
  | 'search'
  | 'run'
  | 'other';

export interface ToolCall {
  /** Agent-side call id, when available. */
  id?: string;
  name: string;
  status: ToolStatus;
  /** sha256 of canonicalized input; detects identical retries without storing input. */
  inputFingerprint: string;
  /** File path targeted by file tools (read/edit/write/glob), when extractable. */
  targetPath?: string;
  /** For shell/exec tools: coarse category of the command. */
  commandCategory?: CommandCategory;
  /** Tool-generated error type, e.g. "tool.execution". */
  errorType?: string;
  /** Truncated (200 char), secret-redacted tool error message. */
  errorMessage?: string;
  /** How status was determined: agent-reported, or inferred from output text. */
  statusSource: 'reported' | 'heuristic';
  startedAt?: number;
  endedAt?: number;
}

export interface AssistantError {
  type: string;
  message?: string;
}

export type SessionEvent =
  | {
      kind: 'user';
      at: number;
      id: string;
      textChars: number;
      fileCount: number;
    }
  | {
      kind: 'assistant';
      at: number;
      id: string;
      model?: ModelRef;
      agentName?: string;
      tokens?: TokenUsage;
      cost?: number;
      finish?: string;
      error?: AssistantError;
      /** Provider-side retry count when reported by the agent. */
      retries?: number;
      tools: ToolCall[];
      textChars: number;
      reasoningChars: number;
    }
  | {
      kind: 'compaction';
      at: number;
      reason?: string;
      tokens?: TokenUsage;
      cost?: number;
    }
  | { kind: 'model-switch'; at: number; from?: ModelRef; to?: ModelRef }
  | { kind: 'agent-switch'; at: number; from?: string; to?: string }
  | { kind: 'idle'; at: number; outcome?: string; error?: AssistantError }
  | { kind: 'turn-aborted'; at: number }
  /** Standalone tool event (Codex-style streams where calls are separate items). */
  | { kind: 'tool'; at: number; tool: ToolCall };

export interface SessionRecord {
  agent: AgentId;
  id: string;
  title?: string;
  directory?: string;
  createdAt: number;
  updatedAt: number;
  model?: ModelRef;
  agentName?: string;
  /** Agent-reported aggregates (may differ from sum of parsed events). */
  reportedTotals?: TokenUsage;
  reportedCost?: number;
  /**
   * Subagent (sidechain) activity, when the agent exposes it.
   * Undefined = not available from this agent's storage; NOT zero activity.
   */
  subagentStats?: { turns: number; toolCalls: number; toolErrors: number };
  events: SessionEvent[];
  /** True when some source rows/lines could not be parsed. */
  partial: boolean;
  parseWarnings: string[];
  source: {
    kind: 'sqlite' | 'jsonl';
    /** Storage location (db path or rollout file path). */
    location: string;
    /** Agent version that wrote the data, when known. */
    version?: string;
    /** Change signature used for incremental ingestion. */
    signature: string;
  };
}

export interface AgentInstallation {
  agent: AgentId;
  /** Binary path if found on PATH or in a known location. */
  binaryPath?: string;
  /** Version reported by `binary --version`, when obtainable. */
  version?: string;
  dataDir?: string;
  configPath?: string;
  sessionCount?: number;
  /** Storage layout detected, e.g. "sqlite-v2" or "jsonl-rollout". */
  layout?: string;
  issues: string[];
}

export type Severity = 'high' | 'medium' | 'low' | 'info';
export type Confidence = 'high' | 'medium' | 'low';

export interface Evidence {
  /** Human-readable, content-free description of one supporting observation. */
  description: string;
  sessionId?: string;
  agent?: AgentId;
  at?: number;
  value?: number;
}

export interface Finding {
  /** Stable rule identifier, e.g. "repeated-tool-failures". */
  ruleId: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  scope: 'environment' | 'sessions';
  agent?: AgentId;
  evidence: Evidence[];
  consequence: string;
  suggestion: string;
}

export interface Recommendation {
  id: string;
  findingRuleIds: string[];
  /** 1. What was identified. */
  what: string;
  /** 2. Why it matters. */
  why: string;
  /** 3. What change is proposed. */
  change: string;
  /** 4. What evidence supports it (content-free summaries). */
  evidence: string[];
  /** 5. Whether it has been experimentally tested. Always false in v0.1. */
  tested: boolean;
  testedNote: string;
  /** 6. Expected benefits and trade-offs. */
  benefits: string;
  tradeoffs: string;
  /** 7. How to apply the change (manual steps; Havrin never auto-applies in v0.1). */
  apply: string[];
  /** 8. How to reverse it. */
  rollback: string[];
}

export interface EnvironmentInfo {
  agents: AgentInstallation[];
  /** Configured MCP servers per agent config file. Names only, never env/command values. */
  mcpServers: { agent: AgentId; configPath: string; names: string[] }[];
  /** Skill directories discovered, with skill ids (directory names). */
  skills: { agent: AgentId | 'shared'; dir: string; ids: string[] }[];
  /** Instruction files discovered (path + size + sha256; never content). */
  instructionFiles: { path: string; bytes: number; sha256: string }[];
  /** Plaintext secret-looking config entries: key path + file only, never values. */
  secretExposures: { configPath: string; keyPath: string }[];
  warnings: string[];
}

export interface AuditWindow {
  /** Epoch ms lower bound (inclusive) for session updatedAt. */
  since: number;
  until: number;
  /** Max sessions analyzed per agent. */
  limit: number;
}

export interface AuditCoverage {
  sessionsDiscovered: number;
  sessionsAnalyzed: number;
  sessionsSkippedWindow: number;
  sessionsSkippedLimit: number;
  sessionsFailedRead: number;
  sessionsFromCache: number;
  partialSessions: number;
  parseWarnings: string[];
}

export interface AuditReport {
  schemaVersion: '1';
  havrinVersion: string;
  generatedAt: number;
  /** "demo" reports are built from clearly-labeled synthetic data. */
  mode: 'real' | 'demo';
  window: AuditWindow;
  environment: EnvironmentInfo;
  coverage: AuditCoverage;
  sessions: SessionSummary[];
  findings: Finding[];
  recommendations: Recommendation[];
  totals: {
    tokens: TokenUsage;
    cost: number;
    toolCalls: number;
    toolErrors: number;
    userTurns: number;
    assistantTurns: number;
  };
}

/** Content-free per-session summary included in reports. */
export interface SessionSummary {
  agent: AgentId;
  id: string;
  title?: string;
  directory?: string;
  createdAt: number;
  updatedAt: number;
  model?: ModelRef;
  tokens: TokenUsage;
  /**
   * Agent-reported session totals, when available. May exceed `tokens`
   * (e.g. Claude Code cost-state includes compaction/retry API calls that
   * produce no transcript message). Never fabricated.
   */
  reportedTokens?: TokenUsage;
  cost: number;
  userTurns: number;
  assistantTurns: number;
  toolCalls: number;
  toolErrors: number;
  compactions: number;
  /** Present only when the agent exposes sidechain data (Claude Code). */
  subagentStats?: { turns: number; toolCalls: number; toolErrors: number };
  partial: boolean;
}
