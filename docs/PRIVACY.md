# Havrin Privacy & Security Model

Havrin processes potentially sensitive development data. This document states exactly what it touches, what it keeps, and what it guarantees — and how each guarantee is enforced and tested.

## Data flow

```
agent storage (read-only) ──► adapter ──► normalized model ──► rules ──► report
                                   │
                                   └──► Havrin state dir (0600, local)
```

There is **no network path** in v0.1: no telemetry, no update checks, no remote pricing, no LLM calls. Analysis is fully local and deterministic.

## What Havrin reads

| Source | Access | Notes |
|---|---|---|
| OpenCode `opencode.db` | `node:sqlite` `readOnly: true` | Only `session_v2`, `session_message`, `session_part` (count probe), `sqlite_master`. Credential tables (`account`, `control_account`, `credential`, `kv`, …) are never queried. |
| Codex `sessions/**/rollout-*.jsonl` | read | Plus `session_index.jsonl` for titles. `auth.json` and other Codex state are never opened. |
| Agent configs (`opencode.json`, `config.toml`) | read | Structure only; secret-looking values are never retained (see below). |
| Skill directories | directory listing | Names only; skill file contents are not read. |
| Instruction files (AGENTS.md etc.) | read → hash | Content is hashed for collision detection and discarded; never stored or reported. |
| Agent binaries | `--version` only | Fixed argv, no shell, 8s timeout, 64KB cap. |

## What Havrin keeps

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

1. **Config scanning** walks config keys; keys matching secret patterns (`apiKey`, `token`, `password`, …) with literal string values are recorded as *exposures* — key path + file only. The value is never copied into any Havrin structure. `{env:VAR}` references are not flagged.
2. **Redaction** (`redactSecrets`) strips common credential shapes (OpenAI/Anthropic-style keys, GitHub tokens, Slack tokens, AWS access keys, JWTs, `api_key=…` assignments) from the one place free text can enter: truncated tool error messages.
3. **Credential tables are never queried**, so database-stored tokens cannot leak through Havrin even in principle.

## Storage guarantees

- Agent source data is never modified. Tests assert byte-for-byte equality of the fixture DB and rollout files after ingestion.
- Havrin state (`last-audit.json`, `cache/*.json`) is written atomically (tmp + rename) with mode `0600`.
- Demo mode uses fabricated data and never writes the real cache or last-audit artifact.

## Enforcement

The privacy contract is tested end-to-end in `test/privacy.test.ts`: fixtures embed unique sentinel strings in user text, assistant text, tool inputs, tool outputs, config values, and DB credential tables; the test asserts none appear in the report JSON, the persisted artifact, or the cache. Adapter immutability is tested in both adapter suites. Permission bits are asserted in the privacy suite.

## Residual risks (honest list)

- **File paths and session titles can themselves be sensitive** (project names, client names). They are required for actionable diagnostics and are included in reports. Keep `last-audit.json` private; do not publish reports without reviewing them.
- **Truncated tool error messages** may contain fragments of paths or input echoed by the tool. Redaction covers known credential shapes, not arbitrary secrets.
- **Fingerprints** are unsalted sha256 of inputs; an attacker who already knows a candidate input can confirm it was used. This is a deliberate trade-off for retry detection; inputs are not stored.
- **Future subsystems** (discovery, experiments) will introduce network and execution paths. They must ship with explicit consent gates, isolation, and an updated version of this document — not before.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository, or contact the maintainers listed in the repository. Do not include real session data in reports; the synthetic demo dataset reproduces all rule paths.
