# Havrin Roadmap

Status legend: ✅ implemented · 🚧 in progress · 🗺 planned (not implemented).
This file must match reality — planned features are never described as available.

## v0.1 — Vertical slice ✅

The complete observe → diagnose → recommend loop, zero LLM, zero network.

- ✅ `havrin doctor` — runtime/agent/storage health checks
- ✅ `havrin audit` — detect → ingest → environment scan → diagnostics → recommendations
- ✅ `havrin report --format json|terminal` — re-render last audit
- ✅ `havrin demo` — labeled synthetic dataset exercising all rules
- ✅ OpenCode adapter (SQLite, verified v2.3.1), Codex adapter (JSONL rollouts, verified 0.169.1)
- ✅ Incremental ingestion cache with signature invalidation
- ✅ 8 deterministic rules with evidence + confidence (see README table)
- ✅ 8-field recommendations, `tested: false`, manual apply + rollback
- ✅ Privacy contract enforced in the normalized model; leakage tests; read-only immutability tests
- ✅ Malformed/missing data → partial parses + clear messaging, never crashes
- ✅ Apache-2.0, one runtime dependency
- ✅ CI: GitHub Actions, ubuntu/macos × Node 22/24 (typecheck, tests, build, smoke)

## v0.2 — First-class Claude Code integration ✅ (current)

- ✅ Claude Code adapter (JSONL transcripts, verified 2.1.308–2.1.327 against a real 5,422-session / 1.81 GB collection)
- ✅ Split-record usage dedup by message id (verified on 5,434 real groups; cross-checked against cost-state)
- ✅ Reported tool failures (`tool_result.is_error`), interruption handling, unresolved-call semantics
- ✅ Token categories incl. cache creation/read and thinking tokens; agent-reported totals surfaced separately; cost suppressed when pricing is flagged unknown
- ✅ Subagent/sidechain statistics; compaction boundaries; model-switch events; synthetic-error handling
- ✅ Automatic discovery via standard locations (`CLAUDE_CONFIG_DIR` honored); multi-project; duplicate-id dedupe; permission-safe walking
- ✅ Incremental caching at collection scale (benchmark: 2.1 s initial / 0.6 s cached for 1,000 sessions; 2000-entry cache)
- ✅ Privacy: `~/.claude.json`/`.credentials.json` never opened; sentinel tests across every content-bearing record type
- ✅ All existing rules apply to Claude Code via the normalized model; MCP `mcp__server__tool` convention; project `.mcp.json` scanning; `~/.claude/skills` + `CLAUDE.local.md` discovery
- ✅ Independent security/correctness review of v0.1 completed; all confirmed defects fixed with regression tests (content-free parse warnings, redact-before-truncate, failed-test counting, evidence timestamps, `__proto__` fingerprint collisions, semantic cache validation, mtime/window boundary, WAL mode, size guards, and more)
- ✅ 131 automated tests; OpenCode/Codex behavior unchanged (full suite re-run)

### v0.2.x hardening (next)

- 🗺 OpenCode legacy JSON storage support (pre-2.x installs)
- 🗺 Codex: richer tool taxonomy (web search, MCP calls) and better failure inference validated against more versions
- 🗺 Claude: global MCP visibility without opening auth-bearing files (e.g. user-declared server list)
- 🗺 `havrin audit --project` multi-project environment aggregation
- 🗺 Report diffing (`havrin report --compare <file>`) to track finding counts over time
- 🗺 Packaging: npm publish, GitHub releases, checksums; Windows CI leg

## v0.3 — Deeper session intelligence 🗺

- 🗺 User-correction detection (deterministic signals: reverts after edits, re-asks, instruction repeats)
- 🗺 Cross-session habit aggregation (per-project and per-repo patterns, not just per-session)
- 🗺 Instruction-file analysis: overlap/redundancy detection across global/project/agent layers (content stays local; only structural findings reported)
- 🗺 Model/configuration switching analysis and cost-per-outcome views (pricing only where reliable, clearly labeled estimates)
- 🗺 Subagent efficiency diagnostics — only once evidence suffices (current data exposes counts, not outcomes)

## v0.4 — Software discovery 🗺

- 🗺 Session-driven candidate discovery: friction signals → relevant tools/skills/MCP servers (GitHub, registries, official docs)
- 🗺 Evaluation gates: relevance, compatibility, maintenance activity, license, security posture, installation complexity, overlap with existing functionality
- 🗺 External content treated as untrusted data; explicit consent before any network fetch; no execution of discovered software
- 🗺 Discovery results enter the same evidence/recommendation pipeline (never "popular therefore recommended")

## v0.5 — Experimentation engine 🗺 (the long-term differentiator)

- 🗺 Controlled A/B comparisons of configurations on equivalent workloads
- 🗺 Isolated execution environments with resource limits; never untrusted software on the host
- 🗺 Metrics: task correctness, test success, time, tokens, cost (where pricing is reliable), failure frequency
- 🗺 Repeated trials, uncertainty reporting, measured-vs-estimated separation
- 🗺 Only after this ships may any recommendation carry `tested: true`

## v0.6+ — Optimization loop 🗺

- 🗺 Consent-gated apply with preserved originals and safe rollback
- 🗺 Verify-on-real-work: post-change observation windows with statistical caution
- 🗺 Additional agents via standardized adapters; plugin surface for custom rules

## Explicit non-goals

- No mandatory account, subscription, or cloud backend.
- No generic agent dashboard or chat wrapper.
- No auto-execution of discovered software or auto-apply without consent.
- No telemetry. Any future network feature is opt-in, documented, and consent-gated.

## Competitive context

See [docs/research/competitive-landscape.md](docs/research/competitive-landscape.md) (sourced, 2026-11-17). Honest summary: observation is saturated (ccusage, Decant, Sniffly…); coarse friction signals exist (Decant Insights, self-optimize); the unoccupied ground is zero-LLM workflow-quality diagnostics across OpenCode+Codex, session-driven discovery, and controlled verification. Known weaknesses: the loop concept is not novel, Decant is better resourced, zero-LLM is also a capability ceiling, and A/B verification on real developer workflows is statistically hard.
