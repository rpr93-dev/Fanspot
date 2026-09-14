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
│   ├── standings/              # Not used (league routes below)
│   ├── search/                 # Search page
│   ├── news/                   # Global news feed
│   ├── favorites/              # Saved teams
│   ├── [sport]/
│   │   ├── page.tsx            # League overview — team grid
│   │   └── [team]/
│   │       ├── page.tsx        # Team dashboard
│   │       └── [eventId]/      # Game detail page
│   │   └── player/
│   │       └── [playerId]/     # Player profile page
│   ├── api/
│   │   ├── roster/route.ts     # Roster + per-player season stats
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
│   └── BiggestStories.tsx      # Top news cards
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
| `/[sport]/[team]/[eventId]` | Game detail with play-by-play |
| `/[sport]/player/[playerId]` | Player profile |
| `/standings/[sport]` | League standings |
| `/stat-leaders/[sport]` | Top performers |
| `/search` | Player and team search |
| `/news` | Global news feed |
| `/favorites` | Saved teams |

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

## API Endpoints

| Route | Description |
|---|---|
| `GET /api/schedule?sport=NFL&team=NE` | Upcoming & recent games |
| `GET /api/schedule?sport=NBA_SUMMER&team=BOS&source=scoreboard&dates=20260701-20260731` | Summer League scoreboard |
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
