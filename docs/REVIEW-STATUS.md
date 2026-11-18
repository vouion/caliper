# Review Status

Havrin's security/correctness review history, recorded honestly. "Independent" means a separate read-only reviewer agent inspecting the code without shell access; "self-review" means the maintainer tracing the same paths (weaker, disclosed as such).

## v0.1 — independent review: COMPLETE, remediated

A read-only reviewer inspected the two-agent vertical slice. Findings H1/H2 (config parse-error content leak; Codex command misclassification) and M1–M7, L1–L11 were confirmed and **all remediated with regression tests** (`test/review-fixes.test.ts`). Highlights: redact-before-truncate, content-free parse warnings, failed-test counting, evidence timestamps, `__proto__` fingerprint collision + depth cap, semantic cache validation, mtime/window boundary fix, WAL-mode test, size guards.

## v0.2 — independent review: COMPLETE, remediated

A read-only reviewer inspected the Claude Code integration and verified the v0.1 remediations. Findings H-1 (src/dist divergence — resolved; hardening was committed), M-1 (deep semantic validation), M-2 (terminal escape-sequence injection), M-3 (dead `api_error` signal), M-4 (mention-vs-execution classification), and L-1…L-8 were confirmed and **all remediated with regression tests** (`test/review2-fixes.test.ts`). Highlights: deep cache/artifact shape validation, control-character sanitization at ingestion + render, `api_error` wired into retry-loops, segment-based command classification, group-merge/cost-state defensive warnings, exact-id transcript lookup, hermetic tests.

## v0.3 — independent review: BLOCKED (provider quota); self-review COMPLETE

Three independent reviewer launches for the experimentation engine failed with the model provider's `Allocated quota exceeded` error (the same quota limit observed during the live experiment). **No independent v0.3 review verdict was obtained.** This is disclosed rather than papered over.

In its place, the maintainer performed a documented **self-review** of the highest-risk paths (bias limitation acknowledged — the author reviewing their own code):

| Path | Traced | Outcome |
|---|---|---|
| `spawnControlled` timeout/kill, timer/stream cleanup, output cap, env | yes | Sound: settled-guard, timers cleared on all paths, 32MB cap, `NODE_TEST_CONTEXT` stripped. Windows process-tree kill is a documented limitation (no CI leg yet). |
| Approval gates vs dry-run/recovery/resume | yes | Gates sit after dry-run return, before any execution; recovery only mutates state; resume excludes completed trials. No un-gated real-agent path found. |
| `trial.error` content-leak potential | yes | Error sources are structural (fs/spawn); hardened with `sanitizeFreeText` defense-in-depth. |
| Run lock atomicity / stale recovery | yes | Hardened to exclusive `wx` create + dead-pid recovery (closed a check-then-write TOCTOU). Zombie-pid edge noted. |
| Workspace isolation / path escape | yes | `insideWorkspace` relative-check; mock edits validated; template copy skips symlinks; git clone `--no-hardlinks`. Symlink-following in checks yields only pass/fail (no content egress), within the approved agent's existing capability. |
| Acceptance `check.id` in scratch filenames | yes | **Fixed:** charset restricted to kebab-case to block crafted path traversal; regression test added. |
| Verdict boundary math | yes | **Fixed:** zero-duration efficiency guard; null/empty/NaN paths guarded; n<3 inconclusive enforced. |
| Missing-config trial edge | yes | **Fixed:** marked `error` instead of leaving a trial stuck `running`. |

Verification backing v0.3: 183 automated tests (stable across repeated runs), typecheck clean, and a **founder-approved live OpenCode experiment** (`exp-20261118034401-gywh7f`) exercising the real paid path end-to-end — including honest handling of a provider-quota trial failure and resume that re-attempted only the failed trial. See `docs/BENCHMARKS.md`.

**Outstanding:** run an independent v0.3 review when provider quota recovers; add a Windows CI leg; live-verify Codex/Claude execution backends (currently gated as unverified). These are tracked in `ROADMAP.md` (v0.3.x).
