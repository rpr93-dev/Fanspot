import type { FantasyPlayerEnriched } from '@/lib/fantasy-types'

/**
 * How strong a team's offense is, per the market's own pricing. This is a *trust*
 * signal on the ADP-vs-projection gap, not a production boost: ESPN projections
 * already embed some of the team's environment, so the environment score only
 * modulates how much the gap can be believed and never touches projected points.
 */
export type EnvironmentSignal = 'top-offense' | 'average' | 'poor-offense'

export interface TeamEnvironment {
  team: string
  /** 0-100 percentile of Vegas implied points per game across the league. */
  envScore: number
  /** 1-based rank of this team's Vegas implied points per game. */
  envRank: number
  /** Number of teams that had odds, so the rank can be read in context. */
  teamCount: number
  impliedPointsPerGame?: number
}

/** Positions a scheme/offense change can actually move the needle for. */
const SKILL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE'])

export function isSkillPosition(pos: string): boolean {
  return SKILL_POSITIONS.has(pos)
}

export function envSignalFor(envScore: number): EnvironmentSignal {
  if (envScore >= 75) return 'top-offense'
  if (envScore <= 25) return 'poor-offense'
  return 'average'
}

/**
 * Builds the per-team environment map from the enriched pipeline. Every player on a
 * team carries the team's `offensiveRank` and `teamImpliedPoints`, so one pass over
 * the player list recovers all 32 team scores with no extra fetching.
 */
export function buildTeamEnvironment(players: FantasyPlayerEnriched[]): Map<string, TeamEnvironment> {
  const byTeam = new Map<string, { rank: number; impliedPoints?: number }>()
  for (const p of players) {
    const team = p.proTeamAbbr?.toUpperCase()
    if (!team || team === 'FA' || byTeam.has(team)) continue
    if (p.vegas?.offensiveRank == null) continue
    byTeam.set(team, { rank: p.vegas.offensiveRank, impliedPoints: p.vegas.teamImpliedPoints })
  }

  const ranked = [...byTeam.entries()].sort((a, b) => a[1].rank - b[1].rank)
  const teamCount = ranked.length

  const env = new Map<string, TeamEnvironment>()
  for (const [team, v] of ranked) {
    const envScore = teamCount > 1
      ? Math.max(0, Math.min(100, Math.round(100 * (1 - (v.rank - 1) / (teamCount - 1)))))
      : 100
    env.set(team, { team, envScore, envRank: v.rank, teamCount, impliedPointsPerGame: v.impliedPoints })
  }
  return env
}

/**
 * Position-weighted environment score. WR/TE value passes through unchanged — targets
 * live and die with the passing attack. RB gets a haircut because a workhorse back can
 * produce on a bad offense. K and D/ST are production-independent, so they sit at a
 * neutral 50. Unknown environment also resolves to neutral so the math degrades safely.
 */
export function environmentScoreFor(env: TeamEnvironment | undefined, pos: string): number {
  if (!env) return 50
  if (pos === 'K' || pos === 'D/ST') return 50
  if (pos === 'RB') return Math.max(0, Math.min(100, Math.round(env.envScore * 0.85)))
  return env.envScore
}
