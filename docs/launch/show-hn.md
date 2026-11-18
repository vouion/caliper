# Show HN — draft (founder posts)

## Title (pick one; keep under ~80 chars)
- `Show HN: Caliper – Local-first, zero-LLM optimization engine for AI coding agents`
- `Show HN: Caliper – Find and fix wasted effort in AI coding workflows (no LLM)`

## URL
https://github.com/vouion/caliper

## First comment (post immediately after submitting; stay online 2–3h to reply)

Hi HN — I built Caliper because I kept watching my coding agents burn tokens on
the same mistakes: retrying an identical failing tool call eight times, re-reading
files that never changed, editing code without ever running a test. Usage
dashboards told me what I spent, not what was wasted.

Caliper is a local-first CLI that reads your agent session data (OpenCode, Codex
CLI, Claude Code), runs deterministic diagnostics, and tells you what to change —
with evidence and confidence, not vibes.

What it does:
- 8 diagnostic rules: stuck retry loops, redundant file reads, unverified edits,
  context-compaction pressure, unused MCP servers, duplicate skills, plaintext
  secrets in config.
- Every finding carries evidence + confidence + a recommendation with apply and
  rollback steps.
- `caliper prompt` turns the audit into a ready-to-paste prompt for your own agent
  to apply the fixes (Caliper itself never auto-applies anything).
- An experimentation engine that runs baseline-vs-candidate comparisons in isolated
  workspaces and verifies correctness itself (it runs the tests, never trusts the
  agent's claim or an LLM judge). Only a `verified-improvement` verdict counts as
  proven; small samples stay `inconclusive`.

The part I cared most about: it's zero-LLM and content-free. Analysis makes no
network calls. The normalized model, reports, and cache contain metrics, paths,
fingerprints, and counts — never message text, tool output, or raw tool input.
Credential tables are never queried; Claude's auth files are never opened. Agent
data is opened read-only (tested byte-for-byte). One runtime dependency.

Honest limits: it's pre-1.0. Session observation is a crowded space (ccusage,
Decant, Sniffly do it well) — Caliper's bet is the next step: workflow-quality
diagnostics plus controlled verification, across agents, without an LLM. Codex and
Claude live-execution backends are implemented but unverified and extra-gated;
OpenCode is the verified backend. Observational recommendations are explicitly
`tested: false` until an experiment proves otherwise.

TypeScript/Node ≥22.13, Apache-2.0, 201 tests. A founder-approved live OpenCode
experiment ran end-to-end (real paid inference + real test verification); the
methodology and measured results are in docs/BENCHMARKS.md.

Repo (with an animated demo): https://github.com/vouion/caliper
Try it without importing personal data: `caliper demo` and `caliper experiment demo`.

I'd love feedback on the diagnostics and whether the experiment verdicts feel
trustworthy. What's the most expensive failure mode you see in your own agents?

## Notes
- Post Tue–Thu, ~08:00–10:00 PT.
- Do not ask for upvotes. Answer every substantive comment.
- If it doesn't gain traction, reposting later is allowed by HN norms (don't spam).
