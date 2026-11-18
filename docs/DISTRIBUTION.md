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
| 1 | **npm registry** (`@vouion/caliper`) | The install path most devs expect; `npm i -g` frictionless | ✅ **Live:** `@vouion/caliper@0.4.2` |
| 2 | **GitHub release + social preview** | Share card when the repo is linked anywhere; release = installable tarball | v0.4.2 live (latest); social preview pending |
| 3 | **Show HN** | Single highest-leverage post for a dev tool; front page = thousands of visits | Copy ready (`launch/show-hn.md`); **[founder]** posts |
| 4 | **X / Twitter thread** | Visual demo GIF travels well; tags reach the AI-coding community | Copy ready (`launch/x-thread.md`); **[founder]** posts |
| 5 | **Reddit** (r/programming, r/commandline, r/LocalLLaMA, r/ClaudeAI, r/ChatGPTCoding) | Targeted communities that already feel the pain | Copy ready (`launch/reddit.md`); **[founder]** posts; check each sub's self-promo rules |
| 6 | **dev.to / Hashnode article** | Long-tail search traffic; tells the engineering story | Outline ready (`launch/article.md`) |
| 7 | **awesome-list PRs** | Evergreen referral traffic from curated lists | Targets listed below; verify each list's rules before PR |
| 8 | **asciinema.org** | Embeddable interactive player; the `.cast` is already produced | `assets/demo.cast` ready; **[founder]** upload (account) |
| 9 | **Product Hunt** | Optional; dev tools can do well but needs a hunter + gallery | Deferred until npm + GitHub are solid |
| 10 | **Homebrew / AUR / nix** | Frictionless install for macOS/Arch/Nix users | After npm; formula scaffolds can be prepared |

## Sequence

### Phase 0 — Prerequisites
1. ✅ **Done:** npm published — `@vouion/caliper@0.4.2` is live (`npm install -g @vouion/caliper`).
2. ✅ **Done:** GitHub releases cut through **v0.4.2** (prompt feature + demo GIF
   + hero in 0.4.0; Node 22/24 `node --test` compatibility in 0.4.1; reliable
   acceptance-check output capture in 0.4.2). CI is green on the required ubuntu
   matrix (Node 22 + 24); macOS x64 Node 22/24 verified when runners were available.
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
1. ✅ npm + GitHub release v0.4.2 are live — install instructions work.
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

## Release checklist (latest: v0.4.2)
- [x] Bump `package.json` + `src/version.ts` + lockfile
- [x] `npm run typecheck` clean; full `npm test` green (202, Node 22 + 26); `npm run build`
- [x] `npm pack` → install smoke test of the tarball
- [x] CHANGELOG updated per release
- [x] Tag + GitHub release with notes + tarball asset (v0.4.0 / v0.4.1 / v0.4.2)
- [x] **[founder]** `npm publish --access public` — `@vouion/caliper@0.4.2` live
- [x] Update README install section to the live npm name; remove "pending"
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
