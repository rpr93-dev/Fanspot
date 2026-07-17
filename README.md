# Fanspot — Multi-Sport Team Dashboard

Track NFL, NBA, NHL, and MLB teams with live schedules, standings, odds, news, box scores, and roster stats.

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
│   │       ├── page.tsx        # Team dashboard (main app)
│   │       ├── error.tsx       # Error boundary
│   │       └── loading.tsx     # Loading skeleton
│   ├── api/
│   │   ├── roster/route.ts     # Roster + per-player season stats
│   │   ├── box-score/route.ts  # Box score with per-sport extraction
│   │   ├── schedule/route.ts   # ESPN schedule proxy
│   │   ├── standings/route.ts  # ESPN standings proxy
│   │   ├── odds/route.ts       # Moneyline odds extraction
│   │   └── news-search/route.ts# Google News RSS aggregation
│   ├── robots.ts / sitemap.ts  # SEO
│   └── globals.css             # Tailwind import + custom scrollbar
├── data/
│   └── teams.ts                # 124 teams across 4 leagues
└── lib/
    ├── sports-api.ts           # Public API — types + entry point
    ├── schedule-types.ts       # Schedule validation
    └── providers/
        ├── index.ts            # Provider orchestrator (ESPN + fallbacks)
        └── espn.ts             # ESPN fetcher
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

The team dashboard at `/[sport]/[team]` has four panels:

- **Logo card** (top-left) — team colors, nickname. Hover reveals click hint; click opens roster.
- **Next game** (top-right) — opponent, time, win-probability bar (when odds available).
- **Last 5 games** (bottom-left) — W/L indicators with hover lift effect; click opens box score.
- **News** (bottom-right) — 4 mock articles (ESPN-sourced when available).

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

Clicking a game in Last 5 opens a box-score overlay showing player and team stats per sport:

- **NFL**: Positional stat pairing from ESPN's flat string arrays
- **NBA**: 14-field stat line, unnamed category fallback
- **NHL**: Multi-value grouping by athlete ID
- **MLB**: Flattened team stats, batter/pitcher category differentiation

## API Endpoints

| Route | Description |
|---|---|
| `GET /api/schedule?sport=NFL&team=NE` | Upcoming & recent games |
| `GET /api/standings?sport=NFL` | Conference standings |
| `GET /api/odds?sport=NFL&team=NE` | Moneyline win probability |
| `GET /api/news-search?name=Patriots` | Aggregated news |
| `GET /api/box-score?sport=NFL&eventId=401671e0` | Player + team stats for a game |
| `GET /api/roster?sport=NFL&team=NE` | Roster with per-player season stats |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `STANDINGS_REVALIDATE` | `300` | ISR cache seconds for standings API |

## Data Sources

- **Schedules / Standings / Odds**: ESPN public v2/v3 API
- **Box scores**: ESPN event summary endpoint
- **Roster stats**: ESPN core athlete statistics API
- **News**: Google News RSS (scored, deduplicated, 7-day filter)
