# Havrin Architecture (v0.1)

## Overview

Havrin is a single-process Node.js CLI. The v0.1 pipeline is:

```
detect → list → ingest (incremental) → environment scan → diagnostics → recommendations → report
```

Six subsystems are planned long-term (Session Intelligence, Environment Intelligence, Diagnostic Engine, Software Discovery, Experimentation, Optimization). v0.1 implements the first three plus the recommendation half of Optimization. Discovery and Experimentation are deliberately absent — see ROADMAP.md.

```
src/
  cli.ts               Entry point: arg parsing (util.parseArgs), commands, exit codes
  audit.ts             Orchestrator: windowing, cache, coverage accounting
  doctor.ts            Read-only health checks
  store.ts             Havrin state: incremental cache + last-audit artifact (atomic, 0600)
  version.ts
  core/
    types.ts           Normalized data model + privacy contract (the central schema)
    session.ts         Model helpers: iterTools, token/cost aggregation
    classify.ts        Privacy-preserving command classification; read/write tool sets
    util.ts            Fingerprints (sha256), redaction, duration/token formatting
    fs.ts              XDG paths, atomic writes, PATH lookup (no subprocess)
    errors.ts          HavrinError codes: USAGE/NO_AUDIT/NO_DATA/IO/PARSE/UNSUPPORTED/INTERNAL
  adapters/
    adapter.ts         AgentAdapter interface: detect / listSessions / readSession
    opencode.ts        OpenCode SQLite adapter (verified v2.3.x)
    codex.ts           Codex JSONL rollout adapter (verified 0.169.x)
  env/
    environment.ts     Config/MCP/skills/instruction discovery; secret-exposure detection
  diagnostics/
    rules.ts           Eight pure rules + engine (thresholds documented per rule)
  optimize/
    recommend.ts       Finding → 8-field recommendation templates (tested: false)
  report/
    assemble.ts        Shared report assembly (real + demo use the same path)
    terminal.ts        ANSI terminal renderer (NO_COLOR/FORCE_COLOR/TTY aware)
  demo/
    dataset.ts         Synthetic dataset exercising every rule; clearly labeled
```

## Key decisions

### TypeScript on Node ≥ 22.13, one runtime dependency

Node's built-in `node:sqlite` reads OpenCode's database with zero native deps (the deciding factor vs. Rust/Go, which would need a SQLite dependency and cross-platform build matrix). `util.parseArgs`, `node:test`, and native type stripping cover CLI, tests, and dev execution. The only runtime dependency is `smol-toml` (BSD-3-Clause, Apache-2.0-compatible) for Codex `config.toml`. Source uses erasable-only TS with `.ts` import extensions; `tsc` emits `dist/` with rewritten `.js` extensions for the published bin.

### Normalized model as the privacy boundary

Adapters translate agent-specific storage into `SessionRecord` (see `core/types.ts`). The model carries **no user text, no tool output, no raw tool input** — only counts, timestamps, tool names, target file paths, coarse command categories, sha256 input fingerprints, and truncated/redacted tool error messages. Everything downstream (rules, reports, cache) consumes only this model, so the privacy contract is enforced in one place and tested end-to-end (`test/privacy.test.ts`).

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
- Tool failure status is not reliably reported → inferred from output text (`"exit_code":N≠0`, `exit code N`, error markers), tagged `statusSource: 'heuristic'`; rules cap confidence accordingly.
- `output` may be a string or content-item array; both handled. Orphan outputs with `name` are recovered.
- `session_index.jsonl` provides titles (best-effort).

These schemas are not stable contracts. Adapters parse defensively: malformed rows/lines produce `partial: true` + capped `parseWarnings`, never exceptions that abort an audit.

### Incremental ingestion

`store.ts` caches normalized records per agent keyed by session id + change signature (OpenCode: `time_updated:version`; Codex: `mtimeMs:size`). Audits re-parse only changed sessions within the window; cache schema version mismatches and corruption fall back to full ingestion. Cache is capped at 500 sessions/agent (oldest evicted). `--no-cache` forces re-ingestion without destroying other entries.

### Deterministic diagnostics

Rules are pure functions `(sessions, environment) → Finding[]`. Thresholds are documented in `src/diagnostics/rules.ts` and tested at boundaries. Confidence is evidence-strength, not severity: heuristic Codex errors cap at medium; `missing-test-verification` is medium because tests may run outside the session; `unused-mcp-servers` is medium because tool-name prefix matching is an inferred convention. Findings are capped per rule (5) and sorted by severity.

### Recommendations

One recommendation per fired rule, with the eight mandated fields (what/why/change/evidence/tested/benefits+tradeoffs/apply/rollback). `tested` is always `false` in v0.1 with an explicit note. Apply steps are manual; rollback is always described. No auto-apply exists.

### Reports

- Terminal: width-aware wrapping, severity badges, `NO_COLOR`/`FORCE_COLOR`/TTY handling.
- JSON: the `AuditReport` object verbatim (`schemaVersion: '1'`), suitable for scripting.
- `havrin report` re-renders `last-audit.json`; demo audits never overwrite real state.

## CLI contract

- Commands: `doctor`, `audit`, `report`, `demo`, `help`, `version`.
- Exit codes: `0` success (including "no data" audits, which explain themselves), `1` runtime failure / doctor failures, `2` usage error.
- Structured errors: `error[CODE]: message` + `hint:` on stderr.
- `audit` flags: `--agent` (repeatable), `--since <dur>`, `--all`, `--limit <1..1000>`, `--no-cache`, `--project <dir>`, `--json`.

## State & environment overrides

State dir: `$HAVRIN_HOME` → `$XDG_DATA_HOME/havrin` → `~/.local/share/havrin`. Contains `last-audit.json` and `cache/{opencode,codex}.json`, all `0600`, atomic writes.

Overrides (tests and advanced use only): `HAVRIN_HOME`, `HAVRIN_OPENCODE_DATA_DIR`, `HAVRIN_OPENCODE_CONFIG_DIR`, `HAVRIN_CODEX_HOME` (adapter also honors Codex's own `CODEX_HOME`).

## Subprocess policy

The only subprocess execution is `<agent-binary> --version` during detection: fixed argv, no shell, 8s timeout, 64KB output cap, stderr discarded. PATH lookup itself is pure filesystem inspection.

## Testing

`node:test` (no framework dependency): 76 tests covering util/classify boundaries, all eight rules (positive + negative + confidence caps), both adapters against synthetic fixtures (including malformed data, read-only immutability, orphan outputs, archived sessions), environment scanning, end-to-end audit (windowing, limit, cache hit/miss/invalidations, corrupt cache), CLI subprocess behavior (exit codes, JSON round-trip, NO_COLOR), demo determinism + rule coverage, and the privacy contract over report/artifact/cache.

## Known limitations (v0.1)

- OpenCode legacy JSON storage unsupported (detected + reported).
- Codex tool-error detection is heuristic; some failures and some tool types are invisible.
- Shell command classification is regex-based and conservative (false negatives expected).
- MCP usage attribution relies on the `<server>_<tool>` naming convention.
- Instruction-file *conflict* detection is limited to skill-id collisions; semantic conflict analysis of instruction content is future work (and must remain content-local).
- Project-level `opencode.json` / `.opencode/` config (MCP servers, providers) is not yet scanned; only global config + project instruction files/skills.
- Cost figures are agent-reported; $0.00 may mean unavailable pricing.
- No experiments: recommendations are observational.
