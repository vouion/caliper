# Distribution plan

How Caliper gets from "public repo" to "used by real developers." Sequenced by
leverage and effort. Items marked **[founder]** need your action or explicit
authorization (account credentials, posting publicly, irreversible external
actions). Everything else is prepared and ready in this repo.

Honest framing: a pre-1.0 local CLI rarely hits 10k stars. A realistic first
launch is a few hundred stars, meaningful npm installs, and a handful of real
users filing issues. The durable value is a polished, shipped open-source
project with evidence of use — that is the resume goal, and it is achievable.

## Channels, ranked by leverage

| # | Channel | Why it matters | Status |
|---|---|---|---|
| 1 | **npm registry** (`@vouion/caliper`) | The install path most devs expect; `npm i -g` frictionless | Ready; **[founder]** 2FA blocks publish |
| 2 | **GitHub release + social preview** | Share card when the repo is linked anywhere; release = installable tarball | v0.3.0 live; v0.4.0 prep below; social preview pending |
| 3 | **Show HN** | Single highest-leverage post for a dev tool; front page = thousands of visits | Copy ready (`launch/show-hn.md`); **[founder]** posts |
| 4 | **X / Twitter thread** | Visual demo GIF travels well; tags reach the AI-coding community | Copy ready (`launch/x-thread.md`); **[founder]** posts |
| 5 | **Reddit** (r/programming, r/commandline, r/LocalLLaMA, r/ClaudeAI, r/ChatGPTCoding) | Targeted communities that already feel the pain | Copy ready (`launch/reddit.md`); **[founder]** posts; check each sub's self-promo rules |
| 6 | **dev.to / Hashnode article** | Long-tail search traffic; tells the engineering story | Outline ready (`launch/article.md`) |
| 7 | **awesome-list PRs** | Evergreen referral traffic from curated lists | Targets listed below; verify each list's rules before PR |
| 8 | **asciinema.org** | Embeddable interactive player; the `.cast` is already produced | `assets/demo.cast` ready; **[founder]** upload (account) |
| 9 | **Product Hunt** | Optional; dev tools can do well but needs a hunter + gallery | Deferred until npm + GitHub are solid |
| 10 | **Homebrew / AUR / nix** | Frictionless install for macOS/Arch/Nix users | After npm; formula scaffolds can be prepared |

## Sequence

### Phase 0 — Prerequisites (founder-gated)
1. **[founder]** npm 2FA: supply a one-time code or a granular token with publish
   rights. Then `npm publish --access public` ships `@vouion/caliper`.
2. Cut **v0.4.0** (includes `caliper prompt` + demo GIF + hero). The v0.3.0
   GitHub asset predates the prompt feature; npm and GitHub must agree on what
   "0.3.0" contains, so the prompt feature ships as a new minor. See
   "Release checklist" below.
3. Set the **GitHub social preview** to `assets/social-preview.png`
   (Settings → General → Social preview). This is the share card.

### Phase 1 — Owned assets (done / in repo)
- README hero (`assets/social-preview.png`) and animated demo (`assets/demo.gif`,
  real output, 4 scenes) — **done**.
- Playable asciinema cast (`assets/demo.cast`) — **done**.
- This plan + ready-to-post launch copy (`docs/launch/`) — **done**.
- Topics + description on the repo — **done**.

### Phase 2 — Launch (founder posts, coordinated)
Pick one weekday (Tue–Thu), US morning (~08:00–10:00 PT) for Show HN.
1. Publish npm + v0.4.0 release first so install instructions work.
2. Post **Show HN** (`launch/show-hn.md`); founder stays online to answer
   comments for the first 2–3 hours (engagement drives ranking).
3. Same day: **X thread** with the demo GIF (`launch/x-thread.md`).
4. Next day: **Reddit** posts, spaced, respecting each subreddit's rules
   (`launch/reddit.md`). Do not blast all at once.

### Phase 3 — Long-tail (within 1–2 weeks)
- Publish the **dev.to article** (`launch/article.md`); cross-post to Hashnode.
- Upload the cast to **asciinema.org**; link the player from the README.
- Open **awesome-list PRs** (verify rules first):
  - `agarrharr/awesome-cli-apps` (CLI tools)
  - `mehdihadeli/awesome-devtools` or `goabstract/awesome-devtools` (verify current maintainer)
  - LLM/agent lists (e.g. `Hannibal046/Awesome-LLM`, `e2b-dev/awesome-ai-agents`) — verify scope fit
  - OpenCode/Claude-Code community lists if they exist
  Each PR: one line, correct category, link + short description, follow the
  list's CONTRIBUTING exactly. These are **[founder]** external submissions.

### Phase 4 — Packaging (after traction)
- Homebrew tap (`homebrew-caliper`), AUR package, nix flake. Prepare scaffolds
  once npm install is proven; these widen the install funnel.

## Release checklist (v0.4.0)
- [ ] Bump `package.json` + `src/version.ts` + lockfile to 0.4.0
- [ ] `npm run typecheck` clean; full `npm test` green; `npm run build`
- [ ] `npm pack` → install smoke test of the tarball
- [ ] Move CHANGELOG `[Unreleased]` → `0.4.0`
- [ ] Tag `v0.4.0`; GitHub release with notes + tarball asset
- [ ] **[founder]** `npm publish --access public` (2FA)
- [ ] Update README install section to the live npm name; remove "pending"
- [ ] Set social preview

## What I can do autonomously vs. what needs you
**Autonomous (reversible, in-repo):** version bump, build/test, release notes,
CHANGELOG, demo/launch assets, Homebrew/AUR scaffolds, GitHub release via `gh`
(repo is yours and public; this is the stated distribution goal).

**[founder] required:** npm publish (2FA), posting to Show HN / Reddit / X /
dev.to / Product Hunt, awesome-list PRs, asciinema.org upload, any paid or
irreversible external action. Launch copy is drafted; you approve and post.

## Metrics (check ~1 week post-launch)
- GitHub: stars, forks, traffic (views/clones), referrers (Insights → Traffic).
- npm: weekly downloads (`npmjs.com/package/@vouion/caliper`).
- Issues/PRs from real users (the strongest signal of actual use).
- Which channel drove installs (ask in issues / check referrers).

## Risks / honesty
- **Crowded space.** Session observation is saturated; lead with the
  *diagnostics + verified experiments + zero-LLM privacy* angle, not "another
  usage dashboard." The competitive doc already states where rivals beat us.
- **Pre-1.0.** Set expectations: schema/CLI may change; Codex/Claude live
  execution is gated/unverified. Do not overclaim in launch copy.
- **No fabrication.** Launch copy uses only real, measured capabilities. No
  invented users, metrics, or testimonials.
