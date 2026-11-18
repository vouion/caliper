# X / Twitter thread — draft (founder posts)

Attach `assets/demo.gif` to tweet 1 (the visual is the hook). Keep the thread
tight; link the repo in tweet 1 and the last tweet.

---

**1/ (hook + GIF)**
Your AI coding agent is wasting tokens and you can't see where.

I built Caliper: a local-first CLI that finds the waste in your agent sessions —
stuck loops, redundant reads, unverified edits — and proves what actually helps.

No LLM. No cloud. Your data never leaves the machine. 🧵

**2/**
It reads OpenCode, Codex CLI, and Claude Code sessions read-only and runs 8
deterministic diagnostics. Every finding comes with evidence, a confidence level,
and a fix with apply + rollback steps.

Not "you spent $40." More like "you retried
the same failing call 8× — here's why."

**3/**
New: `caliper prompt` turns the audit into a ready-to-paste prompt for YOUR agent
to apply the fixes.

Caliper diagnoses. Your agent acts. You verify. Nothing is auto-applied —
the loop stays in your hands.

**4/**
The part I'm most proud of: it can *prove* a change helps.

The experiment engine runs baseline-vs-candidate in isolated workspaces and runs
the acceptance tests itself — never trusts the agent's claim or an LLM judge.
Small samples stay "inconclusive." No false certainty.

**5/**
Privacy is structural, not a policy:
• content-free model — no message text, tool output, or raw input
• credential tables never queried; auth files never opened
• read-only, tested byte-for-byte
• zero network calls during analysis
• one runtime dependency

**6/ (CTA)**
Open-source (Apache-2.0), TypeScript/Node, 201 tests.

Try it without importing personal data:
`caliper demo`

⭐ github.com/vouion/caliper

Feedback welcome — what's the most expensive failure mode your agent has?

---

## Notes
- Post the GIF natively (don't link it); native video/GIF gets more reach.
- Optional: a follow-up reply linking the Show HN post once live.
- Avoid mass-tagging; 1–2 relevant community accounts max, only if genuine.
