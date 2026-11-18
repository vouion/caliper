# Caliper by Havrin

[![CI](https://github.com/vouion/caliper/actions/workflows/ci.yml/badge.svg)](https://github.com/vouion/caliper/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node >= 22.13](https://img.shields.io/badge/node-%3E%3D22.13-339933.svg)](https://nodejs.org)

**The open-source optimization engine for AI-powered development.**

Caliper analyzes how you actually work with AI coding agents, finds evidence-backed inefficiencies in your sessions and configuration, and tells you what to change — without sending your data anywhere, and without needing an LLM.

> Caliper is an open-source project by **Havrin**. Local-first · evidence-driven · provider-agnostic · Apache-2.0.

```
$ caliper audit

caliper v0.3.0 · development environment audit
────────────────────────────────────────────────────────────────────────
ENVIRONMENT
  ● opencode  v2.3.1 · sqlite-v2 · 258 sessions
  ● codex     v0.169.1 · jsonl-rollout · 25 sessions
  ● claude    v2.1.327 · jsonl-projects · 5422 sessions

FINDINGS (23)  high 1 · medium 12 · low 10

  [HIGH] Repeated identical tool failures in Caliper Evals MVP bootstrap
         rule repeated-tool-failures · confidence high · scope sessions
         · Tool "subagent" failed 8× with identical input
         impact: Identical failing calls burn tokens and time without new
                 information...
         suggest: Inspect the first failure and fix the precondition...

RECOMMENDATIONS (8)
  1. The agent repeatedly issued byte-identical tool calls that failed.
     why: ...  change: ...  evidence: ...  tested: no — observational only
     apply: 1) ... 2) ...  rollback: ...
```

## Why Caliper

Usage dashboards tell you *what* you spent. Caliper tells you *what was wasted and why*:

- **Stuck loops** — the same tool call with identical input failing over and over.
- **Redundant context spend** — files re-read repeatedly without changing.
- **Unverified edits** — sessions that modify code but never run a test.
- **Context pressure** — sessions that compact their context repeatedly.
- **Configuration waste** — MCP servers you never call, duplicate skills, plaintext secrets in config files.

Every finding carries supporting evidence, a confidence level, consequences, and a concrete recommendation with apply/rollback steps. Nothing is transmitted. No account. No LLM required.

**Honest positioning:** session *observation* is a crowded space (ccusage, Decant, Sniffly, and others do it well). Caliper's focus is the next step: deterministic **workflow-quality diagnostics** across agents, and — on the roadmap — controlled experiments that verify whether a recommended change actually helped. See [docs/research/competitive-landscape.md](docs/research/competitive-landscape.md) for a sourced comparison, including where competitors already beat us.

## Install

Requires **Node.js ≥ 22.13** (uses the built-in SQLite module; no native dependencies).

```sh
npm install -g caliper        # once published
# or from source:
git clone https://github.com/vouion/caliper && cd caliper
npm install && npm run build
npm link                     # puts `caliper` on your PATH
```

Runtime dependencies: exactly one (`smol-toml`, BSD-3-Clause, for Codex config parsing). Everything else is Node built-ins.

## Quickstart

```sh
caliper doctor                      # check agent installs + storage health
caliper audit                       # analyze the last 30 days, all agents
caliper audit --since 7d --agent claude
caliper audit --json > audit.json   # machine-readable output
caliper report --format json        # re-render the last saved audit
caliper demo                        # synthetic dataset — no personal data needed
```

Supported agents are discovered automatically from their standard install locations — no configuration needed. No session data yet? `caliper demo` runs the full pipeline on a clearly-labeled synthetic dataset that exercises every diagnostic rule.

## Supported agents

| Agent | Storage analyzed | Verified against | Notes |
|---|---|---|---|
| **OpenCode** | `~/.local/share/opencode/opencode.db` | v2.3.1 | SQLite, read-only; credential tables never queried |
| **Codex CLI** | `~/.codex/sessions/**/rollout-*.jsonl` | 0.169.1 | Tool failures inferred from output (tagged heuristic) |
| **Claude Code** | `~/.claude/projects/**/*.jsonl` | 2.1.308–2.1.327 | Split-record usage dedup; reported `is_error` failures; sidechain/subagent stats; compaction boundaries; cost-state totals |

Session schemas are version-sensitive. Caliper probes the layout before reading, degrades gracefully on unknown layouts, and reports partial parses instead of guessing. Legacy OpenCode JSON storage (pre-2.x) is detected and reported as unsupported. More agents are planned via the same adapter interface.

### Claude Code specifics

- **Correct token accounting.** Claude Code splits one API response into multiple transcript records, each repeating the full usage block. Caliper merges records by message id and counts usage exactly once (verified against 5,434 real multi-record groups; parsed totals cross-checked against agent-reported `cost-state`).
- **Reported failures, not guesses.** Tool errors come from `tool_result.is_error`; interrupted calls are distinguished from failures.
- **Subagent visibility.** Sidechain activity is summarized per session (turns, tool calls, errors) and in report totals.
- **Honest costs.** Dollar figures come from Claude Code's own `cost-state` and are suppressed when it flags unknown model pricing. Tokens are always shown; costs are never invented.
- **Private files stay private.** `~/.claude.json` and `.credentials.json` are never opened. Transcript text, tool inputs/outputs, thinking, attachments, and API-request blobs never enter Caliper's model (sentinel-tested).

## What v0.3 does

| Capability | Status |
|---|---|
| Detect OpenCode, Codex CLI, and Claude Code installations | ✅ |
| Read-only ingestion with incremental caching (unchanged sessions never re-parsed) | ✅ |
| Environment scan: configs, MCP servers, skills, instruction files | ✅ |
| 8 deterministic diagnostic rules with evidence + confidence, across all three agents | ✅ |
| Recommendations with lifecycle states linked to experiments | ✅ |
| **Experimentation engine**: reproducible baseline-vs-candidate comparisons | ✅ |
| Isolated trial workspaces, seeded execution order, multi-trial repetition | ✅ |
| Deterministic correctness verification (Caliper runs the tests, not the agent) | ✅ |
| Correctness-first verdicts with explicit confidence (verified/preliminary/inconclusive) | ✅ |
| Experiment registry: fingerprints, trial results, recovery, duplicate protection | ✅ |
| OpenCode execution backend (interface-verified); Codex/Claude backends (unverified, gated) | ✅ / ⚠ |
| Terminal + JSON reports; `doctor` health checks; provider attribution | ✅ |
| Synthetic demo datasets (audit + experiment), zero cost | ✅ |
| Software discovery, auto-apply, leaderboards | 🗺 roadmap — **not implemented** |

Audit recommendations are **observational, not experimentally verified** (`tested: false`). Only an experiment verdict of `verified-improvement` represents a proven improvement — and that requires ≥5 trials with a large effect. Caliper never applies changes for you.

## Experiments (v0.3)

Caliper can now **prove** whether a configuration change helps, on your own tasks:

```sh
caliper experiment demo        # free end-to-end demo (mock agents, real test verification)

caliper experiment create \
  --benchmark builtin:fix-failing-test \
  --baseline baseline.json --candidate candidate.json \
  --trials 5 --recommendation rec-repeated-tool-failures

caliper experiment run <id> --dry-run          # preview the trial plan
caliper experiment run <id> --approve-inference  # real agents: explicit approval required
caliper experiment report <id> --format json
caliper experiment list | inspect <id>
```

A benchmark defines the starting repository state, task prompt, acceptance checks, and limits. Each trial runs in a **fresh isolated workspace** (template copy or local git clone — your real repos are never touched), in seeded-random order, with hard timeouts and process-group termination. After the agent finishes, **Caliper itself runs the acceptance checks** — including a test-file hash check so an agent cannot "pass" by deleting tests. Metrics (tokens, cost, tool calls, errors) come from the existing content-free session adapters.

The verdict is correctness-first: a faster configuration that produces incorrect code never wins. Efficiency only decides when correctness is comparable and both time and tokens improve materially. Small samples yield `preliminary` or `inconclusive` — never false certainty.

**Safety gates:** real-agent runs perform paid model inference and require `--approve-inference`. Codex/Claude execution backends are implemented but not yet verified against live installs and additionally require `--allow-unverified`. OpenCode is the primary verified backend. Mock configurations run free and are used by all automated tests.

```
RESULTS (illustrative — actual output depends on your runs)
                        Baseline            Candidate
Task success            0/3                 3/3
Avg time                251ms               129ms
Output tokens           11.4k               7.2k
Test failures           3                   0

VERDICT
  Winner: Candidate · confidence: preliminary
  Correctness decides: task success 0/3 vs 3/3. A faster configuration
  that produces incorrect code is not superior.
```

### The eight rules

| Rule | Fires when | Confidence |
|---|---|---|
| `repeated-tool-failures` | Same tool + byte-identical input fails ≥2× in a session (≥5 → high severity) | high; medium if any error evidence is heuristic |
| `retry-loops` | ≥3 consecutive identical non-read calls, or ≥2 consecutive real assistant errors, or ≥3 provider retries | high |
| `redundant-file-reads` | Same file read ≥3× with ≥2 re-reads of unchanged content (reads between writes count per segment) | high |
| `missing-test-verification` | ≥3 completed file edits, ≥3 assistant turns, and zero test commands observed in-session (failed test runs still count as verification) | medium (tests may run outside the agent) |
| `context-compaction-pressure` | ≥2 compactions in one session | high |
| `unused-mcp-servers` | Configured MCP server with no matching tool calls in analyzed sessions (`server_tool` and `mcp__server__tool` conventions) | medium (naming-convention inference) |
| `skill-name-collisions` | Same skill id in multiple skill directories | high |
| `plaintext-config-secrets` | Secret-looking config keys holding literal values (values never inspected) | high |

Thresholds are deliberately conservative. Absence of findings is not a guarantee of optimality.

### Performance (real collection, measured)

Benchmarked against a real Claude Code install with **5,422 sessions (1.81 GB)** on Node 26, Linux, `--all --limit 1000`:

| Metric | Value |
|---|---|
| Sessions discovered / analyzed / skipped (limit) | 5,422 / 1,000 / 4,422 |
| Malformed / failed reads | 1 partial (154 MB transcript, size-guarded) / 0 |
| Initial ingestion | ~2.1 s |
| Subsequent cached run | ~0.6 s (1,000/1,000 cache hits) |
| Peak RSS | ~325 MB (large-transcript parsing); steady-state heap ~40–70 MB |

Transcripts >128 MB are skipped with an explicit warning rather than risking memory exhaustion.

## Privacy & security

- **Local-only.** No network calls during analysis. No telemetry. No account. Experiments run agents locally; any inference cost is the agent's own, explicitly approved by you.
- **Read-only.** Agent databases/files are opened read-only and never modified (tested byte-for-byte).
- **Content-free reports.** Reports contain metrics, timestamps, tool names, file paths, and fingerprints — never message text, tool output, or raw tool input. Tool error messages are truncated and secret-redacted (redaction before truncation). Config parse errors never echo file content. Free text is control-character-sanitized before terminal rendering.
- **Credentials are out of scope by construction.** OpenCode's credential tables are never queried; Claude's `~/.claude.json`/`.credentials.json` are never opened; config values under secret-looking keys are never retained — only the key path is flagged.
- **Experiments store no conversation content.** The registry holds benchmark definitions, configuration fingerprints, and content-free metrics. Agent stdout goes to transient capped files that are deleted after structural parsing. Trial workspaces are isolated and deleted unless you opt to keep them.
- **Disclosed exception:** session *titles* are user-derived free text (often LLM-summarized). They are truncated to 120 chars and included for usability; treat reports as sensitive if titles may be.
- **Your Caliper state** (`~/.local/share/caliper/`) is written with `0600` permissions.

Details: [docs/PRIVACY.md](docs/PRIVACY.md).

## Development

```sh
npm install
npm test          # node:test suite (183 tests), no test framework dependency
npm run typecheck
npm run build     # tsc → dist/
node --experimental-strip-types src/cli.ts audit   # run from source
```

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Roadmap: [ROADMAP.md](ROADMAP.md). Agent/contributor conventions: [AGENTS.md](AGENTS.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

<p align="center">
  <b>Caliper</b> is an open-source project by <b>Havrin</b>.<br/>
  Built with evidence, not hype. If it helps your workflow, consider <a href="https://github.com/sponsors/vouion">sponsoring</a> or <a href="https://buymeacoffee.com/vouion">buying a coffee</a>.
</p>
