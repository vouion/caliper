# Caliper Roadmap

Status legend: ✅ implemented · 🚧 in progress · 🗺 planned (not implemented).
This file must match reality — planned features are never described as available.

## v0.1 — Vertical slice ✅

The complete observe → diagnose → recommend loop, zero LLM, zero network.

- ✅ `caliper doctor` — runtime/agent/storage health checks
- ✅ `caliper audit` — detect → ingest → environment scan → diagnostics → recommendations
- ✅ `caliper report --format json|terminal` — re-render last audit
- ✅ `caliper demo` — labeled synthetic dataset exercising all rules
- ✅ OpenCode adapter (SQLite, verified v2.3.1), Codex adapter (JSONL rollouts, verified 0.169.1)
- ✅ Incremental ingestion cache with signature invalidation
- ✅ 8 deterministic rules with evidence + confidence (see README table)
- ✅ 8-field recommendations, `tested: false`, manual apply + rollback
- ✅ Privacy contract enforced in the normalized model; leakage tests; read-only immutability tests
- ✅ Malformed/missing data → partial parses + clear messaging, never crashes
- ✅ Apache-2.0, one runtime dependency
- ✅ CI: GitHub Actions, ubuntu/macos × Node 22/24 (typecheck, tests, build, smoke)

## v0.2 — First-class Claude Code integration ✅

- ✅ Claude Code adapter (JSONL transcripts, verified 2.1.308–2.1.327 against a real 5,422-session / 1.81 GB collection)
- ✅ Split-record usage dedup by message id (verified on 5,434 real groups; cross-checked against cost-state)
- ✅ Reported tool failures (`tool_result.is_error`), interruption handling, unresolved-call semantics
- ✅ Token categories incl. cache creation/read and thinking tokens; agent-reported totals surfaced separately; cost suppressed when pricing is flagged unknown
- ✅ Subagent/sidechain statistics; compaction boundaries; model-switch events; synthetic-error handling
- ✅ Automatic discovery via standard locations (`CLAUDE_CONFIG_DIR` honored); multi-project; duplicate-id dedupe; permission-safe walking
- ✅ Incremental caching at collection scale (benchmark: 2.1 s initial / 0.6 s cached for 1,000 sessions; 2000-entry cache)
- ✅ Privacy: `~/.claude.json`/`.credentials.json` never opened; sentinel tests across every content-bearing record type
- ✅ All existing rules apply to Claude Code via the normalized model; MCP `mcp__server__tool` convention; project `.mcp.json` scanning; `~/.claude/skills` + `CLAUDE.local.md` discovery
- ✅ Independent security/correctness reviews of v0.1 and v0.2 completed; all confirmed defects fixed with regression tests (content-free parse warnings, redact-before-truncate, failed-test counting, evidence timestamps, `__proto__` fingerprint collisions + depth cap, deep semantic cache/artifact validation, terminal escape sanitization, api_error signal wiring, mention-vs-execution classification, mtime/window boundary, WAL mode, size guards, and more)

## v0.3 — Experimentation engine ✅ (current)

The observe → diagnose → **experiment → verify** loop, with correctness-first verdicts.

- ✅ Experiment registry: benchmark definitions, config fingerprints, environment metadata, trial results, integrity validation, atomic 0600 persistence
- ✅ Built-in `fix-failing-test` benchmark: real bug, 6-case node:test suite, anti-cheat test-file hash check
- ✅ Isolated trial workspaces (template copy / local git clone --no-hardlinks); source fingerprint re-verification blocks changed sources
- ✅ Seeded-random execution order, multi-trial repetition (1–20), hard timeouts, process-group termination
- ✅ Execution adapters separate from session adapters: mock (deterministic, free), OpenCode (interface-verified v2.3.1), Codex + Claude (implemented, live execution UNVERIFIED, extra-gated)
- ✅ Approval gates: `--approve-inference` for paid runs; `--allow-unverified` for unverified backends; `--dry-run` preview without approval
- ✅ Caliper-run deterministic verification (never agent-reported, never LLM-judged); test-count parsing (node:test spec/TAP, pytest) labeled by source
- ✅ Metrics via existing session adapters: tokens (all categories), agent-reported cost, tool calls/errors, retries, compactions; null ≠ zero
- ✅ Correctness-first verdicts: faster-but-incorrect never wins; efficiency requires material time AND token gains; confidence verified/preliminary/inconclusive with documented thresholds
- ✅ Recommendation lifecycle states (proposed → … → verified-improvement / regression-detected / inconclusive), auto-linked in `caliper audit`
- ✅ Run locks, stale-lock recovery, interrupted-run resume, completed-trial duplicate protection
- ✅ `caliper experiment list|create|run|report|inspect|demo`; terminal + JSON reports
- ✅ Privacy: no conversation content in registry; transient stdout artifacts deleted; workspace isolation tested; sentinel tests
- ✅ 182 automated tests; full v0.2 suite re-run with no regressions
- ⚠ Live paid-model experiments have NOT been run by the maintainers (approval-gated); real-run verification is the first v0.3.x item

### v0.3.x hardening (next)

- 🗺 Verified live OpenCode experiment end-to-end (with founder approval for inference spend)
- 🗺 Live verification of Codex/Claude execution backends
- 🗺 OpenCode legacy JSON storage support (pre-2.x installs)
- 🗺 Codex: richer tool taxonomy (web search, MCP calls) and better failure inference validated against more versions
- 🗺 Claude: global MCP visibility without opening auth-bearing files (e.g. user-declared server list)
- 🗺 Report diffing (`caliper report --compare <file>`) and experiment history tracking (`caliper experiment compare`)
- 🗺 Packaging: npm publish, GitHub releases, checksums; Windows CI leg

## v0.4 — Deeper session intelligence 🗺

- 🗺 User-correction detection (deterministic signals: reverts after edits, re-asks, instruction repeats)
- 🗺 Cross-session habit aggregation (per-project and per-repo patterns, not just per-session)
- 🗺 Instruction-file analysis: overlap/redundancy detection across global/project/agent layers (content stays local; only structural findings reported)
- 🗺 Model/configuration switching analysis and cost-per-outcome views (pricing only where reliable, clearly labeled estimates)
- 🗺 Subagent efficiency diagnostics — only once evidence suffices (current data exposes counts, not outcomes)
- 🗺 Skill/MCP configuration experiment variants (currently model/agent/instruction variants only; config-file variants need consent-gated apply)

## v0.5 — Software discovery 🗺

- 🗺 Session-driven candidate discovery: friction signals → relevant tools/skills/MCP servers (GitHub, registries, official docs)
- 🗺 Evaluation gates: relevance, compatibility, maintenance activity, license, security posture, installation complexity, overlap with existing functionality
- 🗺 External content treated as untrusted data; explicit consent before any network fetch; no execution of discovered software
- 🗺 Discovery results enter the same evidence/recommendation pipeline and become experiment candidates (never "popular therefore recommended")

## v0.6+ — Optimization loop 🗺

- 🗺 Consent-gated apply with preserved originals and safe rollback
- 🗺 Verify-on-real-work: post-change observation windows with statistical caution
- 🗺 Community benchmark suites, optional public leaderboards (opt-in, privacy-reviewed)
- 🗺 Additional agents via standardized adapters; plugin surface for custom rules and benchmarks
- 🗺 Optional graphical dashboard (only after the CLI loop is proven)

## Explicit non-goals

- No mandatory account, subscription, or cloud backend.
- No generic agent dashboard or chat wrapper.
- No auto-execution of discovered software or auto-apply without consent.
- No telemetry. Any future network feature is opt-in, documented, and consent-gated.

## Competitive context

See [docs/research/competitive-landscape.md](docs/research/competitive-landscape.md) (sourced, 2026-11-17). Honest summary: observation is saturated (ccusage, Decant, Sniffly…); coarse friction signals exist (Decant Insights, self-optimize); the unoccupied ground is zero-LLM workflow-quality diagnostics across OpenCode+Codex, session-driven discovery, and controlled verification. Known weaknesses: the loop concept is not novel, Decant is better resourced, zero-LLM is also a capability ceiling, and A/B verification on real developer workflows is statistically hard.
