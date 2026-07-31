export type FantasySport = 'nfl' | 'nba' | 'mlb' | 'nhl'

export interface EspnFantasyPlayer {
  draftAuctionValue: number
  droppedByEliminatedTeam: boolean
  id: number
  keeperValue: number
  keeperValueFuture: number
  lineupLocked: boolean
  onTeamId: number
  player: EspnFantasyPlayerDetails
  ratings: Record<number, {
    positionalRanking: number
    totalRanking: number
    totalRating?: number
  }>
  rosterLocked: boolean
  status: string
  tradeLocked: boolean
  waiverProcessDate: string
}

export interface EspnFantasyPlayerDetails {
  active: boolean
  defaultPositionId: number
  draftRanksByRankType: Partial<Record<'PPR' | 'STANDARD' | 'ROTO' | 'ECR', {
    rank: number
    auctionValue: number
    rankType: string
  }>>
  droppable: boolean
  eligibleSlots: number[]
  firstName: string
  fullName: string
  id: number
  injured: boolean
  injuryStatus: string
  jersey: string
  lastName: string
  ownership: {
    averageDraftPosition: number
    percentOwned: number
    percentStarted: number
    auctionValueAverage: number
    activityLevel: number
  }
  proTeamId: number
  stats: Array<{
    statSourceId: number
    statSplitTypeId: number
    seasonId: number
    appliedTotal: number
    appliedAverage: number
    stats: Record<string, number>
  }>
}

export interface EspnFantasyResponse {
  players: EspnFantasyPlayer[]
}

export interface SleeperPlayer {
  player_id: string
  first_name: string
  last_name: string
  full_name: string
  position: string
  fantasy_positions: string[]
  espn_id: number
  yahoo_id: number
  rotowire_id: number
  team: string
  age: number
  years_exp: number
  injury_status: string
  search_rank: number
  college?: string
  sport?: string
}

export type DraftType = 'snake' | 'auction' | 'dynasty' | 'best-ball'

export type ScoringFormat = 'standard' | 'ppr' | 'half-ppr' | 'category' | 'points' | 'roto' | 'h2h-points'

export type AdpPlatform = 'espn' | 'sleeper'

/** Whether the ADP number is a real draft rank or Sleeper's popularity `search_rank` standing in for one. */
export type AdpSource = 'espn' | 'popularity_fallback'

export interface StealScore {
  playerId: number
  playerName: string
  projectionRank: number
  platformAdp: number
  stealScore: number
  stealIndex?: number
  stealPercentile: number
  draftType: DraftType
  scoringFormat: ScoringFormat
  sport: FantasySport
  position: string
  reasoning: string
  adpPlatform: AdpPlatform
  adpSource: AdpSource
  vorp?: number
  replacementLevel?: number
  projectedPoints?: number
  adjustedPoints?: number
  positionGroupSize?: number
  expectedRank?: number
  adpValue?: number
  adpDiscount?: number
  confidence?: number
  opportunity?: number
  efficiency?: number
  offensiveEnvironment?: number
  impliedTeamTotal?: number
  injuryBoost?: number
  marketMomentum?: number
  newsHeadlines?: string[]
  leagueWinnerPct?: number
}

export interface FantasyPlayerEnriched extends EspnFantasyPlayer {
  sleeper?: SleeperPlayer
  stealScore?: StealScore
  normalizedPosition?: string
  proTeamAbbr?: string
  projection?: {
    points: number
    stats: Record<string, number>
  }
  seasonActuals?: {
    points: number
    stats: Record<string, number>
  }
  /** Season the `seasonActuals` figures came from — the last completed one, not the current. */
  seasonActualsYear?: number
  pprRank?: number
  standardRank?: number
  auctionValue?: number
  positionRank?: number
  vegas?: {
    teamImpliedPoints?: number
    offensiveRank?: number
  }
  adpSource?: AdpSource
  /** True when `id` is a hash of the Sleeper ID because no real ESPN ID exists. */
  syntheticEspnId?: boolean
}

export function assertEspnShape(data: unknown): asserts data is EspnFantasyResponse {
  if (!data || typeof data !== 'object') {
    throw new Error('ESPN fantasy response is not an object')
  }
  const resp = data as Record<string, unknown>
  if (!Array.isArray(resp.players)) {
    throw new Error('ESPN fantasy response missing players array')
  }
}

const NFL_TEAM_MAP: Record<number, string> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
  8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAC',
     15: 'LAR', 16: 'MIN', 17: 'MIA', 18: 'NE', 19: 'NO', 20: 'NYG', 21: 'NYJ',
  22: 'PHI', 23: 'ARI', 24: 'PIT', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS',
  29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
}

const NBA_TEAM_MAP: Record<number, string> = {
  1: 'ATL', 2: 'BOS', 3: 'CHI', 4: 'CLE', 5: 'DAL', 6: 'DEN', 7: 'DET',
  8: 'GSW', 9: 'HOU', 10: 'IND', 11: 'LAC', 12: 'LAL', 14: 'MEM', 15: 'MIA',
  16: 'MIL', 17: 'MIN', 18: 'BKN', 19: 'NO', 20: 'NYK', 21: 'OKC', 22: 'ORL',
  23: 'PHI', 24: 'PHX', 25: 'POR', 26: 'SAC', 27: 'SAS', 28: 'TOR', 29: 'UTA',
  30: 'WSH', 31: 'CHA',
}

const NHL_TEAM_MAP: Record<number, string> = {
  1: 'NJD', 2: 'NYI', 3: 'NYR', 4: 'PHI', 5: 'PIT', 6: 'BOS', 7: 'BUF',
  8: 'MTL', 9: 'OTT', 10: 'TOR', 11: 'CAR', 12: 'FLA', 13: 'TB', 14: 'WSH',
  15: 'CHI', 16: 'DET', 17: 'NSH', 18: 'STL', 19: 'CGY', 20: 'COL', 21: 'EDM',
  22: 'VAN', 23: 'ANA', 24: 'DAL', 25: 'LAK', 26: 'SJ', 27: 'CBJ', 28: 'MIN',
  29: 'WPG', 30: 'ARI', 31: 'VGK', 32: 'SEA', 53: 'UTA',
}

const MLB_TEAM_MAP: Record<number, string> = {
  1: 'ARI', 2: 'ATL', 3: 'BAL', 4: 'BOS', 5: 'CHC', 6: 'CWS', 7: 'CIN',
  8: 'CLE', 9: 'COL', 10: 'DET', 11: 'HOU', 12: 'KC', 13: 'LAA', 14: 'LAD',
  15: 'MIA', 16: 'MIL', 17: 'MIN', 18: 'NYM', 19: 'NYY', 20: 'OAK', 21: 'PHI',
  22: 'PIT', 23: 'SD', 24: 'SF', 25: 'SEA', 26: 'STL', 27: 'TB', 28: 'TEX',
  29: 'TOR', 30: 'WSH',
}

export const PRO_TEAM_MAPPER: Record<string, Record<number, string>> = {
  nfl: NFL_TEAM_MAP,
  nba: NBA_TEAM_MAP,
  nhl: NHL_TEAM_MAP,
  mlb: MLB_TEAM_MAP,
}

export const POSITION_MAPPER: Record<string, Record<number, string>> = {
  nfl: { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' },
  nba: { 1: 'PG', 2: 'SG', 3: 'SF', 4: 'PF', 5: 'C' },
  nhl: { 1: 'C', 2: 'LW', 3: 'RW', 4: 'D', 5: 'G' },
  mlb: { 1: 'SP', 2: 'RP', 3: 'C', 4: '1B', 5: '2B', 6: '3B', 7: 'SS', 8: 'LF', 9: 'CF', 10: 'RF', 11: 'DH' },
}

export function mapProTeamId(sport: FantasySport, proTeamId: number): string | undefined {
  return PRO_TEAM_MAPPER[sport]?.[proTeamId]
}

export function mapPosition(sport: FantasySport, defaultPositionId: number): string | undefined {
  return POSITION_MAPPER[sport]?.[defaultPositionId]
}
