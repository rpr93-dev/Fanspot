/**
 * Per-sport UI options for the fantasy boards (Steals + Auction). The NFL boards rank
 * within position under PPR-style scoring; the NBA boards rank one league-wide pool
 * under points or 9-cat scoring, with positions as an eligibility filter.
 */

export interface SportBoardConfig {
  positions: string[]
  defaultPos: string
  scoring: { value: string; label: string }[]
  defaultScoring: string
  /** Positions rank within themselves (false) or filter one overall pool (true). */
  overall: boolean
  /** Sleeper ADP + the scheme sort only exist in the NFL pipeline. */
  nflExtras: boolean
  /** Minimum roster share for a player to be tracked on the Steals board. */
  minOwnedPct: number
  /** Auction board default roster size. */
  defaultRosterSize: number
}

const BOARD_CONFIG: Record<string, SportBoardConfig> = {
  nfl: {
    positions: ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'D/ST'],
    defaultPos: 'QB',
    scoring: [
      { value: 'ppr', label: 'PPR' },
      { value: 'half-ppr', label: 'Half-PPR' },
      { value: 'standard', label: 'Standard' },
    ],
    defaultScoring: 'ppr',
    overall: false,
    nflExtras: true,
    minOwnedPct: 1,
    defaultRosterSize: 16,
  },
  nba: {
    positions: ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'],
    defaultPos: 'ALL',
    scoring: [
      { value: 'points', label: 'Points' },
      { value: 'category', label: 'Categories (9-cat)' },
    ],
    defaultScoring: 'points',
    overall: true,
    nflExtras: false,
    minOwnedPct: 2,
    defaultRosterSize: 13,
  },
}

export function boardConfigFor(sport: string): SportBoardConfig {
  return BOARD_CONFIG[sport] ?? BOARD_CONFIG.nfl
}

/** z-score values keep one decimal (they live in roughly -5..+15); points round. */
export function formatBoardValue(v: number, unit: 'pts' | 'z' | undefined): string {
  return unit === 'z' ? v.toFixed(1) : String(Math.round(v))
}
