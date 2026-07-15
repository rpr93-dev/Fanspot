# Fanspot — Multi-Sport Team Dashboard

Track NFL, NBA, NHL, and MLB teams with live schedules, standings, odds, and news.

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
│   │   ├── TeamCard.tsx        # Team card with logo fallback
│   │   └── [team]/
│   │       ├── page.tsx        # Team dashboard (main app)
│   │       ├── error.tsx       # Error boundary
│   │       └── loading.tsx     # Loading skeleton
│   ├── api/
│   │   ├── schedule/route.ts   # ESPN schedule proxy
│   │   ├── standings/route.ts  # ESPN standings proxy
│   │   ├── odds/route.ts       # Moneyline odds extraction
│   │   └── news-search/route.ts# Google News RSS aggregation
│   ├── robots.ts / sitemap.ts  # SEO
│   └── globals.css             # Single tailwind import
├── data/
│   └── teams.ts                # 124 teams across 4 leagues
└── lib/
    ├── sports-api.ts           # Public API — types + entry point
    ├── schedule-types.ts       # Schedule validation
    └── providers/
        ├── index.ts            # Provider orchestrator (ESPN + fallbacks)
        ├── espn.ts             # ESPN schedule/news fetcher
        ├── mlb.ts              # MLB-specific fallback
        └── nhl.ts              # NHL-specific fallback
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

## Team Dashboard Layout

- **Top row**: Next game (with win-probability bar if odds available) + team logo
- **Middle**: Last 5 games (tile grid)
- **Bottom row**: Standings (team's conference by default, toggle all) + latest news

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `STANDINGS_REVALIDATE` | `300` | ISR cache seconds for standings API |

## Data Sources

- **Schedules**: ESPN team schedule API
- **Standings**: ESPN v2 standings API (with scoreboard fallback)
- **Odds**: ESPN scoreboard embedded sportsbook data (vig-normalized)
- **News**: Google News RSS (scored, deduplicated, 7-day filter)
