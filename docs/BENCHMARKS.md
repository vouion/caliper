# Havrin Benchmarks — Methodology & Results

All numbers below were measured on the maintainer's machine, not fabricated. Conditions are stated so results can be reproduced or contested.

## Machine conditions (2026-11-18)

- Linux x64, Node.js v26.13.0, ext4/tmpfs filesystems
- OpenCode v2.3.1 (258 sessions), Codex CLI 0.169.1 (25 rollouts), Claude Code 2.1.327 (5,422 transcripts, 1.81 GB)
- Havrin invoked via `node --experimental-strip-types src/cli.ts` or built `dist/cli.js`; measurements via `performance.now()` around `runAudit`/`runExperimentRecord` in-process (CLI startup excluded), RSS via `process.memoryUsage()`

## Session ingestion (Claude Code collection)

Command equivalent: `havrin audit --agent claude --all --limit 1000` with a fresh `HAVRIN_HOME`.

| Metric | Value |
|---|---|
| Sessions discovered | 5,422 |
| Sessions analyzed | 1,000 (limit) |
| Skipped (over limit) | 4,422 |
| Failed reads | 0 |
| Partial parses | 1 (154 MB transcript, size-guarded at 128 MB) |
| Initial ingestion | ~2.1 s |
| Cached re-run | ~0.6 s (1,000/1,000 cache hits; cache cap 2,000) |
| Peak RSS | ~325 MB (large-transcript parsing) |
| Steady-state heap | ~40–70 MB |

Notes:
- Discovery walks all 5,422 files and reads a 64 KB head per file; that cost (~0.5 s) is present in both runs and is the floor for cached runs.
- Token accounting was cross-checked against agent-reported `cost-state.modelUsage` on 16 real sessions: parsed/reported output-token ratios 0.37–1.0 (small sessions exactly 1.0). Gaps < 1.0 are explained by compaction/retry API calls that produce no transcript message; ratios > 1.0 would indicate double counting — none observed. The 5,434 multi-record message groups inspected all had identical usage within groups, validating merge-by-`message.id`.

## Experiment engine (mock verification)

`havrin experiment demo` — 2 mock configs × 3 trials, built-in `fix-failing-test` benchmark, real `node --test` verification in isolated workspaces:

- Baseline (no fix): execution completed 3/3, task success 0/3, test failures 3 (parsed from node:test spec output)
- Candidate (applies fix): execution completed 3/3, task success 3/3, test failures 0
- Verdict: candidate wins on correctness, confidence `preliminary` (n=3 < 5)
- Total wall time ~1.5–3 s (dominated by 6 real `node --test` verification runs)
- Deterministic verdict across repeated runs (seeded order, fixed fixtures)

## Live OpenCode experiment (measured 2026-11-18, founder-approved)

Registry record: `exp-20261118034401-gywh7f` (source of truth; `havrin experiment report exp-20261118034401-gywh7f`).

Setup: built-in `fix-failing-test` benchmark; baseline = OpenCode + `alibaba-token-plan/qwen4-max` (default agent `qwen-rigorous`); candidate = same model + verify-first instruction variant; 3 trials/config, seed 42, 5-minute per-trial timeout. Only one model is configured on this machine, so the live comparison exercises the instruction-variant path; the execution pipeline (spawn → session creation → metrics ingestion → verification → verdict) is identical for model comparisons.

**Phase 1 — first run (6 trials):** 5 trials completed (~30–39 s each, real inference); 1 baseline trial failed at 3.4 s with a provider-side quota error (`provider.quota`, confirmed via the session's error events — not a Havrin defect). The engine recorded the failure honestly: trial status `error`, verification still ran (tests-pass failed, anti-cheat hash passed), and the verdict counted it as an unsuccessful attempt. Result: baseline 2/3 vs candidate 3/3 → **candidate wins on correctness, confidence preliminary**. This phase demonstrates correctness-dominance and honest failure accounting on real runs.

**Phase 2 — resume (failed trial re-attempted after quota recovery):** completed-trial duplicate protection kept the 5 finished trials untouched; only `baseline-t1` re-ran (34.5 s, success). Final measured results:

| Metric | Baseline | Verify-first candidate |
|---|---|---|
| Task success | 3/3 | 3/3 |
| Avg execution time | 32.6 s (stddev 1.9 s) | 35.0 s (stddev 3.5 s) |
| Input tokens (sum) | 102 | 102 |
| Output tokens (sum) | 2.0k | 2.2k |
| Cache read (sum) | 257.1k | 265.0k |
| Tool calls / errors | 18 / 0 | 18 / 0 |
| Test failures | 0 | 0 |
| Timeouts / exec errors | 0 / 0 | 0 / 0 |
| Reported cost | $0.00 (provider reports no pricing — displayed as agent-reported, not invented) | same |

**Final verdict: no winner, `inconclusive`** — correctness comparable, no material combined efficiency advantage (the candidate was slightly slower and used slightly more tokens). On this trivial task the verify-first instructions added overhead without benefit; the baseline model already verified its fix. The engine refused to declare an improvement. This is the intended behavior: a single 6-trial experiment on one task establishes pipeline correctness, not a universal configuration ranking.

Reproducibility notes: session metrics were ingested through the standard OpenCode adapter from the trial sessions (caller-chosen `ses_*` ids, `--archived`); workspaces were deleted after each trial; transient stdout artifacts deleted; no conversation content entered the registry (inspect the record to verify).

## Reproducing

```sh
npm install && npm run build
havrin audit --agent claude --all --limit 1000 --json   # ingestion scale
havrin experiment demo --json                          # engine pipeline
# live (requires your own agent install + explicit approval):
havrin experiment create --benchmark builtin:fix-failing-test \
  --baseline baseline.json --candidate candidate.json --trials 3
havrin experiment run <id> --approve-inference
```
