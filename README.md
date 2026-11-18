# Havrin

**The open-source optimization engine for AI-powered development.**

Havrin analyzes how you actually work with AI coding agents, finds evidence-backed inefficiencies in your sessions and configuration, and tells you what to change — without sending your data anywhere, and without needing an LLM.

```
$ havrin audit

havrin v0.2.0 · development environment audit
────────────────────────────────────────────────────────────────────────
ENVIRONMENT
  ● opencode  v2.3.1 · sqlite-v2 · 258 sessions
  ● codex     v0.169.1 · jsonl-rollout · 25 sessions
  ● claude    v2.1.327 · jsonl-projects · 5422 sessions

FINDINGS (23)  high 1 · medium 12 · low 10

  [HIGH] Repeated identical tool failures in Havrin Evals MVP bootstrap
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

## Why Havrin

Usage dashboards tell you *what* you spent. Havrin tells you *what was wasted and why*:

- **Stuck loops** — the same tool call with identical input failing over and over.
- **Redundant context spend** — files re-read repeatedly without changing.
- **Unverified edits** — sessions that modify code but never run a test.
- **Context pressure** — sessions that compact their context repeatedly.
- **Configuration waste** — MCP servers you never call, duplicate skills, plaintext secrets in config files.

Every finding carries supporting evidence, a confidence level, consequences, and a concrete recommendation with apply/rollback steps. Nothing is transmitted. No account. No LLM required.

**Honest positioning:** session *observation* is a crowded space (ccusage, Decant, Sniffly, and others do it well). Havrin's focus is the next step: deterministic **workflow-quality diagnostics** across agents, and — on the roadmap — controlled experiments that verify whether a recommended change actually helped. See [docs/research/competitive-landscape.md](docs/research/competitive-landscape.md) for a sourced comparison, including where competitors already beat us.

## Install

Requires **Node.js ≥ 22.13** (uses the built-in SQLite module; no native dependencies).

```sh
npm install -g havrin        # once published
# or from source:
git clone https://github.com/havrin/havrin && cd havrin
npm install && npm run build
npm link                     # puts `havrin` on your PATH
```

Runtime dependencies: exactly one (`smol-toml`, BSD-3-Clause, for Codex config parsing). Everything else is Node built-ins.

## Quickstart

```sh
havrin doctor                      # check agent installs + storage health
havrin audit                       # analyze the last 30 days, all agents
havrin audit --since 7d --agent claude
havrin audit --json > audit.json   # machine-readable output
havrin report --format json        # re-render the last saved audit
havrin demo                        # synthetic dataset — no personal data needed
```

Supported agents are discovered automatically from their standard install locations — no configuration needed. No session data yet? `havrin demo` runs the full pipeline on a clearly-labeled synthetic dataset that exercises every diagnostic rule.

## Supported agents

| Agent | Storage analyzed | Verified against | Notes |
|---|---|---|---|
| **OpenCode** | `~/.local/share/opencode/opencode.db` | v2.3.1 | SQLite, read-only; credential tables never queried |
| **Codex CLI** | `~/.codex/sessions/**/rollout-*.jsonl` | 0.169.1 | Tool failures inferred from output (tagged heuristic) |
| **Claude Code** | `~/.claude/projects/**/*.jsonl` | 2.1.308–2.1.327 | Split-record usage dedup; reported `is_error` failures; sidechain/subagent stats; compaction boundaries; cost-state totals |

Session schemas are version-sensitive. Havrin probes the layout before reading, degrades gracefully on unknown layouts, and reports partial parses instead of guessing. Legacy OpenCode JSON storage (pre-2.x) is detected and reported as unsupported. More agents are planned via the same adapter interface.

### Claude Code specifics

- **Correct token accounting.** Claude Code splits one API response into multiple transcript records, each repeating the full usage block. Havrin merges records by message id and counts usage exactly once (verified against 5,434 real multi-record groups; parsed totals cross-checked against agent-reported `cost-state`).
- **Reported failures, not guesses.** Tool errors come from `tool_result.is_error`; interrupted calls are distinguished from failures.
- **Subagent visibility.** Sidechain activity is summarized per session (turns, tool calls, errors) and in report totals.
- **Honest costs.** Dollar figures come from Claude Code's own `cost-state` and are suppressed when it flags unknown model pricing. Tokens are always shown; costs are never invented.
- **Private files stay private.** `~/.claude.json` and `.credentials.json` are never opened. Transcript text, tool inputs/outputs, thinking, attachments, and API-request blobs never enter Havrin's model (sentinel-tested).

## What v0.2 does

| Capability | Status |
|---|---|
| Detect OpenCode, Codex CLI, and Claude Code installations | ✅ |
| Read-only ingestion with incremental caching (unchanged sessions never re-parsed) | ✅ |
| Environment scan: configs, MCP servers, skills, instruction files | ✅ |
| 8 deterministic diagnostic rules with evidence + confidence, across all three agents | ✅ |
| Recommendations with what/why/change/evidence/tested/benefits/tradeoffs/apply/rollback | ✅ |
| Terminal + JSON reports; `doctor` health checks; provider attribution | ✅ |
| Synthetic demo dataset (all three agents) | ✅ |
| Malformed/missing data handled safely (partial parses reported, never crash) | ✅ |
| Software discovery, A/B experimentation, auto-apply | 🗺 roadmap — **not implemented** |

Recommendations are **observational, not experimentally verified**. Every recommendation says so explicitly (`tested: false`). Havrin never applies changes for you.

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

- **Local-only.** No network calls during analysis. No telemetry. No account.
- **Read-only.** Agent databases/files are opened read-only and never modified (tested byte-for-byte).
- **Content-free reports.** Reports contain metrics, timestamps, tool names, file paths, and fingerprints — never message text, tool output, or raw tool input. Tool error messages are truncated and secret-redacted (redaction before truncation). Config parse errors never echo file content.
- **Credentials are out of scope by construction.** OpenCode's credential tables are never queried; Claude's `~/.claude.json`/`.credentials.json` are never opened; config values under secret-looking keys are never retained — only the key path is flagged.
- **Disclosed exception:** session *titles* are user-derived free text (often LLM-summarized). They are truncated to 120 chars and included for usability; treat reports as sensitive if titles may be.
- **Your Havrin state** (`~/.local/share/havrin/`) is written with `0600` permissions.

Details: [docs/PRIVACY.md](docs/PRIVACY.md).

## Development

```sh
npm install
npm test          # node:test suite (131 tests), no test framework dependency
npm run typecheck
npm run build     # tsc → dist/
node --experimental-strip-types src/cli.ts audit   # run from source
```

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Roadmap: [ROADMAP.md](ROADMAP.md). Agent/contributor conventions: [AGENTS.md](AGENTS.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
