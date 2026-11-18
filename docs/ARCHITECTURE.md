# Caliper Architecture (v0.3)

## Overview

Caliper is a single-process Node.js CLI. The audit pipeline is:

```
detect → list → ingest (incremental) → environment scan → diagnostics → recommendations → report
```

The experiment pipeline (v0.3) closes the loop:

```
create (benchmark + configs + fingerprints) → run (isolated trials, seeded order)
  → execute (approval-gated backends) → verify (Caliper-run acceptance checks)
  → measure (session-adapter reuse) → compare (correctness-first verdicts)
  → link (recommendation lifecycle states)
```

Six subsystems are planned long-term (Session Intelligence, Environment Intelligence, Diagnostic Engine, Software Discovery, Experimentation, Optimization). v0.3 implements the first three, the Experimentation engine foundation, and the recommendation half of Optimization, for three agents (OpenCode, Codex CLI, Claude Code). Discovery is deliberately absent — see ROADMAP.md.

```
src/
  bin.ts               Version-guarded bin entry (friendly error on Node < 22.13)
  cli.ts               Arg parsing (util.parseArgs), commands, exit codes
  audit.ts             Orchestrator: windowing, cache, coverage accounting
  doctor.ts            Read-only health checks
  store.ts             Caliper state: incremental cache + last-audit artifact (atomic, 0600)
  version.ts
  core/
    types.ts           Normalized data model + privacy contract (the central schema)
    validate.ts        Deep structural validators (cache/artifact/experiment integrity)
    session.ts         Model helpers: iterTools, token/cost aggregation
    classify.ts        Privacy-preserving segment-based command classification
    util.ts            Fingerprints (sha256, depth-capped), redaction, sanitization
    fs.ts              XDG paths, atomic writes, PATH lookup (no subprocess)
    errors.ts          CaliperError codes: USAGE/NO_AUDIT/NO_DATA/IO/PARSE/UNSUPPORTED/INTERNAL
  adapters/            SESSION-READING adapters (observe history, read-only)
    adapter.ts         AgentAdapter interface: detect / listSessions / readSession
    opencode.ts        OpenCode SQLite adapter (verified v2.3.x)
    codex.ts           Codex JSONL rollout adapter (verified 0.169.x)
    claude.ts          Claude Code JSONL transcript adapter (verified 2.1.308–2.1.327)
  env/
    environment.ts     Config/MCP/skills/instruction discovery; secret-exposure detection
  diagnostics/
    rules.ts           Eight pure rules + engine (thresholds documented per rule)
  optimize/
    recommend.ts       Finding → 8-field recommendation templates (tested: false)
  experiment/          EXPERIMENTATION engine (v0.3)
    types.ts           Benchmark/config/trial/verdict model + availability contract
    validate.ts        Strict benchmark/config validation (untrusted user input)
    builtin.ts         Built-in fix-failing-test benchmark (anti-cheat hash check)
    workspace.ts       Source fingerprinting + isolated workspace materialization
    execution/         EXECUTION adapters (run agents; distinct from session adapters)
      adapter.ts       Interface + controlled spawn (timeout, group kill, output cap)
      mock.ts          Deterministic mock backend (tests/demo; zero cost)
      opencode.ts      Primary backend (interface-verified v2.3.1)
      codex.ts         Implemented, live execution UNVERIFIED (gated)
      claude.ts        Implemented, live execution UNVERIFIED (gated)
    metrics.ts         Caliper-run acceptance checks + session-metrics reuse
    compare.ts         Aggregates + correctness-first verdict rules
    store.ts           Registry persistence, integrity validation, run locks, recovery
    runner.ts          Orchestration: approval gates, seeded order, resume semantics
    report.ts          Terminal/JSON experiment reports
    link.ts            Recommendation ↔ experiment lifecycle states
    demo.ts            Ephemeral mock experiment (nothing persisted)
  report/
    assemble.ts        Shared report assembly (real + demo use the same path)
    terminal.ts        ANSI terminal renderer (NO_COLOR/FORCE_COLOR/TTY aware)
  demo/
    dataset.ts         Synthetic audit dataset exercising every rule; clearly labeled
```

## Key decisions

### TypeScript on Node ≥ 22.13, one runtime dependency

Node's built-in `node:sqlite` reads OpenCode's database with zero native deps (the deciding factor vs. Rust/Go, which would need a SQLite dependency and cross-platform build matrix). `util.parseArgs`, `node:test`, and native type stripping cover CLI, tests, and dev execution. The only runtime dependency is `smol-toml` (BSD-3-Clause, Apache-2.0-compatible) for Codex `config.toml`. Source uses erasable-only TS with `.ts` import extensions; `tsc` emits `dist/` with rewritten `.js` extensions for the published bin.

### Normalized model as the privacy boundary

Adapters translate agent-specific storage into `SessionRecord` (see `core/types.ts`). The model carries **no user text, no tool output, no raw tool input** — only counts, timestamps, tool names, target file paths, coarse command categories, sha256 input fingerprints, and truncated/redacted tool error messages. Session titles are the one deliberate free-text exception (user-derived, truncated to 120 chars, disclosed in PRIVACY.md). Everything downstream (rules, reports, cache) consumes only this model, so the privacy contract is enforced in one place and tested end-to-end for all three agents (`test/privacy.test.ts`, `test/claude-privacy.test.ts`).

Fingerprints serve double duty: they detect byte-identical retries (the strongest stuck-loop signal) without storing inputs. Codex orphan outputs (calls predating a rollout) get unique fingerprints so they can never form false identical-input groups.

### Adapter interface

```ts
interface AgentAdapter {
  id: AgentId;
  detect(): AgentInstallation;                    // binary, version, layout, issues
  listSessions(inst): SessionMeta[];              // cheap listing for windowing
  readSession(inst, meta): SessionRecord;         // full parse, read-only
}
```

Adding an agent = one adapter + fixtures + registration in `ADAPTERS`. Layout probing happens in `detect()` so unsupported storage is reported, never guessed at.

### Verified storage schemas (as of 2026-11-17)

**OpenCode v2.3.1** — `opencode.db`:
- `session_v2`: metadata + agent-reported token/cost aggregates; `time_archived IS NULL` filter.
- `session_message`: `type ∈ {user, assistant, compaction, idle, synthetic, system, agent-switched, model-switched, location-switched}`; parts embedded in `data.content[]` (`text` / `reasoning` / `tool`). Tool parts: `state.status ∈ {running, completed, error}`, `state.input`, `state.error.{type,message}`, `time.{created,ran,completed}`.
- `session_part` exists but is empty in 2.3.x; a populated table triggers a forward-compat warning.
- Credential tables (`account`, `control_account`, `credential`, …) are **never queried**.

**Codex CLI 0.169.1** — `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`:
- Lines `{timestamp, ordinal, type, payload}`; relevant: `session_meta`, `turn_context`, `response_item` (`message`, `custom_tool_call`/`function_call` + `*_output`), `event_msg` (`turn_aborted`, …), `token_usage_record`.
- Tool failure status is not reliably reported → inferred from output text (`"exit_code":N≠0`, `exit code N`, error markers), tagged `statusSource: 'heuristic'`; rules cap confidence accordingly. Reported `failed`/`incomplete` call statuses are honored even without output.
- `output` may be a string or content-item array; both handled. Orphan outputs with `name` are recovered with unique fingerprints (never form false identical-input groups).
- `function_call` inputs are JSON (`{"command":[...]}`) and are unwrapped before command classification; `custom_tool_call` inputs are raw script text.
- `token_usage_record.usage` is per-response (attached to the latest assistant turn without tokens); `thread_token_usage` is cumulative (used as reportedTotals).
- Duplicate session ids across rollouts (resume/fork) are deduped to the newest file.
- `session_index.jsonl` provides titles (best-effort, truncated to 120 chars).

**Claude Code 2.1.308–2.1.327** — `~/.claude/projects/<project-slug>/<sessionId>.jsonl`:
- Core records: `user`, `assistant`, `system` (subtypes incl. `compact_boundary`, `api_error`), `cost-state`, `ai-title`; legacy `summary` markers handled. Extended builds add many record types (`attachment`, `api-request*`, `queue-operation`, `file-history-*`, `session-owner`, `bridge-session`, `last-prompt`, …) — all ignored or reduced to structural metadata; several carry raw content or identity data and are never retained.
- **Split-record usage dedup (critical):** one API response is written as multiple assistant records (one per content block, `apiBlockIndex`), each repeating the full `message.usage`. Verified on 5,434 real multi-record groups: usage is identical within a group. Records are merged by `message.id`; usage counted exactly once. Parsed totals cross-checked against `cost-state.modelUsage` on real sessions (ratios ≤ 1.0; gaps explained by compaction/retry API calls that produce no transcript message).
- Tool failures are **reported**: user records carry `tool_result` blocks with `is_error`; `toolUseResult.interrupted` marks user interruptions (status `unknown`, not error). Unresolved calls (interrupted sessions) are `unknown`.
- Token categories: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens_details.thinking_tokens` → normalized TokenUsage. Absent usage stays undefined (unavailable ≠ zero).
- `cost-state` (last record wins) provides agent-reported totals and `totalCostUSD`; cost is suppressed when `hasUnknownModelCost` is true. Surfaced as `reportedTokens`/`reportedCost`, never added on top of parsed totals.
- `isSidechain` records → `subagentStats {turns, toolCalls, toolErrors}`; undefined when the agent exposes no sidechain data. Sidechain user prompts are not counted as user turns.
- `compact_boundary.compactMetadata.trigger` → compaction reason; model changes between assistant groups → model-switch events; `<synthetic>` model messages → assistant error markers (excluded from retry-loop counting).
- MCP tools are named `mcp__<server>__<tool>`; project MCP config comes from `.mcp.json`. Global MCP config lives in `~/.claude.json`, which is **never opened** (account/auth data) — global Claude MCP servers are therefore out of scope.
- `~/.claude.json` and `.credentials.json` are never opened. `CALIPER_CLAUDE_HOME` (test override) takes precedence over `CLAUDE_CONFIG_DIR` (official Claude Code override), then `~/.claude`.
- File naming: filename = sessionId (verified unique across 5,422 real files); defensive dedupe keeps the newest on collision. `updatedAt` is floored to integer ms because `Date.now()` truncates while `mtimeMs` is fractional (just-written files must not fall outside the audit window).

These schemas are not stable contracts. Adapters parse defensively: malformed rows/lines produce `partial: true` + capped `parseWarnings`, never exceptions that abort an audit.

### Incremental ingestion

`store.ts` caches normalized records per agent keyed by session id + change signature (OpenCode: `time_updated:version`; Codex/Claude: `mtimeMs:size`). Audits re-parse only changed sessions within the window; cache schema version mismatches, syntactic corruption, and semantically invalid entries (shape-validated) fall back to full ingestion. Cache is capped at 2000 sessions/agent (oldest evicted) — sized for large active collections (verified against a 5,422-session Claude install). `--no-cache` forces re-ingestion without destroying other entries. `last-audit.json` is shape-validated on load; a corrupt artifact produces a clear NO_AUDIT error, not a crash.

### Deterministic diagnostics

Rules are pure functions `(sessions, environment) → Finding[]`. Thresholds are documented in `src/diagnostics/rules.ts` and tested at boundaries. Confidence is evidence-strength, not severity: any heuristic error evidence caps `repeated-tool-failures` at medium; `missing-test-verification` is medium because tests may run outside the session (failed test runs still count as verification activity); `unused-mcp-servers` is medium because tool-name prefix matching is an inferred convention. Synthetic assistant placeholders are excluded from error-run counting. Findings are capped per rule (5) and sorted by severity. All rules apply across all three agents via the normalized model; no Claude-specific rule was added without sufficient evidence (subagent activity is surfaced as statistics, not judgments).

### Recommendations

One recommendation per fired rule, with the eight mandated fields (what/why/change/evidence/tested/benefits+tradeoffs/apply/rollback). `tested` is always `false` in v0.1 with an explicit note. Apply steps are manual; rollback is always described. No auto-apply exists.

### Reports

- Terminal: width-aware wrapping, severity badges, `NO_COLOR`/`FORCE_COLOR`/TTY handling.
- JSON: the `AuditReport` object verbatim (`schemaVersion: '1'`), suitable for scripting.
- `caliper report` re-renders `last-audit.json`; demo audits never overwrite real state.

## Experimentation engine (v0.3)

### Separation of concerns

Session-reading adapters (`src/adapters/`) observe history and are read-only. Execution adapters (`src/experiment/execution/`) run agents headlessly and are a **separate interface** — no session adapter gained execution capabilities. Metrics flow back through the existing session adapters (reuse, not duplication): after a trial, the runner locates the agent's session (caller-chosen id for OpenCode/Claude; cwd+time discovery for Codex) and extracts content-free metrics.

### Benchmarks and isolation

A `BenchmarkSpec` defines: source (template directory or local git repo), task prompt, deterministic acceptance checks (`test-command`, `command-succeeds`, `file-exists`, `file-hash`), and execution limits. The built-in `fix-failing-test` benchmark ships a dependency-free JS project with a genuine boundary bug, a 6-case node:test suite (exactly 1 failing at baseline), and a **test-file hash acceptance check** — an agent cannot pass by modifying/deleting tests.

Every trial gets a fresh workspace: templates are copied; git sources use `git clone --local --no-hardlinks` (no network, independent object store). Sources are fingerprinted at creation (sorted file hashes / git HEAD) and re-verified before every run — changed sources block execution to preserve reproducibility. Workspaces are deleted after trials unless `--keep-workspaces`.

### Execution safety

- Fixed argv, never shell strings, for agent invocation. OpenCode: `run --format json --session <id> --title <label> --archived --auto --standalone [--model] [--agent]`. Codex: `exec -s workspace-write -C <ws> --json`. Claude: `-p --output-format json --session-id <uuid> --permission-mode bypassPermissions`.
- Hard timeouts with process-group termination (SIGTERM → 5s grace → SIGKILL).
- stdout/stderr streamed to transient capped files (32MB), parsed only for structure, then deleted. Never persisted, never retained in memory.
- **Approval gates**: real-agent runs require `--approve-inference` (paid inference + code modification). Unverified backends (Codex/Claude live execution) additionally require `--allow-unverified`. `--dry-run` previews the plan without approval or execution. Mock runs are free.
- Instruction variants are prepended to the task prompt — **no agent configuration file is ever modified**.
- Run locks (pid-based, stale-lock recovery) prevent duplicated concurrent execution; completed trials are never re-executed on resume; interrupted trials are marked and re-attempted.

### Measurement and verdicts

Correctness is evaluated by Caliper running acceptance checks in the workspace after the agent finishes — never agent-reported, never LLM-judged. Test counts are parsed best-effort from node:test (spec/TAP) and pytest reporters, labeled by source; exit code is authoritative. `null` means unavailable, never zero.

Verdict rules (deterministic, boundary-tested):
1. Success-rate gap ≥ 1/3 with n ≥ 3 → correctness decides (faster-but-incorrect never wins).
2. Efficiency decides only when both sides ≥ 80% success, gap < 1/3, and time improves ≥ 20% AND tokens ≥ 10%. Mixed efficiency = trade-off, no winner.
3. Confidence: n ≥ 5 + large gap → `verified`; n ≥ 3 → `preliminary`; n < 3 → `inconclusive`. These are conservative engineering thresholds, not a full statistical test; variance (stddev/min/max) is reported alongside. No p-values are invented.

Recommendation states: `proposed → ready-for-testing → experiment-running → experiment-completed → verified-improvement | no-meaningful-improvement | regression-detected | inconclusive`. Only `verified-improvement` is an experimentally proven improvement. `caliper audit` links states automatically for experiments created with `--recommendation <id>`.

### Registry

`caliperHome()/experiments/<id>/experiment.json` — definition, config fingerprints, environment metadata (agent versions, platform, Node), order seed, trial results. Deep shape validation on load; corrupt records are rejected (listed as `corrupted`, never crash). Atomic 0600 writes. Transient `scratch/` and `workspaces/` are cleaned in `finally` blocks.

## CLI contract

- Commands: `doctor`, `audit`, `report`, `demo`, `experiment {list|create|run|report|inspect|demo}`, `help`, `version`.
- Exit codes: `0` success (including "no data" audits, which explain themselves), `1` runtime failure / doctor failures, `2` usage error (including missing experiment approval).
- Structured errors: `error[CODE]: message` + `hint:` on stderr. Parser exception messages are never propagated (they can embed source content).
- `audit` flags: `--agent opencode|codex|claude` (repeatable), `--since <dur>`, `--all` (mutually exclusive with `--since`), `--limit <1..1000>`, `--no-cache`, `--project <dir>`, `--json`.
- `report` flags: `--format json|terminal`; `--json` is an alias for `--format json`.
- `experiment create` flags: `--benchmark <ref>`, `--baseline <file>`, `--candidate <file>` (repeatable), `--trials <1..20>`, `--seed <n>`, `--recommendation <id>` (repeatable).
- `experiment run` flags: `--approve-inference`, `--allow-unverified`, `--dry-run`, `--keep-workspaces`, `--timeout <ms>`.
- Coverage accounting: `discovered = analyzed + skippedWindow + skippedLimit + failedReads`.
- The published bin (`dist/bin.js`) checks the Node version before loading the CLI, so unsupported runtimes get a clear message instead of a module-load stack.

## State & environment overrides

State dir: `$CALIPER_HOME` → `$XDG_DATA_HOME/caliper` → `~/.local/share/caliper`. Contains `last-audit.json` and `cache/{opencode,codex,claude}.json`, all `0600`, atomic writes.

Overrides (tests and advanced use only): `CALIPER_HOME`, `CALIPER_OPENCODE_DATA_DIR`, `CALIPER_OPENCODE_CONFIG_DIR`, `CALIPER_CODEX_HOME` (also honors `CODEX_HOME`), `CALIPER_CLAUDE_HOME` (takes precedence over `CLAUDE_CONFIG_DIR`). Tests must set all agent overrides plus `HOME`/`USERPROFILE` and clear `CODEX_HOME`/`CLAUDE_CONFIG_DIR` so no real user data is ever ingested.

## Subprocess policy

Two bounded surfaces:
1. **Detection**: `<agent-binary> --version` (opencode, codex, claude) — fixed argv, no shell, 8s timeout, 64KB cap, stderr discarded. PATH lookup is pure filesystem inspection.
2. **Experiments** (approval-gated): agent execution via fixed argv with hard timeout + process-group kill + capped transient output; benchmark acceptance commands via `/bin/sh -c <command>` (user-authored benchmark definitions, passed as a single argv element, run inside isolated workspaces with their own timeouts). Local `git clone --local --no-hardlinks` for git-source workspaces. No other subprocess execution exists.

## Testing

`node:test` (no framework dependency): 183 tests covering util/classify boundaries, all eight rules (positive + negative + confidence caps), all three session adapters against synthetic fixtures (malformed data, read-only immutability, split-record usage dedup, orphan outputs, archived sessions, WAL mode, size guards, duplicate ids, sidechains, cost-state semantics), environment scanning (incl. content-free parse warnings), end-to-end audit (windowing, limit, cache hit/miss/invalidation, semantic corruption, multi-agent attribution), CLI subprocess behavior (exit codes, JSON round-trip, NO_COLOR, flag conflicts), demo determinism + rule coverage, the privacy contract over report/artifact/cache for all three agents (sentinel strings in every content-bearing record type), and the experimentation engine (create validation, full mock lifecycle, approval gates, dry-run, seeded order reproducibility, workspace isolation incl. git sources, failure/timeout honesty, interrupt recovery, live-lock duplicate protection, source-fingerprint integrity, verdict boundary tests, test-stats parsing, recommendation linking, registry privacy).

Real-world integration verified separately against installed OpenCode 2.3.1 (258 sessions), Codex 0.169.1 (25 rollouts), and Claude Code 2.1.327 (5,422 transcripts, 1.81 GB): discovery, ingestion, diagnostics, caching, and benchmarking (see README performance table). Experiment execution backends: OpenCode interface verified against `opencode run --help` (v2.3.1); live paid runs are approval-gated and have not been executed by the maintainers as of this release. Codex/Claude execution is implemented but explicitly unverified.

## Known limitations (v0.3)

- OpenCode legacy JSON storage unsupported (detected + reported).
- Codex tool-error detection is heuristic; some failures and some tool types are invisible.
- Shell command classification is regex-based and conservative (false negatives expected; quoted mentions/search arguments excluded from test detection).
- MCP usage attribution relies on naming conventions (`server_tool`, `mcp__server__tool`).
- Claude global MCP servers (in `~/.claude.json`) are out of scope because that file holds auth data; only project `.mcp.json` is scanned.
- Claude `cost-state` totals can exceed transcript-parsed tokens (compaction/retry API calls produce no transcript message); both figures are reported separately.
- Transcripts/message volumes >128 MB are skipped with explicit warnings.
- Instruction-file *conflict* detection is limited to skill-id collisions; semantic conflict analysis of instruction content is future work (and must remain content-local).
- Project-level `opencode.json` / `.opencode/` config (MCP servers, providers) is not yet scanned; only global config + project instruction files/skills.
- Cost figures are agent-reported; $0.00 may mean unavailable pricing.
- **Experiments**: Codex/Claude live execution unverified; no community benchmark suites yet; verdict thresholds are conservative engineering rules, not full statistical tests; skill/MCP configuration variants require manual config changes (only model/agent/instruction variants are automated); cross-experiment comparison and historical tracking are future work.
