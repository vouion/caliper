# Havrin — Competitive Landscape Research

**Access date:** 2026-11-17 (all URLs below were fetched on this date unless marked otherwise).
**Method:** web search + direct fetch of GitHub repo pages, raw READMEs, and official docs. Only URLs actually fetched are cited as sources. Items known only from search-result previews or topic listings are explicitly marked as such and were not deep-verified. Nothing here is inferred from project names alone.

**Havrin baseline (for comparison):** local-first, privacy-preserving CLI; analyzes OpenCode + Codex CLI session history; deterministic (zero-LLM) diagnostics — repeated tool failures, retries, redundant file reads, missing test verification, conflicting instructions, redundant skills/MCP servers; evidence-backed recommendations; long-term software discovery + controlled A/B experimentation. Commands: `havrin doctor / audit / report --format json`. Apache-2.0, TypeScript.

---

## 1. Summary table

| Project | URL (fetched) | License | What it actually is | Overlap with Havrin | Gap vs Havrin |
|---|---|---|---|---|---|
| **Decant** (dosu-ai) | github.com/dosu-ai/decant | Apache-2.0 | Local-first searchable archive + analytics of 8 coding-agent log sources incl. OpenCode & Codex; threshold-based "Insights" recommendations; distills scripts/skills from history; `decant doctor` | **Very high** on observe + partial diagnose + partial discover; same license, same language family (TS/Bun) | No workflow-quality diagnostics (test verification, instruction conflicts), no experiment/verify loop, no software discovery |
| **self-optimize** (acertainKnight) | github.com/acertainKnight/self-optimize | **No LICENSE file visible → Unknown** | Claude Code plugin: deterministic collection → LLM analysts with citation checks → human-gated apply → statistical verification on next real sessions; eval gym + Pareto variant archive; Codex/OpenCode evidence-only adapters | **Very high** on the full observe→diagnose→recommend→apply→verify loop | Requires LLM analysts; Claude-Code-first runner; no software discovery; verification is observational pre/post, not controlled A/B |
| **AgentArena** (aidriventesting) | github.com/aidriventesting/AgentArena | MIT | Static UI-grounding benchmark (UIArena v1, 15 environments), Next.js static site | Low (benchmarking only) | Different domain (UI grounding, not dev workflows) |
| **AgentArena** (williampeytz.com) | williampeytz.com/agentarena | Unknown (no repo found) | Beta website: coding-agent "matches", replays, leaderboard, patch comparison | Medium conceptually (agent execution observability/benchmarking) | Hosted benchmark service; no public repo located; not local session diagnostics |
| **agentarena-evmbench** (NethermindEth) | github.com/NethermindEth/agentarena-evmbench | Apache-2.0 | Benchmark + harness for finding/exploiting smart-contract bugs; runs Codex detect-only in Docker workers | Low | Different domain (smart-contract security) |
| **AgentArena** (JustInternetAI) | github.com/JustInternetAI/AgentArena | Apache-2.0 | Godot 4 framework for LLM-driven NPCs + eval harness | Low | Game agents, not developer workflows |
| **Tool Scout** (LpcPaul) | github.com/LpcPaul/tool-scout-skill | MIT | Agent Skill: multi-source software/tool discovery (GitHub, npm, MCP registries, skill dirs, VS Code/Open VSX, web) with V0/V1 evidence gates + explainable ranking | High on Havrin's long-term "software discovery" | Query-driven, not session/friction-driven; no analysis of agent history; no verification |
| **SWE-bench** | github.com/SWE-bench/SWE-bench | MIT | Benchmark: resolve real GitHub issues; Docker eval harness, datasets (Verified/Lite/Multimodal/Multilingual), v5 CLI | Low–medium (verification of outcomes, not workflows) | Capability benchmark; no personal session analysis, no diagnostics |
| **Terminal-Bench** | github.com/laude-institute/terminal-bench (→ harbor-framework/terminal-bench-1) | Apache-2.0 | ~100 terminal tasks + test scripts + oracle solutions; `tb` harness; leaderboard; successor framework "harbor" for TB 2.0 | Low–medium | Same: capability benchmark, not workflow diagnostics |
| **ccusage** | github.com/ccusage/ccusage | MIT | Local CLI: token/cost reports (daily/weekly/monthly/session/blocks) across ~20 agent CLIs incl. Claude Code, Codex, OpenCode; JSON output; 19.5k stars | High on "observe" (usage/cost only) | No diagnostics, no recommendations, no experiments |
| **OpenCode `opencode stats`** (built-in) | github.com/anomalyco/opencode/issues/5555 | (part of OpenCode) | Built-in aggregate usage stats across sessions; issue requesting per-session stats closed as completed 2026-03-25 | Medium on "observe" | Aggregate usage only |
| **Sniffly** (chiphuyen) | github.com/chiphuyen/sniffly | MIT | Local Claude Code dashboard: usage stats, **error-type breakdown**, message-history walkthrough; opt-in shareable dashboards | Medium (error analysis ≈ repeated-failure observation) | Claude-only; dashboard not CLI diagnostics; no recommendations/verify; sharing is an upload path |
| **Claude-Code-Usage-Monitor** (Maciek-roboblog) | github.com/Maciek-roboblog/Claude-Code-Usage-Monitor | MIT | Real-time burn-rate/limit monitor (`claude-monitor`), official statusline rate_limits trust layer, local usage warehouse, forecasting | Low–medium (usage ops) | Claude-only; explicitly not workflow diagnostics; OpenCode out of scope per README |
| **claude-code-usage-analyzer** (aarora79) | github.com/aarora79/claude-code-usage-analyzer | MIT | Python CLI wrapping ccusage + LiteLLM pricing; statistical cost reports + self-contained HTML "tokenomics" dashboard with ±2σ anomaly flags | Low–medium (cost analytics) | Cost governance, not workflow diagnostics; Claude-only |
| **opencode-tokenscope** (ramtinJ95) | github.com/ramtinJ95/opencode-tokenscope | MIT | OpenCode plugin (V1+V2): per-session token/cache/context/cost report; no-model-request panel; recorded-vs-estimated separation; subagent totals | Medium on context/redundancy observation | Per-session accounting; no cross-session diagnostics, recommendations, or experiments |
| **opencode-stats / oc-stats** (cateds) | lib.rs/crates/opencode-stats | MIT | Rust TUI dashboard over OpenCode SQLite/JSON exports: tokens, cost, models, providers, 365-day heatmap | Medium on "observe" | Usage dashboard only |
| **mentor** (smixs) | github.com/smixs/mentor | MIT | Agent skill: deterministic `collect.py` over Claude Code + Codex history, then **LLM-written** 8-section HTML report incl. friction points with evidence + suggested CLAUDE.md lines | High on observe→diagnose→recommend (report form) | LLM-dependent analysis; no OpenCode; no apply/verify/experiment loop |
| **session-intelligence** (tetriz-ai) | github.com/tetriz-ai/session-intelligence | MIT | Go engine: deterministic spine + 3 LLM passes (read/evidence/discard); per-session verdict/turns/phases; security flags (key/credential/PII leaks); BYO LLM | High on diagnose (per-session, LLM-judged) | No OpenCode support; explicitly no cross-session habit tracking; no experiments; round-trip detector is an off-by-default placeholder |
| **cLens** (silouone) | github.com/silouone/clens | MIT | Claude Code hook capture + 20+ deterministic extractors: backtracks, decisions, edit chains, plan drift, multi-agent trees; CLI/TUI/web; `--json` | High on deterministic workflow diagnostics | Claude-only; "measures, doesn't editorialize" — no recommendation engine, config audit, or verify loop |

Projects seen only in search previews / topic listings (not deep-verified): `codingstark-dev/decant` (unrelated Rust website-mirroring tool), `Shlomob/ocmonitor-share` (OpenCode monitor CLI), and several small session-analysis repos listed in §3.6.

---

## 2. Named projects — detailed notes

### 2.1 Decant (dosu-ai/decant) — the closest direct competitor

- **Sources fetched:** https://github.com/dosu-ai/decant (repo page + full README) and https://raw.githubusercontent.com/dosu-ai/decant/main/docs/analytics-methodology.md
- **What it is (verified):** "See where your coding agents spend tokens, money, and time." A local-first, searchable SQLite archive of session logs from **Claude Code, Codex (split into app/cli/other), Gemini CLI, OpenCode ≥1.2, Cursor CLI, GitHub Copilot CLI, Copilot Chat in VS Code, Hermes Agent**, plus ATIF trajectory import/export. Built by Dosu (a company, dosu.dev). One Bun + TypeScript application; CLI + local web UI + local HTTP API with an OpenAPI 3.1 contract.
- **License:** Apache-2.0 (visible on repo page and README).
- **Traction (as displayed 2026-11-17):** 75 stars, 6 forks, 449 commits; OpenSSF Scorecard + Best Practices badges; npm `@dosu/decant`, Homebrew, shell installer, Docker.
- **Privacy posture (verified from README):** no outbound network calls at runtime (opt-in update check excepted). **Caveat they state themselves:** the archive is an *unencrypted* SQLite copy of transcripts (prompts, tool inputs/outputs, source code, paths, any pasted credentials), owner-only 0600.
- **Features relevant to Havrin (verified):**
  - Token/cost/context-window/agent-time analytics by agent, model, project, repository (incl. worktrees), outcome, day.
  - File hotspots; tool usage and **MCP server usage** stats (`decant tool stats`, `decant mcp stats`).
  - **Insights = recommendations drawn from session patterns**, each with a suggested change you can mark implemented. The methodology doc defines exactly nine threshold signals over the last 30 days:
    | Signal | Fires when |
    |---|---|
    | Tool error rate | ≥20 calls, ≥5 errors, ≥12% error rate |
    | Heavy MCP server | a top-3 server has ≥50 calls |
    | Busy tool | a top-2 non-MCP tool has ≥200 calls |
    | Spend concentration | one model ≥40% of estimated cost |
    | Abandoned rate | >25% of ≥10 labeled top-level sessions abandoned |
    | Ingest health | ≥10% of ≥15 sessions carry parse diagnostics |
    | Re-read file | ≥8 sessions read a file, ≤2 edited/wrote/deleted it |
    | Reworked file | ≥6 sessions edited/wrote a file |
    | Searches per session | ≥20 sessions and ≥5 searches/session in a repo |
  - Signals auto-mark "implemented" when they stop meeting thresholds (source `activity`) and reopen if they qualify again.
  - **`decant distill`**: workflow scripts, session replays, and agent instructions (SKILL.md, AGENTS.md sections, slash commands) distilled from command history, with per-command success rates.
  - **`decant doctor`**: redacted environment report for bug reports (name collision with `havrin doctor`, different purpose).
  - HTML reports; exports to Markdown/JSON/Letta trajectory-v1/ATIF; `--json` on read commands; stable error codes/exit codes.
  - Very detailed, honest accounting methodology (OpenCode 1.x/2.x token conventions, compaction, forks, migrations; explicit warnings that outcome labels are transcript-shape heuristics, **not** evidence a change shipped or tests passed).
- **Overlap with Havrin:** observe (both target agents + more), coarse diagnose (tool failures, redundant reads, rework, MCP heaviness), evidence-backed recommendations with implemented-tracking, and a distill step adjacent to "discover". Same license, same TS ecosystem, overlapping command vocabulary.
- **Gap vs Havrin (verified absence in fetched docs):** diagnostics are **usage thresholds, not workflow-quality checks** — no "missing test verification", no "conflicting instructions" detection, no retry-pattern or redundant-skill detection beyond call counts; no controlled experiments; no verification that a recommended change actually improved outcomes (only threshold re-opening); no software discovery. Its outcome labels explicitly disclaim success/test semantics.

> Name disambiguation: search also surfaced `codingstark-dev/decant`, an unrelated AI-native website-mirroring tool in Rust with a SKILL.md (search preview only; repo not fetched). Not a competitor.

### 2.2 self-optimize (acertainKnight/self-optimize) — closest to Havrin's full loop

- **Source fetched:** https://github.com/acertainKnight/self-optimize (repo page + full README)
- **What it is (verified):** "A measured self-optimization loop for Claude Code: mines usage, recommends with evidence, applies safely, verifies on real sessions." A Claude Code plugin (`/self-optimize`), Python scripts + subagents. 106 commits, 0 stars as displayed.
- **License:** **no LICENSE file appears in the repository root listing** (only README.md, SECURITY.md, .gitignore + dirs). License status: **Unknown** — treat as all-rights-reserved by default; do not reuse code.
- **Pipeline (verified from README):**
  1. **Collection — deterministic, no LLM.** `collect.py` / `inventory.py` parse transcripts + config surface; `--stats-only` costs zero tokens. Secret redaction on every excerpt. Emits a six-file evidence pack; new harness = new collector.
  2. **Friction signals per session:** corrections, **duplicate reads**, **repeated tool calls**, permission stalls, reverts after agent edits, re-asks, sessions ending on a correction.
  3. **Analysts — four read-only LLM subagents** (transcript miner, config auditor, artifact evolver, correction labeler). Every finding must carry `evidence_refs` that mechanically resolve against the pack or the finding is dropped (one repair retry).
  4. **Guidance-debt audit** over CLAUDE.md/auto-memory: "rules earn their token cost or get proposed for trimming." Hook proposals: a prose rule shown being violated becomes a proposed enforced check (tier B, human-installed, from a fixed rule table — never generated commands).
  5. **Human gate:** per-item apply/reject/amend via report + HTML dashboard. Tier A = allowlisted machine writes with snapshot → write → smoke check → auto-restore/rollback; tier B = diffs/free-form instructions; hooks & permissions **never** machine-applied.
  6. **Verification on next real sessions:** each applied change predicts a metric + direction; `verify.py` uses binomial tests (sparse counts) / Welch's t-test (continuous), refuses verdicts below session floors, judges shared-metric changes as cohorts, prints program ROI (verified token savings vs analyst tokens spent).
  7. **Eval gym (shipped):** per-artifact corpus of graded cases mined from real usage (failure = artifact fired + user corrected; working = fired + no correction). A configurable judge CLI (no default; any LLM CLI) scores candidates on **both** "complaints prevented" and "working behavior preserved"; below 3 cases/side → `unscorable`. Variant archive with lineage + **Pareto front** seeding one reflective proposal per artifact; human still picks.
  8. **Multi-harness:** runner stays in Claude Code; **evidence-only adapters for Codex CLI, opencode (reads `opencode.db`), and claude.ai export**; one merged run with per-harness sample caps. Apply templates for non-Claude surfaces are roadmap (#33).
  9. Papercut self-report channel; security gates on generated content; slow self-application to analyst files (tier B always).
- **Roadmap (not shipped):** skill curator that dedupes/retires skills (#29, deterministic similarity + activation counts), validated failure taxonomy via MAST (#30), silent-failure detector (#31), failure localization (#32), turn-level Codex parser (#19).
- **Research lineage it cites (from its README; papers not independently fetched):** SkillOpt, ACE, Trace2Skill, GEPA, Hermes Agent, prime-agent, MAST, TRACE, Voyager/TroVE, MetaSkill-Evolve/STOP. The README is explicit that "the ideas here are not new."
- **Overlap with Havrin:** the strongest of any project found — deterministic collection, duplicate-read/repeated-tool friction signals, evidence-cited recommendations, human-gated application, and real statistical verification already ship. OpenCode + Codex data is already ingested (evidence-only).
- **Gap vs Havrin:**
  - Recommendations **require LLM analysts** (Havrin: zero LLM end-to-end).
  - Runner/apply machinery is Claude-Code-only today; OpenCode/Codex are evidence-only.
  - No software discovery.
  - Verification is **observational pre/post comparison** with floors and cohort caveats — not controlled A/B experimentation; the gym scores offline candidates with an LLM judge, not live workflow experiments.
  - No visible license (adoption/reuse risk for the ecosystem, and for Havrin borrowing ideas/code).

### 2.3 AgentArena — ambiguous name; four distinct projects found

No single canonical "AgentArena" for coding-agent workflow benchmarking was found. Verified candidates:

1. **aidriventesting/AgentArena** — https://raw.githubusercontent.com/aidriventesting/AgentArena/main/README.md (fetched). **MIT.** "AI Agent Evaluation Benchmarks for UI Grounding, Web Navigation, and Task Automation." Ships UIArena v1: 15 static, deterministic environments (3 page types × 5 orthogonal variants of visual/DOM/accessibility), Next.js static export, metadata.json tasks. **Not** coding-agent session analysis; overlap with Havrin ≈ none beyond "reproducible evaluation".
2. **williampeytz.com/agentarena** — https://www.williampeytz.com/agentarena (fetched). Beta website: "Replay every engineering decision made by an AI coding agent." Shows matches between agents on repo tasks, scores, hidden-test pass counts, duration/cost, patch comparison, leaderboard, event stream. **Its "GitHub ↗" link points to https://github.com (site root); no public repository was located.** All metrics on the site are site-reported and unverified; the live counters look demo-like. Conceptually adjacent (execution observability + comparison of agent configurations) but a hosted benchmark product, not a local diagnostics CLI. Repo/license: **Unknown**.
3. **NethermindEth/agentarena-evmbench** — https://raw.githubusercontent.com/NethermindEth/agentarena-evmbench/main/README.md (fetched). **Apache-2.0.** Benchmark + agent harness for finding/exploiting smart-contract bugs; companion interface to OpenAI's `frontier-evals` detect evaluation; uploads contract zips, runs Codex in detect-only mode inside Docker/K8s workers, validates JSON vulnerability reports. Different domain; no overlap with Havrin's diagnostics.
4. **JustInternetAI/AgentArena** — https://raw.githubusercontent.com/JustInternetAI/AgentArena/main/README.md (fetched). **Apache-2.0.** Godot 4 C++ module + Python runtime/eval harness for LLM-driven NPCs (tools, memory, RAG, deterministic sandbox scenes, seedable scorecards). Game-agent research; no overlap.

Search results also surfaced an arXiv paper "Agent-Arena: A General Framework for Evaluating Control Algorithms" (arxiv.org/abs/2504.06468) — control-algorithm evaluation, not fetched, out of scope. **Conclusion: "AgentArena" as a coding-agent benchmarking competitor is not a single identifiable project; the closest coding-agent instance (williampeytz) has no findable public repo.**

### 2.4 Tool Scout (LpcPaul/tool-scout-skill)

- **Source fetched:** https://github.com/LpcPaul/tool-scout-skill (repo page + full README)
- **What it is (verified):** MIT, Python 3.10+. A lightweight **tool-discovery Agent Skill** for Codex, Claude Code, and other skill-capable agents. Answers "is there already a tool/MCP server/skill/repo/npm package/extension/SaaS that solves this?" Pipeline: problem description → query families → parallel searchers → normalized candidates → **V0/V1 evidence gates** (V0: source exists/not dead; V1: README/metadata evidence it can do the task) → explainable ranking (goal match 45%, evidence 20%, project quality 20%, landing friction 10%, multi-source corroboration 5%).
- **Searchers:** GitHub, npm, official MCP Registry, Glama, OpenAgentSkill, agentskill.sh, VS Code Marketplace, Open VSX, Brave (optional key), Jina fallback; optional Smithery/PulseMCP. Includes a **native-feature audit** (check the target product's own capabilities before recommending external tools). JSON output designed for agent consumption. Explicitly does **not** install packages, run MCP servers, or smoke-test APIs.
- **Traction:** 1 star, 3 commits (very early).
- **Overlap with Havrin:** directly occupies the "software discovery" leg of Havrin's long-term loop, with an evidence-gated, explainable design Havrin should study (and could interoperate with).
- **Gap vs Havrin:** discovery is **query-driven, not session-driven** — nothing mines agent history to detect that a recurring friction has an existing tool solution; no diagnostics, no verification of whether adopting a tool helped.

---

## 3. Adjacent categories

### 3.1 Agent benchmarking frameworks (capability, not workflow)

- **SWE-bench** — https://github.com/SWE-bench/SWE-bench (fetched). **MIT**, 6.2k stars. Benchmark: given codebase + real GitHub issue, generate a resolving patch. Docker-based reproducible evaluation harness; v5 CLI (`swebench eval/infer/images/report/submit`); datasets: full, Lite, Verified (500 human-confirmed tasks), Multimodal (v2 open-sourced Sep 2026 per README news), Multilingual; cloud options (sb-cli, Modal). Related: SWE-agent, SWE-smith, CodeClash. **Relevance to Havrin:** defines "did the task succeed" verification for patches — the outcome signal Havrin's "missing test verification" diagnostic points at — but it evaluates models/agents on fixed tasks, not a developer's real workflow, and knows nothing about retries, redundant reads, or config quality.
- **Terminal-Bench** — https://github.com/laude-institute/terminal-bench (fetched; redirects to https://github.com/harbor-framework/terminal-bench-1). **Apache-2.0**, 2.6k stars. ~100 beta tasks (core v0.1.1), each with English instruction, test script, oracle solution; `tb` CLI harness connecting agents to sandboxed terminals; leaderboard; ICLR 2026 citation in README. README announces **harbor** (github.com/laude-institute/harbor, not fetched) as the new framework for Terminal-Bench 2.0; Decant's ATIF import references the Harbor framework docs. **Relevance:** same category — end-to-end capability benchmarking in terminals, not personal workflow diagnostics or optimization.

### 3.2 Usage / cost / token tools (the "observe" layer — crowded)

- **ccusage** — https://github.com/ccusage/ccusage (fetched; npm page content also seen via search). **MIT**, 19.5k stars, 929 forks. Local CLI reading local data from ~20 sources incl. **Claude Code, Codex, OpenCode**, Amp, Droid, Cline, Gemini CLI, Copilot CLI, Goose, Qwen, Kimi, etc. Daily/weekly/monthly/session reports, Claude 5-hour blocks, statusline hook, per-model breakdown, cache-token split, `--json`, `--offline` pricing, custom pricing overrides, project/instance grouping, timezone support. **No diagnostics or recommendations** — pure usage/cost accounting. This is the de facto standard Havrin should not try to out-dashboard.
- **OpenCode built-in `opencode stats`** — verified via https://github.com/anomalyco/opencode/issues/5555 (fetched): official-repo feature request states "`opencode stats` shows aggregate statistics across all sessions"; asks for per-session `/stats` + exit summary; **closed as completed 2026-03-25** by a maintainer. Decant's methodology doc (fetched) also compares its accounting against `opencode stats` behavior (compaction/fork counting differences). Note: the CLI docs page fetched (https://opencode.ai/docs/cli/) does **not** document `stats`; exact current flag surface: Unknown beyond `--models` referenced by oc-stats' README. **Aggregate usage only.**
- **Sniffly** — https://raw.githubusercontent.com/chiphuyen/sniffly/main/README.md (fetched). **MIT**, Python 3.10+, by Chip Huyen. Local Claude Code analytics dashboard (`sniffly init`, localhost:8081): usage patterns, **error-type breakdown** ("see where Claude Code makes mistakes"), message/instruction history walkthrough. No telemetry; **opt-in shareable dashboards** (private/public gallery, optionally including command text — an upload path Havrin's privacy pitch can contrast with). Claude-only; no recommendation/verify loop.
- **Claude-Code-Usage-Monitor** — https://raw.githubusercontent.com/Maciek-roboblog/Claude-Code-Usage-Monitor/main/README.md (fetched). **MIT**, Python, PyPI `claude-monitor`. Real-time burn-rate/limit monitoring for Claude's 5-hour windows; v4 "usage-ops" layer: official statusline `rate_limits` as trust source, provenance labels (official/local_estimate/experimental/unknown), machine-readable snapshots (`--once --output json`, `--write-state`), opt-in local usage warehouse surviving Claude's 30-day cleanup, forecasting. README explicitly scopes OpenCode/other providers to future separate adapters. **Usage ops, not workflow diagnostics.**
- **claude-code-usage-analyzer** — https://raw.githubusercontent.com/aarora79/claude-code-usage-analyzer/main/README.md (fetched). **MIT**, Python (stdlib core). Wraps `npx ccusage` + LiteLLM dynamic pricing; two-phase analyze→report pipeline; per-day/per-model/per-request statistics, cache efficiency, model-combination analysis; self-contained HTML "tokenomics dashboard" with mean ±2σ control limits and anomaly flagging; JSON/Markdown/PNG outputs; ships a `/tokenomics-dashboard` skill. **Note on the name "claude-code-usage": no package with that exact name was verified in this research; this analyzer is the closest verified match.** Cost governance, not workflow diagnostics.
- **opencode-tokenscope** — https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/README.md (fetched). **MIT**. OpenCode plugin for V1 and V2 (`/tokenscope`, `/tokenscope-report`); V2 panel makes **no model request**. Per-session: recorded provider telemetry vs local tokenizer estimates vs explanatory estimates (explicitly separated), context-window split by source (system prompt, tool definitions, user, tool output), cache hit rate/savings, recursive subagent totals, skill/tool catalog sizes, warnings for uncertainty. Verified against OpenCode v2.2.6 / v1.17.18. **Closest OpenCode-native tool to "what is wasting context", but per-session accounting only** — no cross-session friction diagnostics, recommendations, or experiments. May download HF tokenizer files at runtime (stated).
- **opencode-stats (oc-stats)** — https://lib.rs/crates/opencode-stats (fetched; repo github.com/cateds/opencode-stats linked, not fetched). **MIT**, Rust/ratatui TUI, 12 releases (latest 1.4.2, Jun 2026). Reads OpenCode SQLite DB or JSON exports; tokens/cost/sessions/models/providers, 365-day heatmap, share-card export, models.dev pricing cache; states its calculations align with `opencode stats` / `--models`. Usage dashboard only.
- **ocmonitor (Shlomob/ocmonitor-share)** — *search preview only, not fetched.* GitHub search result describes a Python OpenCode monitor CLI: live dashboard, session analyzer, workflow grouping, tool-usage models, CSV/JSON export, models.dev pricing. Treat details as unverified.

### 3.3 Session-analysis / diagnostic tools (the "diagnose" layer — emerging)

- **mentor (smixs/mentor)** — https://raw.githubusercontent.com/smixs/mentor/main/README.md (fetched). **MIT**, 86 stars (per topic listing). Agent skill for Claude Code + Codex: `collect.py` deterministically parses `~/.claude` transcripts and `~/.codex` rollouts into a stats bundle ("numbers are counted, not guessed"); **the agent (LLM) then writes** an 8-section self-contained HTML report: themes, tool ratios, wins, **friction points each with evidence and a concrete fix**, under-used features, **suggested CLAUDE.md additions**, new workflows, horizon. Model-inferred judgments are flagged as hypotheses. Install via `npx skills add smixs/mentor`. **Overlap:** observe→diagnose→recommend in report form, including config-change suggestions. **Gaps:** LLM-dependent analysis, no OpenCode, no apply/verify/experiment machinery, weekly-manual cadence.
- **session-intelligence (tetriz-ai)** — https://raw.githubusercontent.com/tetriz-ai/session-intelligence/main/README.md (fetched). **MIT**, Go 1.25+, v0.1.0, by Workloom Solutions. Engine: **deterministic spine** (parse, telemetry, round-trip pairs, phases) + **three LLM passes** (read/evidence/discard) via a BYO `Provider` (bundled reference service calls Gemini; Docker + Postgres for batch). Output: session verdict (goal, achievement, smoothness, friction cause, clarity/context scores), per-turn judgments, per-phase went_well/went_wrong, **security flags** (api-key-leak, db-credential-leak, pii-injection). Transcript collection relies on companion **Agent Desk / local-session-extractor (macOS)** covering Codex, Claude Code, Kiro, Cursor, Copilot, Antigravity — **no OpenCode**. README states explicitly: no dashboard, **no automatic habit tracking across sessions**; round-trip detector is an uncalibrated placeholder, off by default; masking is a backstop, not redaction. **Overlap:** per-session friction/rework/security diagnosis. **Gaps:** LLM-required, single-session unit, no OpenCode, no longitudinal verify/experiment.
- **cLens (silouone/clens)** — https://raw.githubusercontent.com/silouone/clens/main/README.md (fetched). **MIT**, TypeScript/Bun monorepo, npm `@silou/clens`. **Claude Code only.** Hook-based capture (~2ms/event) to local JSONL + transcript enrichment; `distill` runs **20+ pure deterministic extractors**: backtracks, structural decision points, edit chains (thinking→code), **plan drift (spec vs actual)**, file map, reasoning, multi-agent comms/trees, active duration, etc. CLI (`list/distill/what/report/agents`, `--json`), TUI, local token-gated web dashboard; agentic plugin (5 skills, 3 commands, session-analyst agent). README is explicit: cost figures mostly estimated; "decisions" are structural, not semantic; **"cLens measures; it doesn't editorialize."** Full tool payloads stored locally (credential caveat stated). **Overlap:** the closest deterministic workflow-diagnostic engine found (backtracks ≈ retries/rework; plan drift ≈ instruction adherence). **Gaps:** Claude-only; no recommendation engine, no config/instruction-conflict audit, no MCP/skill redundancy analysis, no verify/experiment loop, no OpenCode/Codex.

### 3.4 Self-improving-agent research context (from self-optimize's fetched README)

self-optimize's "Landscape and position" section (fetched) documents that the loop's components come from published work: **SkillOpt** (bounded skill edits validated by rollout feedback), **ACE** (incremental context edits; monolithic rewrites cause context collapse), **Trace2Skill** (keep only skills that demonstrably change outcomes), **GEPA** (Pareto-front prompt evolution), **MAST** (14-mode failure taxonomy), **TRACE** (compile user corrections into runtime enforcement), **Voyager/TroVE** (skill-library accretion vs trimming), **STOP/MetaSkill-Evolve** (two-timescale self-improvement, with documented sandbox-disable failure), plus Hermes Agent and prime-agent harnesses. These papers/repos were **not independently fetched** in this research; they are cited here as reported by self-optimize's README. Implication for Havrin: the observe→diagnose→optimize loop is an active, published research area — novelty claims must be scoped narrowly (see §4).

### 3.5 Other benchmarking/observability names seen (not deep-verified)

Search previews only: Windows Agent Arena (microsoft.github.io/WindowsAgentArena — OS-agent benchmark), AgentBench (github.com/THUDM/AgentBench — LLM-as-agent benchmark), toolscout.ai (an AI-tool directory site, unrelated to LpcPaul's Tool Scout skill), and an arXiv "Optimizing Agentic Workflows using Meta-tools" (AWO — analyzes tool-call trajectories for recurring routines). None fetched; listed to avoid name confusion.

### 3.6 GitHub `session-analysis` topic — ecosystem listing (listing-level only)

Fetched: https://github.com/topics/session-analysis (58 repos). Descriptions below are **topic-listing text, not deep-verified READMEs**:

| Repo | Listing description | Note |
|---|---|---|
| yessGlory17/argus (119★) | Claude Code monitoring/observability VSCode extension | TS |
| smixs/mentor (86★) | session-insights skill (deep-verified above) | |
| awesome-skills/insights (7★) | "Portable /insights for Claude Code, Codex, Gemini CLI, **OpenCode** — analyze local session history, generate HTML usage report" | closest multi-agent insights skill listing |
| silouone/clens (6★) | deep-verified above | |
| utensils/claudex (4★) | query/search/analyze Claude Code sessions (Rust, SQLite FTS5) | |
| onlycastle/BetterPrompt (4★) | collaboration patterns, thinking quality, growth areas; plugin-first, local-first | |
| bbsteel/session-insight (3★) | local-first terminal-native replay + analytics for AI coding sessions (Go) | |
| mpazik/session-scan (2★) | read/filter/export Claude Code, Codex, Pi sessions as NDJSON/Markdown | |
| OnourImpram/routeledger (2★) | which model actually served each turn; routing divergence audit; read-only, offline | |
| DY-2026/ContextOS-for-OpenCode (2★) | "Make OpenCode get better with use, not worse. Local-first insights, routing, and session protection" | OpenCode-specific self-improvement positioning |
| GreenLv/dsh-session-insights (2★) | "Local-first, **evidence-backed workflow retrospectives** for DeepSeek Harness" | same pitch vocabulary, different harness |

Takeaway: "local-first, evidence-backed session insights" is becoming a crowded pitch across harnesses; several tiny repos (1–3 commits) suggest low maturity but real interest.

---

## 4. Havrin differentiation and honest weaknesses

### 4.1 What existing tools already cover (do not claim these as novel)

1. **Observe (ingest OpenCode/Codex logs; tokens/cost):** saturated. ccusage (MIT, 19.5k★) covers both plus ~18 more sources; Decant covers both plus 6 more with deeper normalization; OpenCode ships `opencode stats`; oc-stats, TokenScope, ocmonitor cover OpenCode natively; mentor and self-optimize already parse Codex. Havrin's ingestion layer is table stakes, not a differentiator.
2. **Coarse friction diagnostics:** Decant already ships tool-error-rate, re-read-file, reworked-file, search-heavy, heavy-MCP-server signals with thresholds and implemented-tracking. self-optimize ships duplicate-read, repeated-tool-call, correction, permission-stall, revert signals deterministically. cLens ships backtrack/plan-drift/edit-chain extractors (Claude-only). Sniffly ships error-type breakdowns (Claude-only). "We detect repeated failures and redundant reads" is **already occupied** in at least three tools.
3. **Evidence-backed recommendations:** Decant (signal → suggested change → mark implemented), mentor (friction → concrete fix + CLAUDE.md lines, LLM-written), self-optimize (citation-checked findings, mechanically dropped if evidence doesn't resolve). The "evidence-backed" adjective alone is not differentiation; self-optimize's mechanical citation resolution is a stronger evidence contract than most.
4. **The full loop concept:** self-optimize ships collect→analyze→human-gate→apply→verify **today**, plus an eval gym, variant archive, and Pareto selection, and its README explicitly maps every component to prior published work. Havrin cannot claim "first observe→diagnose→…→optimize loop for coding agents."
5. **Software discovery (standalone):** Tool Scout already does cross-source, evidence-gated, explainable tool discovery as an agent skill (early, 1★/3 commits, but the design is public and MIT).
6. **Outcome verification research:** SWE-bench/Terminal-Bench define task-success verification; self-optimize implements pre/post statistical verification with floors, cohort handling, and ROI accounting. "Verify improvements with statistics" is occupied in spirit.

### 4.2 Where Havrin's pitch is genuinely unoccupied (based on everything fetched)

1. **Zero-LLM, end-to-end deterministic diagnosis + recommendations across OpenCode AND Codex.** Every close competitor either (a) requires LLM analysts/judges for the recommendation step (self-optimize, mentor, session-intelligence), or (b) is deterministic but limited to coarse usage thresholds (Decant) or a single harness (cLens). No fetched tool offers deterministic, workflow-quality diagnostics with evidence-backed recommendations for OpenCode + Codex with no model in the loop. This is Havrin's clearest wedge — and it's a real property (reproducibility, zero marginal cost, no transcript-to-LLM exposure), not just a slogan.
2. **Specific diagnostic classes not seen in any fetched tool:**
   - **Missing test verification** (agent edited code without running tests / claimed success without evidence). Decant explicitly disclaims outcome semantics; cLens plan-drift is adjacent but spec-vs-files, not test-verification; nobody fetched checks "was a test run after edits."
   - **Conflicting instructions** across AGENTS.md/CLAUDE.md/skills/config. self-optimize's guidance-debt audit is the nearest neighbor (rules that cost tokens while being violated) but it is LLM-driven and about debt, not contradiction detection. No fetched tool detects instruction conflicts deterministically.
   - **Redundant skills/MCP servers** as a dedup/retirement recommendation: Decant shows MCP usage counts and a "heavy server" signal; self-optimize's skill curator (#29) is **roadmap, not shipped**. Deterministic redundancy detection across both harnesses is open.
3. **Session-driven software discovery:** Tool Scout is query-driven; Decant distills instructions from history but doesn't discover external software. No fetched tool connects *mined recurring friction* → *search for an existing tool that removes it* → *evidence-gated recommendation*. That connection is unoccupied.
4. **Controlled A/B experimentation on real developer workflows:** nothing fetched implements controlled experiments. self-optimize's verification is observational pre/post (it documents the confounds itself: cohorts, floors, noise), and its gym scores offline candidates with an LLM judge. A mechanism to randomize/alternate configurations across comparable real sessions and attribute effects is genuinely unoccupied — and is the hardest, most defensible part of Havrin's roadmap.

### 4.3 Honest weaknesses and risks

1. **The loop is not new; a working implementation exists.** self-optimize (0★ but 106 commits, thorough security model, statistical verification, gym + Pareto) already occupies most of the loop for Claude Code with OpenCode/Codex evidence adapters. Havrin's differentiation must be the zero-LLM determinism, the specific diagnostic classes, dual-harness parity, and controlled experiments — not the loop diagram. If self-optimize adds a license and deterministic analysts, the overlap grows.
2. **Decant is a well-resourced adjacent incumbent.** Company-backed (Dosu), 449 commits, 8 sources, OpenSSF badges, overlapping command names (`doctor`, insights, distill), same Apache-2.0 license. It can add workflow-quality signals incrementally on top of its normalized archive; its archive + full-text search + API are things Havrin would have to rebuild to match. Its README also sets a high bar for honest methodology documentation (OpenCode version quirks, estimation caveats) that Havrin should match.
3. **Zero-LLM is both the wedge and a ceiling.** Semantic checks — "these two instructions conflict", "this skill is redundant with that one", "the agent claimed success without testing" — may be only partially detectable with deterministic rules. Competitors using LLM analysts will catch fuzzy cases Havrin misses. Havrin should scope deterministic diagnostics to structurally detectable patterns and say so plainly (cLens' "measures, doesn't editorialize" and Decant's outcome disclaimers are good precedents).
4. **Controlled A/B on developer workflows is statistically hard.** Real sessions vary by task, repo, model, and mood; self-optimize's own docs show how quickly pre/post comparisons degrade into cohorts and noise floors. Randomization units (session? task? day?), contamination (config changes leak across sessions), and small-n per developer are unsolved in anything fetched. Havrin's experiment leg is unoccupied partly because it is genuinely difficult; the report/verify UX must surface uncertainty honestly or it becomes the overclaim the project's evidence-backed pitch warns against.
5. **Privacy pitch needs precision.** "Local-first" is now common (Decant, cLens, Sniffly, ccusage, TokenScope, session-intelligence all claim it). Decant openly documents that it keeps an unencrypted transcript copy; Sniffly has opt-in upload sharing; TokenScope may fetch tokenizer files. Havrin can differentiate concretely only if it specifies what it stores/retains (e.g., no transcript copy, redacted evidence packs, zero network) — vague "privacy-preserving" wording is no longer distinctive.
6. **Market maturity is uneven.** The diagnose layer is mostly tiny projects (0–86★, several with 1–3 commits), while the observe layer is dominated by ccusage. Demand for *diagnostics that change behavior* (vs dashboards) is not yet proven at scale; Decant's Insights and self-optimize's existence are the strongest signals that it's emerging. Havrin should avoid pitching cost dashboards (lost cause vs ccusage) and lead with the diagnostic classes nobody else ships.
7. **License hygiene:** self-optimize has no visible license — its ideas are documented publicly but its code cannot be assumed reusable. Tool Scout (MIT), Decant (Apache-2.0), ccusage (MIT), cLens (MIT), mentor (MIT), session-intelligence (MIT) are all permissively licensed and could be interoperated with or studied directly.

### 4.4 One-line positioning supported by the evidence

> The observe layer is saturated (ccusage, Decant, opencode stats); coarse friction signals and LLM-driven recommendation loops already exist (Decant Insights, mentor, self-optimize, cLens). What no fetched project ships is: **deterministic, zero-LLM workflow-quality diagnostics (missing test verification, conflicting instructions, redundant skills/MCP) across OpenCode and Codex, feeding session-driven tool discovery and controlled A/B verification of improvements.** That combination — not the loop itself — is Havrin's defensible ground, and the experiment leg is the hardest part to execute honestly.

---

## 5. Source index (all fetched 2026-11-17)

| # | URL | Used for |
|---|---|---|
| 1 | https://github.com/dosu-ai/decant | Decant README, license, features, sources |
| 2 | https://raw.githubusercontent.com/dosu-ai/decant/main/docs/analytics-methodology.md | Decant Insights signal definitions, accounting caveats, `opencode stats` comparison |
| 3 | https://github.com/acertainKnight/self-optimize | self-optimize README (pipeline, gym, verification, adapters, license absence, research lineage) |
| 4 | https://github.com/LpcPaul/tool-scout-skill | Tool Scout README |
| 5 | https://raw.githubusercontent.com/aidriventesting/AgentArena/main/README.md | AgentArena (UI benchmark) |
| 6 | https://www.williampeytz.com/agentarena | AgentArena (coding-agent benchmark site; no repo found) |
| 7 | https://raw.githubusercontent.com/NethermindEth/agentarena-evmbench/main/README.md | agentarena-evmbench |
| 8 | https://raw.githubusercontent.com/JustInternetAI/AgentArena/main/README.md | AgentArena (Godot) |
| 9 | https://github.com/SWE-bench/SWE-bench | SWE-bench README |
| 10 | https://github.com/laude-institute/terminal-bench (→ harbor-framework/terminal-bench-1) | Terminal-Bench README |
| 11 | https://github.com/ccusage/ccusage | ccusage README, license, sources |
| 12 | https://github.com/anomalyco/opencode/issues/5555 | existence/behavior of built-in `opencode stats` |
| 13 | https://opencode.ai/docs/cli/ | OpenCode CLI docs (stats not documented there) |
| 14 | https://raw.githubusercontent.com/chiphuyen/sniffly/main/README.md | Sniffly |
| 15 | https://raw.githubusercontent.com/Maciek-roboblog/Claude-Code-Usage-Monitor/main/README.md | Claude-Code-Usage-Monitor |
| 16 | https://raw.githubusercontent.com/aarora79/claude-code-usage-analyzer/main/README.md | claude-code-usage-analyzer |
| 17 | https://raw.githubusercontent.com/ramtinJ95/opencode-tokenscope/main/README.md | TokenScope |
| 18 | https://lib.rs/crates/opencode-stats | oc-stats |
| 19 | https://raw.githubusercontent.com/smixs/mentor/main/README.md | mentor |
| 20 | https://raw.githubusercontent.com/tetriz-ai/session-intelligence/main/README.md | session-intelligence |
| 21 | https://raw.githubusercontent.com/silouone/clens/main/README.md | cLens |
| 22 | https://github.com/topics/session-analysis | ecosystem listing (§3.6, listing-level only) |

**Explicitly not found / not verified:**
- No package named exactly "claude-code-usage" was verified; closest verified match: aarora79/claude-code-usage-analyzer (#16).
- No public repository for williampeytz AgentArena was located (site's GitHub link is generic).
- self-optimize license: no LICENSE file visible → Unknown.
- ocmonitor details: search preview only. codingstark-dev/decant: search preview only. §3.5–3.6 items: listing/preview level only.
- Research papers cited inside self-optimize's README (SkillOpt, ACE, GEPA, MAST, TRACE, etc.) were not independently fetched.
