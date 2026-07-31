import type { FantasyPlayerEnriched } from '@/lib/fantasy-types'

/** Positions the team outlook panel reports a starter for. */
export const STARTER_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
export type StarterPosition = (typeof STARTER_POSITIONS)[number]

export type StarterEvidence = 'depth-chart' | 'usage' | 'projection'

export interface StarterCandidate {
  playerId: number
  name: string
  score: number
  depthChartOrder?: number
  percentStarted: number
  percentOwned: number
  projectedPoints: number
}

export interface StarterPick {
  pos: StarterPosition
  player: StarterCandidate | null
  /** Runner-up, kept so an unsettled job can name both players. */
  contender: StarterCandidate | null
  /** True when no candidate separates far enough to be called the starter. */
  unsettled: boolean
  /** Strongest signal behind the pick — depth chart beats usage beats raw projection. */
  evidence: StarterEvidence
  /** Plain-English reason, shown verbatim in the UI when `unsettled`. */
  reason: string
}

/**
 * Below this margin the top two candidates are close enough that calling either one
 * "the starter" would be inventing certainty the data doesn't support.
 */
export const UNSETTLED_MARGIN = 12

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function toCandidate(p: FantasyPlayerEnriched): StarterCandidate {
  const sleeper = p.sleeper as Record<string, unknown> | undefined
  return {
    playerId: p.id,
    name: p.player.fullName,
    score: 0,
    depthChartOrder: num(sleeper?.depth_chart_order),
    percentStarted: p.player.ownership?.percentStarted ?? 0,
    percentOwned: p.player.ownership?.percentOwned ?? 0,
    projectedPoints: p.projection?.points ?? 0,
  }
}

/**
 * Ranks a position group by role rather than roster order. Depth chart is the only
 * direct statement of who starts, so it dominates; start-rate is the market's read on
 * the same question; projected points only break ties, because a projection ranks
 * production and not the job.
 */
function scoreCandidate(c: StarterCandidate, maxProj: number): number {
  let score = 0

  if (c.depthChartOrder != null) {
    // 1 -> 60, 2 -> 30, 3 -> 20, and so on.
    score += 60 / c.depthChartOrder
  }
  score += Math.min(30, c.percentStarted * 0.6)
  score += maxProj > 0 ? (c.projectedPoints / maxProj) * 10 : 0

  return Math.round(score * 10) / 10
}

function evidenceFor(c: StarterCandidate): StarterEvidence {
  if (c.depthChartOrder != null) return 'depth-chart'
  if (c.percentStarted > 0) return 'usage'
  return 'projection'
}

function unsettledReason(pos: StarterPosition, a: StarterCandidate, b: StarterCandidate): string {
  const noun =
    pos === 'RB' ? 'backfield' : pos === 'QB' ? 'quarterback job' : pos === 'WR' ? 'WR1 role' : 'tight end role'
  return `No clear ${noun} — ${a.name} and ${b.name} are separated by too little to call one the starter.`
}

/**
 * Picks the current QB1/RB1/WR1/TE1 for a team. Returns one entry per position in
 * `STARTER_POSITIONS`, always in that order, with `player: null` when the team has
 * nobody at the position rather than reaching into another position group.
 */
export function pickTeamStarters(
  players: FantasyPlayerEnriched[],
  teamAbbr: string,
): StarterPick[] {
  const team = teamAbbr.toUpperCase()
  const roster = players.filter(
    (p) => (p.proTeamAbbr ?? '').toUpperCase() === team && p.player?.active !== false,
  )

  return STARTER_POSITIONS.map((pos) => {
    const group = roster.filter((p) => p.normalizedPosition === pos)
    if (group.length === 0) {
      return {
        pos,
        player: null,
        contender: null,
        unsettled: false,
        evidence: 'projection' as StarterEvidence,
        reason: `No ${pos} on the roster in the current data.`,
      }
    }

    const maxProj = Math.max(...group.map((p) => p.projection?.points ?? 0), 0)
    const ranked = group
      .map((p) => {
        const c = toCandidate(p)
        c.score = scoreCandidate(c, maxProj)
        return c
      })
      .sort((a, b) => b.score - a.score || b.projectedPoints - a.projectedPoints)

    const top = ranked[0]
    const second = ranked[1] ?? null
    const unsettled = second != null && top.score - second.score < UNSETTLED_MARGIN

    return {
      pos,
      player: top,
      contender: second,
      unsettled,
      evidence: evidenceFor(top),
      reason: unsettled && second ? unsettledReason(pos, top, second) : '',
    }
  })
}
