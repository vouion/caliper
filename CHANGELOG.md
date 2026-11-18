# Changelog

All notable changes to Caliper are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Caliper is pre-1.0:
minor versions may include breaking changes to the JSON report schema or CLI.

## [Unreleased]

### Added
- `caliper prompt`: generate a provider-agnostic, agent-ready prompt from the last audit that instructs your own coding agent to apply the fixes — operating rules (reversible changes, secret hygiene, test verification, rollback changelog), severity-prioritized fixes with evidence/apply/rollback/trade-offs, agent-specific instruction-file references, and a definition of done. Deterministic and zero-LLM; content-free (sentinel-tested). Flags: `--agent generic|opencode|codex|claude`, `--min-severity low|medium|high`, `--output <file>`, `--demo`, `--json`. Caliper still applies nothing itself.
- Prismatic brand hero (`assets/social-preview.png`) matching the Havrin design reference; README hero banner.

### Changed
- Package renamed to `@vouion/caliper` for npm (the unscoped `caliper` name is already taken); registry publish pending account 2FA.
- Test suite expanded to 201 (fix-prompt unit + CLI tests; the privacy contract now also covers the prompt output surface).

## 0.3.0 — Experimentation engine

### Added
- Reproducible experiment engine: `caliper experiment list | create | run | report | inspect | demo`.
- Built-in `fix-failing-test` benchmark with a deterministic test suite and an anti-cheat test-file hash acceptance check.
- Isolated trial workspaces (template copy or local `git clone --no-hardlinks`), seeded execution order, multi-trial repetition.
- Execution adapters (separate from session adapters): deterministic mock backend; OpenCode (interface-verified); Codex and Claude Code (implemented, live execution unverified and extra-gated).
- Approval gates: `--approve-inference` for paid runs, `--allow-unverified` for unverified backends, `--dry-run` preview.
- Controlled subprocess execution: fixed argv, hard timeouts, process-group termination, capped transient output (deleted after parsing).
- Havrin-run deterministic correctness verification (never agent-reported or LLM-judged); test-count parsing for node:test and pytest.
- Correctness-first verdicts with explicit confidence (`verified` / `preliminary` / `inconclusive`); null ≠ zero metric availability.
- Recommendation lifecycle states auto-linked to experiments in `caliper audit`.
- Experiment registry with config/source fingerprints, integrity validation, atomic run locks, stale-lock recovery, and completed-trial duplicate protection.
- `docs/BENCHMARKS.md` (methodology + measured results, including a founder-approved live OpenCode experiment) and `docs/REVIEW-STATUS.md`.
- OSS scaffolding: CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue/PR templates, funding metadata.

### Changed
- Rebranded from Havrin to **Caliper by Havrin** (Havrin retained as the studio brand). Package/bin `caliper`, `CALIPER_*` environment overrides, state dir `~/.local/share/caliper`.

### Security
- Acceptance `check.id` charset restricted (scratch path-traversal defense); trial error text sanitized; missing-config trials marked `error`.

## 0.2.0 — First-class Claude Code integration

### Added
- Claude Code session adapter (JSONL transcripts, verified 2.1.308–2.1.327 against a real 5,422-session collection).
- Split-record usage dedup by message id (verified on 5,434 real groups; cross-checked against agent-reported `cost-state`).
- Reported tool failures (`tool_result.is_error`), interruption handling, sidechain/subagent statistics, compaction boundaries, model-switch events.
- Token categories including cache creation/read and thinking tokens; agent-reported totals surfaced separately; cost suppressed when pricing is flagged unknown.
- Environment discovery for Claude: `settings.json` secret exposure, project `.mcp.json`, `~/.claude/skills`, `CLAUDE.local.md`; `mcp__server__tool` convention.

### Security
- Remediated all findings from the independent v0.1 and v0.2 reviews: deep semantic cache/artifact validation, terminal control-character sanitization, content-free parse warnings, redact-before-truncate, `__proto__` fingerprint collision + depth cap, mention-vs-execution command classification, `api_error` signal wiring, mtime/window boundary fix, WAL-mode and size guards. See `docs/REVIEW-STATUS.md`.

## 0.1.0 — Vertical slice

### Added
- `caliper doctor | audit | report | demo` (originally released as Havrin).
- OpenCode (SQLite, verified v2.3.1) and Codex CLI (JSONL rollouts, verified 0.169.1) session adapters; read-only ingestion with incremental caching.
- Environment scan: configs, MCP servers, skills, instruction files, plaintext-secret exposure detection.
- Eight deterministic diagnostic rules with evidence and confidence; eight-field recommendations (`tested: false`, manual apply + rollback).
- Terminal + JSON reports; clearly-labeled synthetic demo dataset.
- Privacy contract enforced in the normalized model with sentinel-leak and read-only immutability tests. Apache-2.0, one runtime dependency.

