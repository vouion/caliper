# Havrin Roadmap

Status legend: ✅ implemented · 🚧 in progress · 🗺 planned (not implemented).
This file must match reality — planned features are never described as available.

## v0.1 — Vertical slice ✅ (current)

The complete observe → diagnose → recommend loop for two agents, zero LLM, zero network.

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
- ✅ Apache-2.0, one runtime dependency, 76 automated tests

### v0.1.x hardening (next)

- 🗺 OpenCode legacy JSON storage support (pre-2.x installs)
- 🗺 Codex: richer tool taxonomy (web search, MCP calls) and better failure inference validated against more versions
- 🗺 `havrin audit --project` multi-project environment aggregation
- 🗺 Report diffing (`havrin report --compare <file>`) to track finding counts over time
- 🗺 Packaging: npm publish, GitHub releases, checksums; CI matrix (Linux/macOS/Windows, Node 22/24/26)

## v0.2 — Deeper session intelligence 🗺

- 🗺 Claude Code adapter (JSONL transcripts) via the same `AgentAdapter` interface
- 🗺 User-correction detection (deterministic signals: reverts after edits, re-asks, instruction repeats)
- 🗺 Cross-session habit aggregation (per-project and per-repo patterns, not just per-session)
- 🗺 Instruction-file analysis: overlap/redundancy detection across global/project/agent layers (content stays local; only structural findings reported)
- 🗺 Model/configuration switching analysis and cost-per-outcome views (pricing only where reliable, clearly labeled estimates)

## v0.3 — Software discovery 🗺

- 🗺 Session-driven candidate discovery: friction signals → relevant tools/skills/MCP servers (GitHub, registries, official docs)
- 🗺 Evaluation gates: relevance, compatibility, maintenance activity, license, security posture, installation complexity, overlap with existing functionality
- 🗺 External content treated as untrusted data; explicit consent before any network fetch; no execution of discovered software
- 🗺 Discovery results enter the same evidence/recommendation pipeline (never "popular therefore recommended")

## v0.4 — Experimentation engine 🗺 (the long-term differentiator)

- 🗺 Controlled A/B comparisons of configurations on equivalent workloads
- 🗺 Isolated execution environments with resource limits; never untrusted software on the host
- 🗺 Metrics: task correctness, test success, time, tokens, cost (where pricing is reliable), failure frequency
- 🗺 Repeated trials, uncertainty reporting, measured-vs-estimated separation
- 🗺 Only after this ships may any recommendation carry `tested: true`

## v0.5+ — Optimization loop 🗺

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
