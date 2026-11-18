/** Public programmatic API (stable surface for embedders and tests). */
export { runAudit } from './audit.ts';
export type { AuditOptions, AuditOutcome } from './audit.ts';
export { runDoctor } from './doctor.ts';
export type { DoctorCheck, DoctorResult } from './doctor.ts';
export { runDemoAudit, demoSessions, demoEnvironment } from './demo/dataset.ts';
export { renderTerminal, shouldUseColor } from './report/terminal.ts';
export { assembleReport } from './report/assemble.ts';
export { RULES, runDiagnostics } from './diagnostics/rules.ts';
export type { Rule, RuleContext } from './diagnostics/rules.ts';
export { OpenCodeAdapter } from './adapters/opencode.ts';
export { CodexAdapter } from './adapters/codex.ts';
export type { AgentAdapter, SessionMeta } from './adapters/adapter.ts';
export { HAVRIN_VERSION } from './version.ts';
export * from './core/types.ts';
