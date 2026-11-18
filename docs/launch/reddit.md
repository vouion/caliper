# Reddit — drafts (founder posts; verify each subreddit's rules first)

Disclose you're the author in every post. Space posts across days; do not blast.
Many subs have account-age/karma minimums and self-promotion limits — read the
sidebar + recent mod posts before submitting. Link the repo, not a tracking URL.

## Base post (adapt per sub)

**Title:** Caliper — a local-first CLI that finds wasted effort in AI coding-agent
sessions (OpenCode / Codex / Claude Code), no LLM required

**Body:**
I built an open-source CLI that analyzes how you work with AI coding agents and
points out the expensive failure modes: identical failing tool calls retried in a
loop, files re-read without changing, edits made without running tests, repeated
context compaction, unused MCP servers, plaintext secrets in config.

It's local-first and zero-LLM: analysis makes no network calls, and the data model
is content-free (metrics, paths, fingerprints — never message text or tool output).
Agent data is opened read-only. Each finding has evidence + confidence + a fix with
apply/rollback steps. `caliper prompt` generates a paste-ready prompt for your own
agent to apply the fixes; an experiment engine can verify whether a change actually
helped (it runs the tests itself, correctness-first, small samples stay inconclusive).

Apache-2.0, TypeScript/Node ≥22.13, 201 tests. You can try it on synthetic data
without importing anything personal: `caliper demo`.

Repo + animated demo: https://github.com/vouion/caliper

Happy to answer questions about the diagnostics or the privacy model.

## Per-subreddit angle
- **r/commandline** — lead with the CLI/UX + demo GIF. Strong fit; technical crowd.
- **r/coolgithubprojects** / **r/opensource** — showcase the repo + demo; short body.
- **r/ClaudeAI** — lead with Claude Code support (split-record token dedup, reported
  failures, sidechain stats) and the privacy guarantee (auth files never opened).
- **r/ChatGPTCoding** / **r/OpenAI** — lead with Codex support + the "stop retrying
  the same failing call" pain point.
- **r/LocalLLaMA** — lead with local-first/zero-LLM/privacy; note it analyzes agent
  workflows (not a model runner) so it's tangential — frame accordingly.
- **r/programming** — only if current rules allow show-posts; technical deep-dive
  angle (deterministic rules, content-free model). Check mod rules first.

## Rules checklist (per sub, before posting)
- [ ] Self-promotion allowed? Required flair (e.g. "Show"/"Project")?
- [ ] Account age / karma minimum met?
- [ ] Author disclosure included?
- [ ] No duplicate cross-post same day; respect cooldowns.
