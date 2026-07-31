export interface CanonicalPlayer {
  sleeperId: string
  espnId?: number
  gsisId?: string
  pfrId?: string
  fullName: string
  firstName: string
  lastName: string
  position: string
  team: string
  age?: number
  yearsExp?: number
  rookie: boolean
  active: boolean
  college?: string
  height?: string
  weight?: number
}

export interface PlayerProjection {
  points: number
  stats: Record<string, number>
  source: 'espn' | 'internal' | 'historical'
}

export interface PlayerAdp {
  ppr?: number
  standard?: number
  auction?: number
  sleeper?: number
}

export interface PlayerRankings {
  ppr?: number
  standard?: number
  position?: number
}

export interface PlayerOwnership {
  percentOwned: number
  percentStarted: number
  auctionValueAverage: number
  activityLevel: number
}

export interface PlayerInjury {
  status: 'ACTIVE' | 'QUESTIONABLE' | 'DOUBTFUL' | 'OUT' | 'IR' | 'PUP' | 'SUSPENDED' | 'unknown'
  injured: boolean
  practiceStatus?: string
  weekAvailability?: string
}

export interface PlayerVegas {
  teamWinTotal?: number
  teamImpliedPoints?: number
  offensiveRank?: number
}

export interface PlayerEfficiency {
  epaPerPlay?: number
  successRate?: number
  targets?: number
  carries?: number
  snapShare?: number
}

export interface PlayerAdvancedStats {
  routeParticipation?: number
  targetShare?: number
  airYardsShare?: number
  yardsAfterContact?: number
  brokenTackles?: number
}

export interface UnmatchedSource {
  source: string
  playerId: string | number
  reason: string
}

export interface UnifiedPlayer {
  canonical: CanonicalPlayer

  projection?: PlayerProjection
  seasonActuals?: {
    points: number
    stats: Record<string, number>
    seasonId: number
  }
  adp?: PlayerAdp
  rankings?: PlayerRankings
  ownership?: PlayerOwnership
  injury?: PlayerInjury
  vegas?: PlayerVegas
  efficiency?: PlayerEfficiency
  advancedStats?: PlayerAdvancedStats

  /** ESPN id this player was matched to, including via name/fuzzy fallback. */
  resolvedEspnId?: number
  match?: {
    strategy: PlayerMatchResult['strategy']
    confidence: number
  }

  rawSleeper?: Record<string, unknown>
  rawEspn?: Record<string, unknown>

  stealScore?: number
  stealIndex?: number
  leagueWinnerPct?: number
  confidence?: number

  normalizedPosition?: string
  proTeamAbbr?: string

  lastUpdated: {
    sleeper?: number
    espn?: number
    projections?: number
    adp?: number
    injuries?: number
    vegas?: number
  }
}

export interface UnifiedPlayerWithDerived extends UnifiedPlayer {
  derived: {
    position: string
  }
}

export interface PlayerMatchResult {
  canonical: CanonicalPlayer
  strategy: 'sleeper-id' | 'espn-id' | 'gsis-id' | 'pfr-id' | 'name-position' | 'name-team' | 'fuzzy' | 'new'
  confidence: number
}

export const VALID_POSITIONS_NFL = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'D/ST', 'LB', 'DB', 'DL', 'OL', 'P', 'LS', 'FB', 'CB', 'S', 'DE', 'DT', 'OT', 'OG', 'C', 'NT', 'EDGE', 'PK', 'PN'])

export const FANTASY_POSITIONS_NFL = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'])

export interface IntegrationLog {
  timestamp: number
  level: 'info' | 'warn' | 'error'
  source: string
  message: string
  details?: Record<string, unknown>
}
