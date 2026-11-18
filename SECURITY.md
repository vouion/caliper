# Security Policy

## Supported versions

Caliper is pre-1.0; only the latest released minor version receives security fixes.

## Reporting a vulnerability

Please report security issues **privately** via GitHub Security Advisories ("Report a vulnerability" on the repository's Security tab). Do not open public issues for vulnerabilities.

Include: affected version, a minimal reproduction, and impact. **Never include real session data, credentials, or private repository content** — the synthetic demo dataset (`caliper demo`, `caliper experiment demo`) reproduces all rule and pipeline paths for safe reproduction.

We aim to acknowledge reports within 7 days.

## Security model (summary)

Full details in [`docs/PRIVACY.md`](docs/PRIVACY.md). Key guarantees, enforced by tests:

- **Local-only analysis.** No network calls, telemetry, or LLM during audit. Experiments run agents locally; paid inference is explicitly approval-gated (`--approve-inference`).
- **Read-only sources.** Agent databases/files are opened read-only; byte-for-byte immutability is tested.
- **Content-free outputs.** Reports/registry contain metrics, fingerprints, paths, and categories — never conversation text, tool output, raw tool input, or credentials. Credential stores (OpenCode credential tables, Claude `~/.claude.json`/`.credentials.json`, Codex `auth.json`) are never opened.
- **Sanitization.** Secret redaction before truncation; control-character sanitization before terminal rendering; parser exception messages never propagated.
- **Isolated experiments.** Fresh workspace per trial; hard timeouts with process-group termination; transient execution artifacts deleted; atomic run locks.
- **State permissions.** Caliper's state directory is written `0600`, atomically.

## Known limitations

See the "Known limitations" section of [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/REVIEW-STATUS.md`](docs/REVIEW-STATUS.md) for the current review status and disclosed residual risks (e.g., session titles are user-derived free text; Codex/Claude live execution backends are unverified and gated).
