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
| 6 | `1b99854` | this changelog |
| 7 | `195f6ef` | follow-up: deep link to a player not on the board |
| 8 | `d757457` | changelog entry for #7 |
| 9 | `fab1005` | fix: retirement filter was purging active starters (Aaron Rodgers) |
| 10 | `701b8bb` | Feature 4 — team defenses (D/ST) |
| 11 | `5ee06ee` | Feature 5 — auction draft values |

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

---

## 6. Deep link to a player who isn't on the board — `195f6ef`

**Found during final end-to-end testing, not by the audit.** Clicking Pittsburgh's QB1
(Drew Allar) opened the Steals board on `pos=QB&team=PIT` and rendered "Showing 0 of 0
QBs · PIT only / No players match." — with no indication of why.

**Cause, not a bug in the link.** The Steals board only ranks players rostered in at least
1% of leagues. A team's genuine starter can sit below that line, so the two surfaces
disagreed by design and the UI didn't say so. Lowering the threshold would have polluted
the board with undrafted players to paper over the message.

**What changed.** When a deep-linked player isn't in the results, the board names them and
explains the absence — "Drew Allar isn't on the Steals board. The board only ranks players
rostered in at least 1% of leagues, so a listed starter can still be absent — that's a
signal in itself, not a missing record." — with a link to the unfiltered position view.
The player's name rides along in the link as `?name=`, so the message can name them without
an extra lookup.

**Files:** `src/app/fantasy/[sport]/page.tsx`, `src/components/FantasyWidget.tsx`,
`src/app/fantasy/[sport]/steals.module.css` (`.notice`)

**Revert:** `git revert 195f6ef` — returns to the unexplained empty list.

---

## 7. Retirement filter was purging active starters — `fab1005`

**What changed.** The Steelers' Fantasy Outlook named Drew Allar as QB1. Aaron Rodgers is
the starter and the one who actually gets drafted. Rodgers was absent from the pipeline
entirely, so the panel picked the best of what was left.

**Why.** `likelyRetired()` in the Sleeper ingest had a rule
`if (yearsExp >= 18 && age >= 39) return true` that was **not** gated on the player being
teamless, unlike every other rule in the function. Rodgers (21 years, 42) matched it and
was dropped. The function's own doc comment said Rodgers should be kept — the code
contradicted it.

The rule exists for a real reason: Sleeper still lists Ben Roethlisberger at `team: "PIT"`
though he is retired. So the rule could not simply be deleted. `status` is no help —
Sleeper reports `"Active"` for Rodgers, Roethlisberger, Brady, Brees and Newton alike.
`depth_chart_order` is the discriminator: of the 24 players matching `exp>=18 && age>=39`,
only Rodgers (PIT, 1), Flacco (CIN, 2), Josh Johnson (CIN, 3), Nick Folk (ATL, 1) and
Calais Campbell (BAL, 2) hold a depth slot. Roethlisberger, Brady, Brees, Rivers,
Vinatieri and Witten hold none. The rule now additionally requires `depth_chart_order`
to be absent.

**Side effect (intended).** Flacco, Josh Johnson, Nick Folk and Calais Campbell were being
purged by the same rule and are now retained.

**Files:** `src/lib/fantasy/sleeper-master.ts` (`likelyRetired`),
`src/lib/fantasy/__tests__/sleeper-retirement.test.ts` (new, 6 tests)

**Verified.** PIT QB1 → Aaron Rodgers, 218 proj, depth 1, settled. Cross-checked CIN→Burrow,
ATL→Tua, LAR→Stafford, KC→Mahomes, NYG→Dart — all depth 1, all settled.

**Revert:** `git revert fab1005` — Rodgers disappears again and Allar returns as QB1.

---

## 8. Team defenses (D/ST) — `701b8bb`

**What changed.** D/ST is now a draftable position on the Steals board, in the position
tabs, and in each team's Fantasy Outlook panel. All 32 defenses carry projections, ADP and
ownership.

**Why.** Defenses are drafted in every standard league and the board had none — position
counts were WR 1341, RB 665, TE 631, QB 334, K 139, D/ST 0.

**Two separate gates were blocking them.**

1. Sleeper stores defenses as `{ position: 'DEF', first_name: 'Houston', last_name:
   'Texans', team: 'HOU' }` — no `full_name`, no `espn_id`, no age or experience. The
   person-shaped validation in `sleeperToCanonical` requires `full_name`, so all 32 were
   rejected before reaching anything else. A `DEF` branch now handles them ahead of the
   person checks and the retirement heuristic, both of which are meaningless for a unit.
2. Once past that, defenses still had `proj=0, adp=999` because the ESPN join never fired.
   `buildMasterPlayerList` indexed on `espnId != null && espnId > 0`, and ESPN gives every
   defense a **negative** id: `-16000 - proTeamId` (Falcons proTeamId 1 → `-16001`). The
   guard now rejects only `0`/absent.

The negative id is derived rather than name-matched because the two systems never agree on
the name — "Pittsburgh Steelers" vs "Steelers D/ST" — and fuzzy matching would mispair
defenses.

**Starter selection.** A team fields exactly one defense, so there is no starter to choose.
`buildTeamStarters` returns it with a new `sole-unit` evidence type, `contender: null` and
`unsettled: false`, rather than running the usual scoring and inventing a competitor.

**Files:** `src/lib/fantasy/sleeper-master.ts` (DEF branch, `espnDstId`, index guard),
`src/lib/fantasy/validation.ts` (same guard), `src/lib/fantasy/steal-engine.ts`
(`BOARD_POSITIONS`), `src/lib/fantasy/team-starters.ts` (`STARTER_POSITIONS`,
`sole-unit`), `src/app/fantasy/[sport]/page.tsx` (`POSITIONS`),
`src/components/FantasyWidget.tsx` (`slotLabel` — a defense has no "1" suffix),
`src/lib/fantasy/__tests__/team-starters.test.ts` (+2 tests)

**Verified.** All 32 D/ST with projections; `/api/fantasy/steals/nfl?pos=D%2FST` returns 30
ranked; PIT outlook shows Pittsburgh Steelers D/ST 94 proj, `evidence=sole-unit`.

**Revert:** `git revert 701b8bb` — defenses vanish from the board and the outlook panel.

---

## 9. Auction draft values — `5ee06ee`

**What changed.** The draft board has a Snake / Auction toggle. Auction mode asks for your
budget, team count and roster size, then prices every player in dollars and compares that
to what the market actually pays.

**How the number is calculated.** Value over replacement, in four steps:

1. **Replacement level** — for each position, the projection of the last player the league
   will actually start, given your team count and the starter slots
   (QB1/RB2/WR3/TE1/K1/DST1 + 1 FLEX). The flex spot is split RB .4 / WR .5 / TE .1,
   reflecting which positions actually get flexed.
2. **VORP** — projection minus that line. Players at or below it earn nothing, because
   they are replaceable for free.
3. **The money** — `budget × teams`, minus `$1 × every roster slot` (every player costs at
   least a dollar). What remains is the discretionary pool, divided by total VORP to get a
   dollars-per-point rate.
4. **Price** — `$1 + VORP × rate`, floored at $1.

**Two corrections applied on top of the raw math**, both reusing stances the codebase
already had rather than inventing new ones:

- Kickers and defenses swing as widely in raw points as skill players, but far less
  predictably. Unweighted, the model bid the top defense to $21 against a $4 market. VORP
  is now scaled by the steals board's existing per-position reliability multipliers, which
  puts K and D/ST back to roughly $1–3.
- A severe injury is *why* a market price collapsed, so injured players ranked as the best
  bargains on the board — Tyreek Hill topped it at a $0.10 market price. Severe/out
  players are now priced but moved to a separate Injury Watch list, matching how the
  Steals board already handles them.

**Market comparison.** ESPN publishes an average winning bid per player but does not state
the budget or team count behind it, so the whole published set is treated as a distribution
and rescaled by your league's total money rather than assuming a format. Where ESPN
publishes nothing, `market` and `surplus` are `null` and render as `—` rather than `$0`.

**These are modelled figures, not quoted prices.** The assumptions — team count, budget,
roster size, dollars-per-point, replacement level per position — are returned by the API
in `assumptions` and stated in the UI, so the numbers are legible as a model.

**Files:** `src/lib/fantasy/auction-engine.ts` (new, pure),
`src/app/api/fantasy/auction/[sport]/route.ts` (new),
`src/app/fantasy/[sport]/AuctionBoard.tsx` (new),
`src/app/fantasy/[sport]/page.tsx` (mode toggle, mode-aware heading/footer),
`src/app/fantasy/[sport]/steals.module.css` (auction styles),
`src/lib/fantasy/__tests__/auction-engine.test.ts` (new, 16 tests)

**Known limitations / judgement calls.**
- Default starter slots are hardcoded QB1/RB2/WR3/TE1/K1/DST1/FLEX1. Only budget, teams
  and roster size are user-settable; a league with 2 QBs or 2 flexes will be mispriced.
- The flex split (RB .4 / WR .5 / TE .1) is a judgement call, not derived from data.
- Keeper/dynasty costs, positional inflation as a draft progresses, and your own roster
  needs mid-draft are all out of scope. This prices a full pool at the start.

**Revert:** `git revert 5ee06ee` — the toggle disappears and the board is snake-only. The
three new files are self-contained; nothing in snake mode depends on them.

---

## Suggestions from this round — logged, not acted on

9. Snake mode still issues its `/api/fantasy/steals` fetch while Auction mode is displayed
   (one wasted request per view). Gating the effect on `mode` was left alone to avoid
   touching working snake logic.
10. `AGENTS.md` describes the auction section as not yet built ("Auction: values converted
    to valuePerDollar…" under steal math) — that section now describes only part of the
    picture and should be updated alongside the fantasy-pipeline staleness already noted
    in suggestion 3.
