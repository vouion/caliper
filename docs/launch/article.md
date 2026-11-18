# dev.to / Hashnode article — outline (founder publishes)

Working title: **"Building a zero-LLM analyzer for AI coding workflows (and why it
never trusts the agent)"**

Goal: long-tail search traffic + an engineering story that doubles as a portfolio
piece. Technical, honest, code-backed. Cross-post to Hashnode with a canonical link.

## Outline

1. **The problem I kept seeing.** Agents retry identical failing calls, re-read
   unchanged files, edit without testing. Usage dashboards show spend, not waste.
   Concrete example (the stuck-edit loop from the demo).

2. **Design constraints that shaped everything.**
   - Local-first, zero network during analysis.
   - Zero-LLM: diagnostics are pure functions, not model calls.
   - Content-free: no message text, tool output, or raw input ever enters the model.
   - No auto-apply: recommendations are instructions for humans.
   Why these are features, not limitations.

3. **The content-free normalized model.** How three very different storage layouts
   (OpenCode SQLite, Codex JSONL rollouts, Claude Code JSONL transcripts) collapse
   into one schema of counts, paths, fingerprints, timestamps. The Claude
   split-record usage-dedup bug (naive summation inflates tokens 2–3×) and how
   merging by message id fixed it — verified on 5,434 real groups.

4. **Deterministic diagnostics.** Walk through 2–3 rules (repeated-tool-failures,
   redundant-file-reads, missing-test-verification): thresholds, evidence,
   confidence vs severity, why confidence is capped for heuristic evidence.
   Pure functions → testable at boundaries (201 tests).

5. **Proving a change helps (the experiment engine).** Baseline-vs-candidate in
   isolated workspaces, seeded order, hard timeouts. The key decision: Caliper runs
   the acceptance tests itself — never the agent's claim, never an LLM judge — and
   a test-file hash check stops "pass by deleting tests." Correctness-first verdicts;
   null ≠ zero; small samples stay inconclusive. Show the real measured result.

6. **Closing the loop without auto-apply.** `caliper prompt`: templating the audit
   into a provider-agnostic fix prompt with operating rules, evidence, rollback, and
   a definition of done. The user's agent acts; the user verifies.

7. **Honest limits.** Pre-1.0; crowded observation space; Codex/Claude live execution
   unverified/gated; observational ≠ proven. What I'd do differently.

8. **Try it.** `caliper demo`, `caliper experiment demo`, repo link, Apache-2.0.

## Assets
- `assets/demo.gif` (hero), `assets/social-preview.png` (cover).
- Code snippets from `src/diagnostics/rules.ts`, `src/experiment/compare.ts`.
- The measured benchmark table from `docs/BENCHMARKS.md`.

## Notes
- Keep claims tied to what's implemented and measured; no invented users/metrics.
- Add canonical URL when cross-posting. Tag: typescript, cli, ai, productivity, opensource.
