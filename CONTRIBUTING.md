# Contributing to Caliper

Thanks for your interest. This project values **correctness, honesty, and privacy** over feature count — please read [`AGENTS.md`](AGENTS.md) (the engineering invariants) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before opening a PR.

## Ground rules

- **Evidence before claims.** Diagnostics need supporting evidence and a confidence level. Never present an observational result as experimentally verified. Don't invent metrics, costs, or improvements.
- **Privacy is architectural.** No user conversation text, tool output, raw tool input, or credentials may enter the normalized model, reports, cache, or registry. If your change touches data flow, extend the sentinel-leak tests.
- **Read-only sources.** Agent session data is opened read-only and never modified. Keep the byte-for-byte immutability tests passing.
- **No silent network.** Analysis is local. Any future network feature must be opt-in, consent-gated, and documented.
- **Smallest complete change.** No speculative abstractions or unrelated refactors. One runtime dependency today (`smol-toml`); prefer Node built-ins.

## Development

```sh
npm install
npm test          # node:test, no framework dependency
npm run typecheck
npm run build
node --experimental-strip-types src/cli.ts audit
```

Requirements: Node.js ≥ 22.13. TypeScript uses erasable-only syntax with `.ts` import extensions; `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on.

## What makes a good contribution

- **New session adapters** (e.g., another coding agent): follow `src/adapters/adapter.ts`, probe the *real installed* schema (don't trust outdated docs), add fixture tests + privacy sentinels, record the verified version.
- **New diagnostic rules**: pure functions of the normalized model, documented thresholds, positive AND negative tests at boundaries, evidence + confidence.
- **Benchmarks** for the experiment engine: deterministic starting state, explicit acceptance checks (prefer a test-file hash anti-cheat check), realistic tasks where the diagnosed pathology actually occurs.
- **Bug fixes**: include a regression test that fails before the fix.

## Tests

Every behavior change needs a test. Adapter changes need synthetic fixtures (never test against real user data). Privacy-sensitive changes must extend the sentinel suites. Run the full suite before submitting; CI runs ubuntu/macos × Node 22/24.

## Reporting security issues

See [`SECURITY.md`](SECURITY.md). Do not open public issues for vulnerabilities; do not include real session data in any report.

## License

By contributing, you agree your contributions are licensed under Apache-2.0.
