# AGENTS.md — Havrin repository conventions

Instructions for AI coding agents (and humans) working on this repository.

## What this project is

Havrin is a local-first CLI that analyzes AI coding-agent session data and configuration, runs deterministic diagnostics, and produces evidence-backed recommendations. Read `README.md` and `docs/ARCHITECTURE.md` before making changes.

## Non-negotiable invariants

1. **Never modify agent source data.** OpenCode's SQLite DB is opened read-only (`node:sqlite` `readOnly: true`); Codex rollouts are only read. Tests assert byte-for-byte immutability — keep them.
2. **Never query credential tables.** In OpenCode's DB, only `session_v2`, `session_message`, `session_part` (probe), and `sqlite_master` may be queried. `account`, `control_account`, `credential`, `kv`, `permission`, etc. are off-limits.
3. **Content-free normalized model.** `src/core/types.ts` documents the privacy contract: no user text, no tool output content, no raw tool input in `SessionRecord`, reports, cache, or logs. Fingerprints, counts, paths, categories, and redacted/truncated tool error messages only. If you need a new field, ask whether it leaks content; default to no.
4. **No network at runtime.** v0.1 makes zero network requests. Do not add telemetry, update checks, or remote pricing without an explicit product decision.
5. **No auto-apply.** Recommendations are instructions for humans. Configuration changes require explicit user action; Havrin v0.1 writes only to its own state dir.
6. **Evidence before claims.** Every finding needs evidence + confidence. Never present observational results as experimentally verified (`tested` stays `false` until the experimentation engine exists).
7. **Deterministic diagnostics.** Rules are pure functions of normalized data. No LLM calls, no randomness, no wall-clock-dependent thresholds inside rules.

## Code conventions

- TypeScript, ESM, **erasable syntax only** (`erasableSyntaxOnly`): no enums, no parameter properties, no namespaces. Import relative paths with `.ts` extensions (tsc rewrites to `.js` on build; Node runs source directly via type stripping).
- `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` are on. Assign optional fields conditionally; don't pass `undefined` explicitly.
- Runtime dependencies: keep minimal. Currently only `smol-toml`. Prefer Node built-ins (`node:sqlite`, `node:test`, `util.parseArgs`, `node:crypto`).
- Adapters (`src/adapters/`) translate storage → normalized model and nothing else. Diagnostics (`src/diagnostics/rules.ts`) consume only the normalized model. Keep that boundary.
- Errors: throw `HavrinError` with a code + hint for user-facing failures; adapters must degrade to `partial: true` + `parseWarnings` for malformed rows, never crash an audit.
- Subprocesses: only fixed-argv `--version` probes, no shell, bounded timeout/output. Do not add other subprocess execution without a security review.

## Testing requirements

- `npm test` (node:test) must pass; `npm run typecheck` must be clean.
- New rules need positive AND negative tests at threshold boundaries in `test/rules.test.ts`.
- Adapter changes need fixture tests (`test/helpers.ts` builds synthetic OpenCode SQLite / Codex JSONL fixtures). Never test against real user data.
- Privacy-sensitive changes must extend `test/privacy.test.ts` (secret/text leakage assertions over report + artifact + cache).
- Verify schema assumptions against a real installed agent version before changing adapters; record the verified version in the adapter header comment.

## Environment overrides (tests / advanced use)

`HAVRIN_HOME`, `HAVRIN_OPENCODE_DATA_DIR`, `HAVRIN_OPENCODE_CONFIG_DIR`, `HAVRIN_CODEX_HOME` (also honors `CODEX_HOME`). Documented in `docs/ARCHITECTURE.md`. Do not rely on them in product defaults.

## Workflow

- Inspect → diagnose → plan → implement → verify → report. Run the smallest meaningful checks; investigate failures rather than skipping tests.
- Keep docs truthful: README capability tables and ROADMAP status must match implemented behavior. Mark planned features as planned.
- Commits: concise imperative subject; reference the subsystem (adapter/rules/cli/docs).
