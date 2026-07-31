export const SUPPORTED_SPORTS = ['nfl', 'nba', 'mlb', 'nhl'] as const

/**
 * Sports the unified pipeline actually has data for. Everything else falls through
 * to NFL upstream, so those sports are gated off rather than served mislabeled data.
 */
export const FANTASY_LIVE_SPORTS = ['nfl'] as const

export function isFantasySportLive(sport: string): boolean {
  return (FANTASY_LIVE_SPORTS as readonly string[]).includes(sport)
}

export const ESPN_FANTASY_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games'

export const SLEEPER_BASE = 'https://api.sleeper.app/v1'

export const SLEEPER_PLAYERS_TTL_MS = 24 * 60 * 60 * 1000

export const SCORING_FORMATS = ['standard', 'ppr', 'half-ppr', 'category', 'points', 'roto', 'h2h-points'] as const
