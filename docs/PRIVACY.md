# Caliper Privacy & Security Model

Caliper processes potentially sensitive development data. This document states exactly what it touches, what it keeps, and what it guarantees — and how each guarantee is enforced and tested.

## Data flow

```
agent storage (read-only) ──► adapter ──► normalized model ──► rules ──► report
                                   │
                                   └──► Caliper state dir (0600, local)
```

There is **no network path** in Caliper: no telemetry, no update checks, no remote pricing, no LLM calls. Analysis is fully local and deterministic.

## What Caliper reads

| Source | Access | Notes |
|---|---|---|
| OpenCode `opencode.db` | `node:sqlite` `readOnly: true` | Only `session_v2`, `session_message`, `session_part` (count probe), `sqlite_master`. Credential tables (`account`, `control_account`, `credential`, `kv`, …) are never queried. WAL-mode databases are read without modifying the main file. |
| Codex `sessions/**/rollout-*.jsonl` | read | Plus `session_index.jsonl` for titles. `auth.json` and other Codex state are never opened. |
| Claude Code `projects/**/*.jsonl` | read | Transcripts only. `~/.claude.json` (account/auth + global MCP config) and `.credentials.json` are **never opened**. `settings.json` is scanned structurally for secret exposures only. |
| Agent configs (`opencode.json`, `config.toml`, `settings.json`, project `.mcp.json`) | read | Structure only; secret-looking values are never retained (see below). |
| Skill directories | directory listing | Names only; skill file contents are not read. |
| Instruction files (AGENTS.md, CLAUDE.md, CLAUDE.local.md, etc.) | read → hash | Content is hashed for collision detection and discarded; never stored or reported. |
| Agent binaries | `--version` only | Fixed argv, no shell, 8s timeout, 64KB cap. |

### Claude Code record handling

Only structural metadata is extracted from transcripts. Never retained, under any circumstances:

- user/assistant message text and thinking blocks (character counts only)
- `tool_use` inputs and `tool_result` content (fingerprints, names, paths, categories only)
- `toolUseResult` content fields (`stdout`, `stderr`, `file`, `structuredPatch`, …) — only `interrupted` is read
- `api-request-blob.message`, `api-request.params`, `attachment` content, `last-prompt.lastPrompt`, `queue-operation.content`, `file-history-snapshot` contents, `summary.summary` text
- identity records (`session-owner`, `bridge-session` account/org UUIDs)

Every one of these paths is sentinel-tested in `test/claude-privacy.test.ts`.

## What Caliper keeps

The normalized model (`src/core/types.ts`) and everything derived from it (findings, recommendations, reports, cache) contain:

- timestamps, durations, counts, token/cost aggregates
- agent/model/provider identifiers, session ids/titles/directories
- tool names, statuses, target file paths, coarse command categories (`test`/`build`/…)
- sha256 fingerprints of tool inputs (one-way; inputs are not recoverable)
- tool-generated error messages, truncated to 200 chars and secret-redacted

They never contain:

- user message text or assistant response text (only character counts)
- tool output content
- raw tool inputs (commands, file contents, prompts)
- credentials from any source

## Secret handling

1. **Config scanning** walks config keys; keys matching secret patterns (`apiKey`, `token`, `password`, …) with literal string values are recorded as *exposures* — key path + file only. The value is never copied into any Caliper structure. `{env:VAR}` references are not flagged.
2. **Redaction** (`redactSecrets`) strips common credential shapes (OpenAI/Anthropic-style keys, GitHub tokens, Slack tokens, AWS access keys, JWTs, `api_key=…` assignments) from the one place free text can enter: truncated tool error messages. Redaction runs **before** truncation so secrets straddling the cut boundary cannot survive as partial prefixes.
3. **Parse errors are content-free.** JSON/TOML parser exception messages embed source snippets (potentially secrets); Caliper never propagates them into warnings, reports, or stderr — only a generic message plus optional line/column position.
4. **Credential stores are never queried or opened**, so database/file-stored tokens cannot leak through Caliper even in principle.

## Storage guarantees

- Agent source data is never modified. Tests assert byte-for-byte equality of the fixture DB and rollout files after ingestion.
- Caliper state (`last-audit.json`, `cache/*.json`) is written atomically (tmp + rename) with mode `0600`.
- Demo mode uses fabricated data and never writes the real cache or last-audit artifact.

## Enforcement

The privacy contract is tested end-to-end in `test/privacy.test.ts` (OpenCode + Codex) and `test/claude-privacy.test.ts` (Claude Code): fixtures embed unique sentinel strings in user text, assistant text, thinking, tool inputs, tool outputs, `toolUseResult` content, API-request blobs, attachments, queue operations, file-history snapshots, summaries, config values, and credential stores; the tests assert none appear in the normalized record, report JSON, persisted artifact, or cache. Adapter immutability is tested in all three adapter suites (byte-for-byte). Permission bits are asserted in the privacy suite. Malformed-config-with-secret tests assert warnings stay content-free.

## Experiments (v0.3)

The experiment registry stores **definitions and measurements, never conversations**:

- Benchmark definitions (user-authored task prompts and acceptance checks) and configuration definitions (including instruction variants and mock fixture content) — stored for reproducibility. These are user-created inputs, not captured session data.
- Configuration fingerprints, benchmark source fingerprints, environment metadata, execution order seeds.
- Trial results: statuses, timings, exit codes, acceptance check outcomes (structural detail only — `exit=N`, `hash-match`), parsed test counts, and content-free session metrics from the existing adapters.

Never stored: agent conversation content, tool outputs, raw stdout/stderr, credentials. Agent stdout is streamed to transient capped files during execution, parsed only for structural data, and deleted in `finally` blocks. Trial workspaces are isolated copies/clones, deleted after each trial unless `--keep-workspaces` is passed; the benchmark source and your real repositories are never modified (tested).

Execution gates: real-agent runs require explicit `--approve-inference` (paid model inference + code modification in isolated workspaces); unverified backends additionally require `--allow-unverified`. Claude execution uses `--permission-mode bypassPermissions` **only** inside disposable trial workspaces behind these gates; OpenCode uses `--auto` under the same conditions. No agent configuration files are read or modified by execution adapters.

## Residual risks (honest list)

- **File paths and session titles can themselves be sensitive** (project names, client names). Titles are user-derived — Claude Code's `aiTitle` is an LLM summary of the conversation — and are truncated to 120 chars but otherwise included for usability. Keep `last-audit.json` private; do not publish reports without reviewing them.
- **Truncated tool error messages** may contain fragments of paths or input echoed by the tool. Redaction covers known credential shapes, not arbitrary secrets. Claude Code heuristic-free reported errors carry no message text at all; Codex heuristic errors carry only a content-free marker.
- **Fingerprints** are unsalted sha256 of inputs; an attacker who already knows a candidate input can confirm it was used. This is a deliberate trade-off for retry detection; inputs are not stored.
- **Future subsystems** (discovery) will introduce network paths. They must ship with explicit consent gates, isolation, and an updated version of this document — not before. Experiment execution already introduces local subprocess surfaces; they are approval-gated, isolated, and content-free by construction.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository, or contact the maintainers listed in the repository. Do not include real session data in reports; the synthetic demo dataset reproduces all rule paths.
