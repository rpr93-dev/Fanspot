export const SUPPORTED_SPORTS = ['nfl', 'nba', 'mlb', 'nhl'] as const

/**
 * Sports with a real fantasy data pipeline. NFL runs the Sleeper-master unified DB; NBA
 * runs its own ESPN-master pipeline (`src/lib/fantasy/nba/`). Everything else is gated
 * off rather than served mislabeled data.
 */
export const FANTASY_LIVE_SPORTS = ['nfl', 'nba'] as const

/** Live sports whose mock-draft / auction-draft rooms are still NFL-only. */
export const FANTASY_DRAFT_ROOM_SPORTS = ['nfl'] as const

export function hasFantasyDraftRoom(sport: string): boolean {
  return (FANTASY_DRAFT_ROOM_SPORTS as readonly string[]).includes(sport)
}

export function isFantasySportLive(sport: string): boolean {
  return (FANTASY_LIVE_SPORTS as readonly string[]).includes(sport)
}

export const ESPN_FANTASY_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games'

export const SLEEPER_BASE = 'https://api.sleeper.app/v1'

export const SLEEPER_PLAYERS_TTL_MS = 24 * 60 * 60 * 1000

export const SCORING_FORMATS = ['standard', 'ppr', 'half-ppr', 'category', 'points', 'roto', 'h2h-points'] as const
