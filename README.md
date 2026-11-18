# Havrin

**The open-source optimization engine for AI-powered development.**

Havrin analyzes how you actually work with AI coding agents, finds evidence-backed inefficiencies in your sessions and configuration, and tells you what to change — without sending your data anywhere, and without needing an LLM.

```
$ havrin audit

havrin v0.1.0 · development environment audit
────────────────────────────────────────────────────────────────────────
ENVIRONMENT
  ● opencode  v2.3.1 · sqlite-v2 · 257 sessions
  ● codex     v0.169.1 · jsonl-rollout · 25 sessions

FINDINGS (19)  high 1 · medium 11 · low 7

  [HIGH] Repeated identical tool failures in Havrin Evals MVP bootstrap
         rule repeated-tool-failures · confidence high
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
havrin audit                       # analyze the last 30 days of sessions
havrin audit --since 7d --agent opencode
havrin audit --json > audit.json   # machine-readable output
havrin report --format json        # re-render the last saved audit
havrin demo                        # synthetic dataset — no personal data needed
```

No session data yet? `havrin demo` runs the full pipeline on a clearly-labeled synthetic dataset that exercises every diagnostic rule.

## What v0.1 does

| Capability | Status |
|---|---|
| Detect OpenCode (SQLite storage, v2.3.x verified) and Codex CLI (JSONL rollouts, 0.169.x verified) | ✅ |
| Read-only ingestion with incremental caching (unchanged sessions are never re-parsed) | ✅ |
| Environment scan: configs, MCP servers, skills, instruction files | ✅ |
| 8 deterministic diagnostic rules with evidence + confidence | ✅ |
| Recommendations with what/why/change/evidence/tested/benefits/tradeoffs/apply/rollback | ✅ |
| Terminal + JSON reports; `doctor` health checks | ✅ |
| Synthetic demo dataset | ✅ |
| Malformed/missing data handled safely (partial parses are reported, never crash) | ✅ |
| Software discovery, A/B experimentation, auto-apply | 🗺 roadmap — **not implemented** |

Recommendations in v0.1 are **observational, not experimentally verified**. Every recommendation says so explicitly (`tested: false`). Havrin never applies changes for you.

### The eight rules

| Rule | Fires when | Confidence |
|---|---|---|
| `repeated-tool-failures` | Same tool + byte-identical input fails ≥2× in a session (≥5 → high severity) | high (medium if errors are heuristic-only) |
| `retry-loops` | ≥3 consecutive identical non-read calls, or ≥2 consecutive assistant errors, or ≥3 provider retries | high |
| `redundant-file-reads` | Same file read ≥3× with ≥2 re-reads of unchanged content (writes reset the count) | high |
| `missing-test-verification` | ≥3 completed file edits and zero test commands observed in-session | medium (tests may run outside the agent) |
| `context-compaction-pressure` | ≥2 compactions in one session | high |
| `unused-mcp-servers` | Configured MCP server with no matching tool calls in analyzed sessions | medium (naming-convention inference) |
| `skill-name-collisions` | Same skill id in multiple skill directories | high |
| `plaintext-config-secrets` | Secret-looking config keys holding literal values (values never inspected) | high |

Thresholds are deliberately conservative. Absence of findings is not a guarantee of optimality.

## Privacy & security

- **Local-only.** No network calls during analysis. No telemetry. No account.
- **Read-only.** Agent databases/files are opened read-only and never modified (tested).
- **Content-free reports.** Reports contain metrics, timestamps, tool names, file paths, and fingerprints — never message text, tool output, or raw tool input. Tool error messages are truncated and secret-redacted.
- **Credentials are out of scope by construction.** OpenCode's credential tables are never queried; config values under secret-looking keys are never read into reports — only the key path is flagged.
- **Your Havrin state** (`~/.local/share/havrin/`) is written with `0600` permissions.

Details: [docs/PRIVACY.md](docs/PRIVACY.md).

## Supported agents & versions

| Agent | Storage analyzed | Verified against |
|---|---|---|
| OpenCode | `~/.local/share/opencode/opencode.db` (`session_v2`, `session_message`) | v2.3.1 |
| Codex CLI | `~/.codex/sessions/**/rollout-*.jsonl` | 0.169.1 |

Session schemas are version-sensitive. Havrin probes the layout before reading, degrades gracefully on unknown layouts, and reports partial parses instead of guessing. Legacy OpenCode JSON storage (pre-2.x) is detected and reported as unsupported in v0.1. Claude Code and other agents are planned via the same adapter interface.

## Development

```sh
npm install
npm test          # node:test suite (76 tests), no test framework dependency
npm run typecheck
npm run build     # tsc → dist/
node --experimental-strip-types src/cli.ts audit   # run from source
```

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Roadmap: [ROADMAP.md](ROADMAP.md). Agent/contributor conventions: [AGENTS.md](AGENTS.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
