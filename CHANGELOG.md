# Changelog

## Session — 2026-07-31

Three features plus a codebase audit. Every entry below is its own commit and can be
reverted independently with `git revert <sha>` without disturbing the others.

Baseline for this session: `53938f5` — a snapshot commit of the previously uncommitted
fantasy pipeline / steals board / injury gate work, so this session's changes are
separable from it. To discard **everything** from this session: `git reset --hard 53938f5`.

| # | Commit | Scope |
|---|--------|-------|
| 0 | `53938f5` | baseline snapshot (pre-existing work, not authored this session) |
| 1 | `1c8101c` | Feature 1 — team dashboard starters |
| 2 | `b204bc1` | Feature 2 — team-colour theming on the Steals board |
| 3 | `fcb035d` | Feature 3 — Biggest Stories tab |
| 4 | `1b67b62` | tests for features 1–3 + vitest config fix |
| 5 | `54f4aea` | audit fixes |

---

## 1. Fantasy Outlook shows the real QB1/RB1/WR1/TE1 — `1c8101c`

**What changed.** The Fantasy Outlook panel on each team dashboard used to show the
league-wide top three steals — the same three players on all 32 team pages, mostly not
even on that team. It now shows that team's actual starter at each of QB/RB/WR/TE.

**Why.** The panel was labelled as a team outlook but its content had nothing to do with
the team you were looking at.

**How the starter is chosen.** Not roster order. A composite of, in order of weight:
Sleeper `depth_chart_order` (the only direct statement of who starts), ESPN
`percentStarted` (the market's read on the same question), and projected points as a
tiebreak only — a projection ranks production, not the job. When the top two candidates
are within `UNSETTLED_MARGIN` the panel says so by name ("No clear quarterback job —
Drew Allar and Mason Rudolph are separated by too little to call one the starter")
instead of presenting a coin-flip as settled. Verified live: PIT correctly reports an
unsettled QB job, KC/NYG/WAS/CLE all report settled starters.

**Outlook text** reuses the existing `buildOutlook()` rather than a second generator, via
a new `buildPlayerOutlook(player, allPlayers)` that assembles the same confidence /
ADP-discount / league-winner inputs the steals board uses. The two surfaces therefore
cannot disagree about a player.

**Bug fixed while in there** (called out in the brief): `buildOutlook()` hardcoded
"Missed 2024 season" regardless of which season was actually missed. It now reads
`seasonActualsYear` from the pipeline, and says "the most recent season" when the
pipeline reports no year rather than inventing one.

**Files**
- `src/lib/fantasy/team-starters.ts` (new) — starter selection
- `src/lib/fantasy/steal-engine.ts` — `buildOutlook` exported + takes an options object; new `buildPlayerOutlook`
- `src/app/api/fantasy/team-outlook/[sport]/[team]/route.ts` (new)
- `src/components/FantasyWidget.tsx` — rewritten

**Revert:** `git revert 1c8101c`. Note this also reverts the season-year fix.

---

## 2. Steals board inherits team colours from the entry point — `b204bc1`

**What changed.** Clicking a player in the Fantasy Outlook panel opens the Steals board
on that player's position tab, filtered to that team, with the row highlighted, expanded
and scrolled into view — and the board reskinned to that team's colours. Opening
`/fantasy/nfl` directly keeps the neutral turf-green palette.

**Colour source.** Reused the existing map in `src/data/teams.ts` (all 124 teams already
had `colors.primary` / `colors.secondary`). No new colour map was created.

**Implementation.** Three CSS custom properties — `--accent`, `--accent-soft`,
`--accent-glow` — declared on `.board` with the neutral values as defaults and overridden
inline from a `?theme=<team>` param. No per-team stylesheets. Every chrome usage of
`--turf` (eyebrow, active tab, focus ring, open-row border, detail panel border, link
hover, position tag, load-more hover, CTA button) was switched to `--accent`.

**What is deliberately NOT themed.** `--turf` and `--red` still drive `.field .bar.pos` /
`.bar.neg` and the `+N` / `-N` gap figure. Those encode value vs. reach and must mean the
same thing on every team's board. This is asserted by a test that fails if `themeVars()`
ever emits `--turf` or `--red`.

**Contrast.** Raw brand hexes are unusable on the `#0B0F0D` board — Giants navy
(`#0B2265`, luminance 0.02) is invisible and near-white secondaries glare. Colours are
shifted in **HSL lightness** into a 0.18–0.75 luminance band. An earlier attempt mixed
toward white, which lifted the luminance but desaturated Giants navy into grey
(`#7986ab`); the HSL version yields a real Giants blue (`#4771eb`). A test asserts every
one of the 248 team colours in `teams.ts` lands inside the band.

An unknown or missing `?theme=` returns `null` and the board stays neutral, rather than
falling back to an arbitrary team. Cross-league codes don't leak (asking for `LAL` on an
NFL board resolves to nothing).

**Files**
- `src/lib/fantasy/team-theme.ts` (new)
- `src/app/fantasy/[sport]/page.tsx` — `?pos=` / `?player=` / `?theme=` handling, target row, banner
- `src/app/fantasy/[sport]/steals.module.css` — accent tokens, `.row.target`, `.targetTag`, `.teamBanner`

**Revert:** `git revert b204bc1`. Chrome returns to turf green; deep links degrade to a
plain `/fantasy/nfl?team=X` which still works.

---

## 3. Home page "Biggest Stories" tab — `fcb035d`

**What changed.** The home page now has Leagues / Biggest Stories tabs. The stories tab
aggregates news across NFL, NBA, NHL and MLB, ranked by significance rather than
recency, with per-league filter chips.

**Ingestion.** Google News RSS, same mechanism as `news-momentum.ts`, but as its own
fetch job: 4 queries × 12 items × 4 leagues. It does **not** reuse the per-player
top-10 cap, which is the wrong shape for cross-league coverage. 30-minute in-process
cache; CDN `s-maxage=1800, stale-while-revalidate=7200`. An all-empty result is treated
as an upstream outage and is deliberately not cached.

**Ranking** (deterministic, no LLM) — `scoreStory()`:
- **Event type**, strongest match only: trade 34, major injury 30, signing 28,
  retirement 26, coaching change 22, suspension 20, roster move 16, milestone 14,
  draft 12. Only the strongest counts — summing every keyword let a roundup article
  that merely lists transactions outrank the transactions themselves.
- **Star recognition** +26, from a per-league top-20 name list, matched against the
  **headline only** (matching the summary let "Cavs sign Hezonja after missing out on
  LeBron" score as a LeBron story).
- **Team name** +8, derived from `teams.ts` rather than a new list.
- **Source prominence** +12/+9/+6 by outlet tier.
- **Recency**, capped at +10, explicitly a tiebreaker — a week-old star trade outranks a
  fresh minor move. There is a test for exactly this.
- **Speculation** cuts the score to 35%: rumours, "proposed trade", "trade machine",
  mock drafts, rankings, "best fits". Confirmed-action language ("officially",
  "has signed", "agreed to") suppresses the penalty. Before this, "NBA Trade Machine
  Rankings" and "Analyst's Bizarre Trade Proposal" were sitting in the top 5.

Each row shows the drivers that scored ("why: signing · LeBron James") so the ranking is
inspectable rather than a black-box number.

**Design.** Uses the existing tokens (Barlow Condensed headlines, IBM Plex Mono metadata).
Neutral — no team colouring here, per the brief. The shared font instances were extracted
to `src/app/fonts.ts` so the home page and the fantasy layout declare them once.

**Also fixed:** Google's RSS description for search feeds is just the linked headline plus
the publisher, so every card was showing its own title twice with undecoded `&nbsp;`.
Snippets that merely restate the headline are now dropped, and entities are decoded. The
publisher-suffix strip also had an unescaped regex (`NHL.com` treated `.` as a wildcard).

**Files**
- `src/lib/news/story-ranking.ts` (new) — scoring, dedupe, ranking
- `src/lib/news/top-stories.ts` (new) — fetch job + cache
- `src/app/api/top-stories/route.ts` (new)
- `src/components/BiggestStories.tsx`, `src/components/HomeTabs.tsx` (new)
- `src/app/page.tsx` — now renders `HomeTabs`
- `src/app/fonts.ts` (new), `src/app/fantasy/layout.tsx` — shared fonts

**Known limitation (not fixed).** The star list is a hand-maintained relevance lexicon,
not a data feed. It only affects ordering and is never displayed as fact, but it will go
stale — a missing name costs a story rank rather than hiding it. Deriving it from data is
possible for the NFL (the unified DB has ownership) but there is no equivalent source
wired up for NBA/NHL/MLB, so a curated list was the honest option. Flagged rather than
faked.

**Revert:** `git revert fcb035d`. The home page returns to the plain league grid.

---

## 4. Tests — `1b67b62`

66 unit tests pass. New coverage, at the same level as the existing steal-engine/
unified-db tests:

- `src/lib/fantasy/__tests__/team-starters.test.ts` (8) — depth chart beats list order;
  a higher projection does not override the depth chart; start-rate fallback when no
  depth chart exists; competition detection; settled jobs not falsely flagged; empty
  position reported rather than borrowing from another; other teams and inactive players
  excluded.
- `src/lib/fantasy/__tests__/team-theme.test.ts` (12) — unknown/missing code stays
  neutral; no cross-league matching; every team colour in the data set lands in the
  legible band; Giants navy stays blue; **`themeVars()` never emits `--turf`/`--red`**.
- `src/lib/fantasy/__tests__/steal-engine-outlook.test.ts` (6) — the season-year fix,
  including that it stays vague rather than inventing a year.
- `src/lib/news/__tests__/story-ranking.test.ts` (12) — star trade outranks bottom-roster
  move; strongest-event-only; speculation discount and its confirmed-action exception;
  headline-only star matching; **old big news outranks fresh minor news**; all four
  leagues; dedupe.

**Also fixed:** `vitest.config.ts` had no `exclude`, so vitest was collecting Playwright's
`*.e2e.test.ts` files and `npm run test` failed on 4 files it should never have loaded.

**Revert:** `git revert 1b67b62` (also reverts the vitest config fix).

---

## 5. Audit fixes — `54f4aea`

Only changes that were verified by reading the code and were one-line and obviously safe.

| File | Problem | Fix |
|---|---|---|
| `src/app/api/wigolo/route.ts` | The content-enrichment guard read `if (!a.url \|\| a.url === '#' \|\| a.url.startsWith('http'))` — inverted on the first two clauses, so it fetched precisely the URLs it was meant to skip, including `fetch('')` which resolves against the server's own origin. | `if (a.url && a.url !== '#' && a.url.startsWith('http'))` |
| `src/lib/cache/cacheService.ts` | `swr()` background revalidation used `.catch(() => {})`, so a permanently failing upstream served stale data forever with no trace. | Log a warning. Behaviour otherwise unchanged — swallowing is correct for background SWR. |
| `src/lib/services/aiService.ts` | Ollama host hardcoded as a tailnet IP. | Overridable via `OLLAMA_BASE_URL`. **The existing address is kept as the default** so the concierge keeps working — moving it to `.env.local` is left to you. |

### Verified as NOT problems

An automated scan flagged missing input validation on `/api/schedule`, `/api/standings`,
`/api/odds` and `/api/roster` (sport, season, eventId, team params). I probed all four
with traversal, quote-injection and unknown-sport payloads and **every one returned 400**.
These routes validate correctly; the finding was wrong and nothing was changed.

### Suggestions — logged, not acted on

Out of scope for this session; listed so they aren't lost.

1. **Client fetches without timeouts** — `src/app/[sport]/[team]/page.tsx` lines 215, 236,
   277, 315, 360 call `fetch()` with no `AbortSignal.timeout()`, so a hung upstream leaves
   the panel spinning forever. The fantasy pages all set timeouts. Five one-line changes,
   but in a file outside this session's scope.
2. **`AGENTS.md` documents a mock-data fallback that does not exist** — it references
   `src/data/mock-data.ts` "used when ESPN returns no data". There is no such file and no
   reference to it anywhere in `src/`. Either the fallback was removed and the docs
   weren't, or it was never built. Worth correcting, since it currently implies a safety
   net that isn't there.
3. **`AGENTS.md` is stale on the fantasy pipeline** — it still describes
   `src/lib/providers/fantasy.ts` / `sleeper.ts` and `/api/fantasy/sleeper-players` as the
   live path, which the unified pipeline replaced.
4. **Dead code from the pipeline migration** — `src/lib/providers/fantasy.ts`,
   `src/lib/providers/sleeper.ts` and `src/app/api/fantasy/sleeper-players/` appear to be
   superseded by `src/lib/fantasy/unified-db.ts`. Deleting them is a larger change that
   needs a reference sweep first, so it was left alone.
5. **Empty schedule vs. failed fetch are indistinguishable** —
   `src/lib/providers/index.ts` ~172–181 returns `{ upcoming: null, lastFive: [] }` when
   ESPN fails and no fallback exists, which the dashboard renders identically to "no games
   scheduled". Same class of problem as the ones already fixed in the fantasy pipeline, but
   fixing it properly means changing the provider return contract and every consumer.
6. **`K` and `D/ST` carry a `0.01` position multiplier** in `steal-engine.ts` — still
   unconfirmed whether that's an intentional de-weighting or a bug. Carried over from the
   earlier brief.
7. **No rate limiting on any API route.** Fine for local use; a real concern if this is
   ever deployed publicly, since several routes trigger outbound fetches.
8. **`buildOutlook` still can't distinguish "injured" from "out for the season"** now that
   the injury gate has proper tiers — it takes a boolean. Passing the tier through would
   make the team-page outlook as precise as the steals board note.
