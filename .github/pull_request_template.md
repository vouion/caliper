## What & why

Describe the change and the problem it solves. Link any related issue.

## Checklist

- [ ] Read `AGENTS.md` invariants; change respects privacy / read-only / evidence-before-claims / no-silent-network.
- [ ] `npm test` passes (full suite); `npm run typecheck` clean.
- [ ] Added/updated tests: rules have positive + negative boundary tests; adapters use synthetic fixtures; privacy-sensitive changes extend sentinel suites.
- [ ] No user conversation text, tool output, raw input, or credentials added to model/reports/cache/registry.
- [ ] Docs updated if behavior changed (README capability table, ARCHITECTURE, ROADMAP status match reality).
- [ ] No new runtime dependency without justification (prefer Node built-ins).

## Notes for reviewers

Anything subtle: trade-offs, unverified assumptions, follow-ups.
