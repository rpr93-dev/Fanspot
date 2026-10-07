# Fanspot — Multi-Sport Dashboard

Track NFL, NBA, NHL, and MLB teams with live schedules, standings, odds, news, box scores, player profiles, and stat leaders. Includes **NBA Summer League** support.

## Features

- **Global Navigation** — bottom nav bar with Scores, Standings, Search, News, and Favorites
- **Live Game Updates** — real-time polling every 15s with LIVE badge, period/clock, and score updates
- **Player Profiles** — dedicated pages with season stats and play-by-play history
- **Favorites** — save teams and access them from the Favorites tab (persisted via browser storage)
- **Standings** — league-wide standings with conference/division breakdowns and sport-specific layouts
- **Stat Leaders** — top performers across the league by position
- **Multi-Sport Search** — search players, teams, and leagues
- **News Feed** — global news aggregated from ESPN sources
- **PWA** — Add to Home Screen support with custom icons and offline-ready manifest
- **Prop Model (game hub)** — Python pipeline projecting every skill player (recent form × opponent defense × Vegas game script) against sportsbook lines, with over/under picks, confidence badges, a pre-game snapshot ledger, and post-game grading. See [Prop Model](#prop-model) below.
- **Fantasy Outlook** — real QB1/RB1/WR1/TE1 per team (Sleeper depth chart × ESPN start-rate × projections) with injury tiers

## Tech Stack

- **Framework**: Next.js 16 (App Router) + React 19
- **Styling**: Tailwind CSS v4
- **Language**: TypeScript
- **Data**: ESPN free public API (no API key needed)

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout (dark theme, global nav)
│   ├── page.tsx                # Home page — for you / league selection
│   ├── scores/                 # Multi-team scoreboard
│   ├── search/                 # Search page
│   ├── news/                   # Global news feed
│   ├── favorites/              # Saved teams
│   ├── [sport]/
│   │   ├── page.tsx            # League overview — team grid
│   │   ├── [team]/
│   │   │   └── page.tsx        # Team dashboard
│   │   ├── game/
│   │   │   └── [eventId]/      # Game detail page (summary, box, plays, props)
│   │   └── player/
│   │       └── [playerId]/     # Player profile page
│   ├── api/
│   │   ├── roster/route.ts     # Roster + per-player season stats
│   │   ├── props/route.ts      # Player projections (all sports) + Odds API prop lines
│   │   ├── box-score/route.ts  # Box score with per-sport extraction
│   │   ├── schedule/route.ts   # ESPN schedule proxy
│   │   ├── standings/route.ts  # ESPN standings proxy
│   │   ├── standings-league/route.ts  # Full league standings
│   │   ├── odds/route.ts       # Moneyline win probability
│   │   ├── news-search/route.ts# Google News RSS aggregation
│   │   ├── top-stories/route.ts# Top sports stories
│   │   ├── player/route.ts     # Player stats lookup
│   │   ├── plays/route.ts      # Play-by-play data
│   │   ├── search/route.ts     # Player/team search
│   │   ├── stat-leaders/route.ts  # Top performers by stat
│   │   └── scoreboard/multi/route.ts  # Multi-team scoreboard
│   ├── robots.ts / sitemap.ts  # SEO
│   └── globals.css             # Tailwind import + custom scrollbar
├── components/
│   ├── GlobalNav.tsx           # Bottom nav bar
│   ├── GlobalScoreboard.tsx    # Scoreboard component
│   ├── NewsFeed.tsx            # News list component
│   ├── SearchResults.tsx       # Search results component
│   ├── StandingsTable.tsx      # Standings grid
│   ├── StatLeaders.tsx         # Top performers
│   ├── FavoriteButton.tsx      # Team favorite toggle
│   ├── home/
│   │   ├── ForYou.tsx          # Home feed
│   │   └── DaySnapshot.tsx     # Today's games
│   ├── game/
│   │   ├── GameHeader.tsx      # Game info header
│   │   ├── PlayByPlay.tsx      # Play timeline
│   │   └── PlayerBoxScore.tsx # Player stats table
│   ├── scoreboard/
│   │   ├── ScoreCard.tsx       # Individual game card
│   │   ├── GameStatusBadge.tsx # Live/pre/post status
│   │   └── TeamIdentity.tsx    # Team colors/nickname
│   ├── NextGamePanel.tsx       # Game preview / model vs live / model vs final
│   └── PlayerProjections.tsx   # NBA/NHL/MLB projection vs book-line table
├── hooks/
│   ├── useLivePoll.ts          # Auto-refresh for live games
│   ├── useFavorites.ts         # Favorites state management
│   └── useSearch.ts            # Search debouncing
├── lib/
│   ├── sports-api.ts           # Public API — types + entry point
│   ├── favorites.ts            # Favorites storage layer
│   ├── standings.ts            # Standings data processing
│   ├── players.ts              # Player stat normalization
│   ├── plays.ts                # Play data parsing
│   └── leaders.ts              # Stat leader calculations
└── data/
    └── teams.ts                # 124 teams across 4 leagues
```

## Routes

| Path | Page |
|---|---|
| `/` | Home — Today's games and for you feed |
| `/scores` | Multi-team scoreboard |
| `/[sport]` | Team grid (nfl / nba / nhl / mlb) |
| `/[sport]/[team]` | Team dashboard |
| `/[sport]/game/[eventId]` | Game detail with play-by-play |
| `/[sport]/player/[playerId]` | Player profile |
| `/search` | Player and team search |
| `/news` | Global news feed |
| `/favorites` | Saved teams |
| `/fantasy` | Fantasy draft prep index |
| `/fantasy/[sport]` | Fantasy steals / auction / mock draft (NFL live, others coming soon) |
| `/graph` | Architecture visualization |

Note: standings and stat leaders are API-only (`/api/standings`, `/api/standings-league`,
`/api/stat-leaders`) and render inside the league hubs and team dashboards — there are
no standalone `/standings/*` or `/stat-leaders/*` pages.

## Team Dashboard

The team dashboard at `/[sport]/[team]` is a mobile-responsive single-page app with:

- **Next Game** (top-left) — opponent, date/time, venue, win-probability bar. Live games show scores, period clock, LIVE badge with pulsing indicator, and auto-refresh.
- **Team Logo** (top-right) — team colors, nickname. Click opens the roster panel.
- **Last 5 Games** (bottom-left) — W/L indicators with hover lift effect; click opens box score.
- **Standings** (bottom-center) — Conference/division standings with your team highlighted.
- **News** (bottom-right) — 4 articles (ESPN-sourced or fallback).

### Live Games

In-progress games are detected automatically. The dashboard polls for live box scores every 15 seconds, showing a LIVE badge with pulsing dot and the current period/clock. Scores update in real time.

### Season Type Badges

| Type | Badge |
|---|---|
| Preseason (`type: 1`) | "Preseason" / "Pre" |
| Regular Season (`type: 2`) | (none) |
| Playoffs (`type: 3`) | "Playoffs" |
| Summer League (`type: 4`) | "Summer League" |
| Spring Training (MLB) | "Preseason" |

### NBA Summer League

Summer League games are fetched from the ESPN `nba-summer` scoreboard endpoint during June–July. The season type is normalized to `Summer League` so it's distinguishable from regular season.

### Roster View

Clicking the logo toggles to a roster panel showing every player grouped by position, sorted by season stat within each group. Each player shows position-relevant stats.

**NFL per-position stat schemas:**

| Position | Stats |
|---|---|
| QB | CMP ATT YD TD INT QBR |
| RB | CAR YD TD REC REC YD |
| WR / TE | REC YD TGT TD |
| DE / DT / NT | SOLO AST SACK TFL |
| LB | SOLO AST SACK TFL QBHIT PD |
| CB / S | SOLO AST INT PD FF |
| K / PK | FGM FGA XPM XPA |
| P | PUNT YD AVG IN20 |
| OL / LS | (no stats) |

**NBA:** PTS AST REB STL BLK MIN FG% 3P% FT% (per-game averages)

**NHL:** G A PTS +/- PIM SOG TOI

**MLB:** AVG HR RBI OBP SLG SB / ERA W L SO BB SV

### Box Score & Play-by-Play

Clicking a game opens a detail page with box score, sport-aware period labels (Q1-Q4 for NBA/NFL, 1st-3rd+OT for NHL, 1st-9th for MLB), and a play-by-play timeline.

## Performance

- **In-memory TTL cache**: Schedule results cached for 2 minutes to avoid redundant ESPN calls
- **Parallel fetching**: Season years, preseason, postseason, and extra-month requests fire concurrently
- **API route caching**: All proxy endpoints use `Cache-Control: public, s-maxage=60-300, stale-while-revalidate`
- **Reduced season depth**: Fetches 1-2 seasons instead of 2-3
- **Unified fantasy DB**: Sleeper master + ESPN enrichment rebuilt at most every 15 min, shared across concurrent callers via single-flight (`buildUnifiedDatabase`)
- **Prop-model result cache**: `/api/prop-model` memoizes identical batches for 10 min (max 100 entries, LRU) with single-flight, so both teams' panels, re-renders, and repeat views share one Python run

## Prop Model

The Odds tab on NFL and NBA game pages runs a Python projection pipeline
(`prop-model/`, invoked via `POST /api/prop-model`) and grades it against
sportsbook lines and the final box score.

**Data flow per game view** (all independent fetches fire in parallel):

1. `GET /api/props` — ESPN-based projected lines per player (used as priors) + Odds API book lines when `ODDS_API_KEY` is set.
2. `GET /api/fantasy/team-outlook/[sport]/[team]` × 2 — both teams' starters (the model lineup).
3. `GET /api/prop-ledger` — saved pre-game snapshot, if the game was viewed before kickoff.
4. `POST /api/prop-model` — Python CLI over the batch; ~0.4–1s warm (2–24 targets).
5. `POST /api/scraper` — DraftKings lines via the Docker scraper (Playwright; tens of seconds, often blocked) — fills in the Line/Pick columns when it answers and is never on the model's critical path.

**Snapshot ledger.** The first pre-game run locks its rows + lines into the ledger
(`recordPreSnapshot`); later views hydrate from the snapshot instead of re-running.
After the final whistle only a locked snapshot is shown/graded — never a fresh run.

### Load fix (Oct 2026) — the model "took forever" because it never started

Symptoms: the Prop Model section showed a spinner indefinitely (or nothing at all),
`team-outlook` returned 500, and `/api/props` returned `projections: []`.

Root cause: one ESPN fantasy row with no `stats` array threw
(`Cannot read properties of undefined (reading 'filter')`) inside
`enrichFromEspn`, failing the whole unified-DB build. With empty projections the
panel's auto-run gate (`ourProjected.length || oppProjected.length`) never opened —
and the section's render condition hid even the manual Run button.

Changes (commit `b6ea476`):

- `src/lib/fantasy/enrichers/espn-enricher.ts` — tolerate missing `stats` (`?? []`,
  typed optional); one bad row can no longer fail the build. Covered by
  `espn-enricher-stats-guard.test.ts` (fails on the old code, passes on the new).
- `src/components/NextGamePanel.tsx` — hydrate from a saved snapshot immediately
  (no other data needed); fresh-run as soon as the lineup is known and `/api/props`
  has *settled* (ESPN priors are optional, emptiness no longer blocks); the section
  renders once the lineup exists, with an actionable error + retry when it doesn't.
- `src/app/api/prop-model/route.ts` — 10-min result cache + single-flight on the
  normalized batch (successes only; client-supplied `weightsJson` stays ignored and
  out of the key).
- `team-outlook` route — logs the server-side cause instead of swallowing it.

Measured on prod after deploy: `team-outlook` 500 → 200 in ~2.7s, `/api/props`
`[]` → real lines in ~0.01s (warm DB), model POST ~0.66s fresh / ~0.003s cached.
Full suite: 528 tests across 47 files, `tsc --noEmit` clean.

### Operating notes

- **Rebuild gotcha**: `prop-model/.venv` breaks Turbopack's file tracer — move it
  aside for `npm run build`, then restore it (`mv prop-model/.venv
  prop-model/.venv.build-hide && npm run build; mv prop-model/.venv.build-hide
  prop-model/.venv`).
- **Deploy**: `npm run build` then restart the pm2 process (`pm2 restart fanspot`);
  `next start` only picks up a new bundle on restart.
- First-ever model run downloads multi-MB league data (answered 503 `warmingUp`,
  retried in background); subsequent runs are fast.

## API Endpoints

| Route | Description |
|---|---|
| `GET /api/schedule?sport=NFL&team=NE` | Upcoming & recent games |
| `GET /api/schedule?sport=NBA_SUMMER&team=BOS&source=scoreboard&dates=20260715` | Summer League scoreboard (single date — ESPN rejects `dates=A-B` ranges) |
| `GET /api/standings?sport=NFL` | Conference standings |
| `GET /api/standings-league?sport=NFL` | Full league standings |
| `GET /api/odds?sport=NFL&team=NE` | Moneyline win probability |
| `GET /api/news-search?name=Patriots` | Aggregated news |
| `GET /api/top-stories` | Top sports stories |
| `GET /api/box-score?sport=NFL&eventId=401671e0` | Player + team stats |
| `GET /api/roster?sport=NFL&team=NE` | Roster with season stats |
| `GET /api/player?name=Patrick Mahomes` | Player stats lookup |
| `GET /api/plays?eventId=401671e0` | Play-by-play data |
| `GET /api/search?q=Patriots` | Player and team search |
| `GET /api/stat-leaders?sport=NFL&stat=passing_yards` | Top performers |
| `GET /api/scoreboard/multi?sport=NFL&teams=NE,BUF` | Multi-team scoreboard |
| `GET /api/props?sport=NFL&team=BUF&opponent=HOU&date=20260913` | Projected + book prop lines (priors for the model) |
| `GET /api/fantasy/team-outlook/nfl/buf` | Team starters + outlook (the model lineup) |
| `POST /api/prop-model` | Run the Python projection pipeline (`{ targets, sport, eventDate, lines, preseason }` → `{ projections }`) |
| `GET /api/prop-ledger?team=BUF&opponent=HOU&eventDate=20260913` | Saved pre-game snapshot + grading |
| `GET /api/prop-grades?sport=NFL` | Graded snapshots across games |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `STANDINGS_REVALIDATE` | `300` | ISR cache seconds for standings API |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama host for the concierge AI analyst |
| `OLLAMA_ANALYST_MODEL` | `qwen3.5:9b` | Model used for AI analysis |
| `SCRAPER_URL` | `http://localhost:8770` | Docker prop-line scraper (required for NFL Props tab; fails gracefully without it) |
| `ODDS_API_KEY` | _(unset)_ | The Odds API key — book prop lines; without it only ESPN projections are served |

## Data Sources

- **Schedules / Standings / Odds**: ESPN public v2/v3 API
- **Box scores**: ESPN event summary endpoint (`/summary?event={id}`)
- **Roster stats**: ESPN core athlete statistics API
- **Summer League**: ESPN `basketball/nba-summer` scoreboard endpoint
- **News**: Google News RSS (scored, deduplicated, 7-day filter)
