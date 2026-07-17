# Fanspot — Multi-Sport Team Dashboard

Track NFL, NBA, NHL, and MLB teams with live schedules, standings, odds, news, box scores, and roster stats. Includes **NBA Summer League** support.

## Tech Stack

- **Framework**: Next.js 16 (App Router) + React 19
- **Styling**: Tailwind CSS v4
- **Language**: TypeScript
- **Data**: ESPN free public API (no API key needed)

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout (dark theme)
│   ├── page.tsx                # Home page — league selection
│   ├── [sport]/
│   │   ├── page.tsx            # League overview — team grid
│   │   └── [team]/
│   │       ├── page.tsx        # Team dashboard (main app, ~1300 lines)
│   │       ├── error.tsx       # Error boundary
│   │       └── loading.tsx     # Loading skeleton
│   ├── api/
│   │   ├── roster/route.ts     # Roster + per-player season stats
│   │   ├── box-score/route.ts  # Box score with per-sport extraction + Summer League fallback
│   │   ├── schedule/route.ts   # ESPN schedule proxy
│   │   ├── standings/route.ts  # ESPN standings proxy
│   │   ├── odds/route.ts       # Moneyline odds extraction with summary endpoint fallback
│   │   └── news-search/route.ts# Google News RSS aggregation
│   ├── robots.ts / sitemap.ts  # SEO
│   └── globals.css             # Tailwind import + custom scrollbar
├── data/
│   └── teams.ts                # 124 teams across 4 leagues
└── lib/
    ├── sports-api.ts           # Public API — types + entry point
    ├── schedule-types.ts       # Schedule validation
    └── providers/
        ├── index.ts            # Provider orchestrator (ESPN + Summer League merge)
        └── espn.ts             # ESPN fetcher with caching + Summer League
```

## Getting Started

```bash
npm install
npm run dev       # → http://localhost:3000
npm run build     # TypeScript check + production build
```

## Routes

| Path | Page |
|---|---|
| `/` | League selection home |
| `/[sport]` | Team grid (nfl / nba / nhl / mlb) |
| `/[sport]/[team]` | Team dashboard |

## Team Dashboard

The team dashboard at `/[sport]/[team]` is a mobile-responsive single-page app with:

- **Next Game** (top-left) — opponent, date/time, venue, win-probability bar (when odds available). Live games show scores, period clock, LIVE badge with pulsing indicator, and auto-refresh. Preseason / Summer League badges appear when applicable.
- **Team Logo** (top-right) — team colors, nickname. Click opens the roster panel.
- **Last 5 Games** (bottom-left) — W/L indicators with hover lift effect; click opens box score. Adapts to 3 columns on mobile.
- **Standings** (bottom-center) — Conference/division standings with your team highlighted.
- **News** (bottom-right) — 4 articles (ESPN-sourced or fallback).

### Live Games

In-progress games are detected automatically. The dashboard polls for live box scores every 15 seconds, showing a LIVE badge with pulsing dot and the current period/clock. Scores update in real time alongside the team abbreviations.

### Season Type Badges

| Type | Badge |
|---|---|
| Preseason (`type: 1`) | "Preseason" / "Pre" |
| Regular Season (`type: 2`) | (none) |
| Playoffs (`type: 3`) | "Playoffs" |
| Summer League (`type: 4`) | "Summer League" |
| Spring Training (MLB) | "Preseason" |

### NBA Summer League

Summer League games are fetched from the ESPN `nba-summer` scoreboard endpoint during June–July. The season type is normalized to `Summer League` so it's distinguishable from regular season. Games appear naturally in the last-5 and next-game slots by date order.

### Roster View

Clicking the logo toggles to a roster panel showing every player grouped by position, sorted by season stat within each group. Each player shows position-relevant stats in a fixed-column layout. Players with no game logs show college / "No stats yet".

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

### Box Score View

Clicking a game in Last 5 opens a box-score overlay with sport-aware period labels (Q1-Q4 for NBA/NFL, 1st-3rd+OT for NHL, 1st-9th for MLB), alternating row colors, and right-aligned stat values for easy scanning. Toggle between team stats and player stats.

### Performance

- **In-memory TTL cache**: Schedule results are cached for 2 minutes to avoid redundant ESPN calls when navigating between teams
- **Parallel fetching**: Season years, preseason, postseason, and extra-month scoreboard requests all fire concurrently
- **API route caching**: All proxy endpoints use `Cache-Control: public, s-maxage=60-300, stale-while-revalidate`
- **Reduced season depth**: Fetches 1-2 seasons instead of 2-3

## API Endpoints

| Route | Description |
|---|---|
| `GET /api/schedule?sport=NFL&team=NE` | Upcoming & recent games |
| `GET /api/schedule?sport=NBA_SUMMER&team=BOS&source=scoreboard&dates=20260701-20260731` | Summer League scoreboard |
| `GET /api/standings?sport=NFL` | Conference standings |
| `GET /api/odds?sport=NFL&team=NE` | Moneyline win probability (falls back to summary endpoint for live games) |
| `GET /api/news-search?name=Patriots` | Aggregated news |
| `GET /api/box-score?sport=NFL&eventId=401671e0` | Player + team stats for a game |
| `GET /api/roster?sport=NFL&team=NE` | Roster with per-player season stats |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `STANDINGS_REVALIDATE` | `300` | ISR cache seconds for standings API |

## Data Sources

- **Schedules / Standings / Odds**: ESPN public v2/v3 API
- **Box scores**: ESPN event summary endpoint (`/summary?event={id}`)
- **Roster stats**: ESPN core athlete statistics API
- **Summer League**: ESPN `basketball/nba-summer` scoreboard endpoint
- **News**: Google News RSS (scored, deduplicated, 7-day filter)
