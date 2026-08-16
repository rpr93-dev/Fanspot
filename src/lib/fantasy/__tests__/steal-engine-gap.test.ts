import { describe, it, expect } from 'vitest'
import { buildStealBoard } from '../steal-engine'
import type { FantasyPlayerEnriched } from '@/lib/fantasy-types'

/** Minimal player shaped the way the engine reads it. */
function mkPlayer(
  over: {
    id?: number
    name?: string
    pos?: string
    proj?: number
    adp?: number
    owned?: number
    exp?: number
    prior?: number
  } = {},
): FantasyPlayerEnriched {
  return {
    id: over.id ?? 1,
    player: {
      id: over.id ?? 1,
      fullName: over.name ?? `Player ${over.id ?? 1}`,
      active: true,
      injured: false,
      injuryStatus: 'ACTIVE',
      ownership: { percentOwned: over.owned ?? 50 },
    },
    normalizedPosition: over.pos ?? 'WR',
    proTeamAbbr: 'PIT',
    pprRank: over.adp,
    adpSource: 'espn',
    projection: { points: over.proj ?? 100, stats: {} },
    seasonActuals: over.prior != null ? { points: over.prior, stats: {} } : undefined,
    sleeper: { years_exp: over.exp ?? 2 },
  } as unknown as FantasyPlayerEnriched
}

describe('gap magnitude weights the steal score', () => {
  it('surfaces a genuine market disagreement above a consensus elite with a tiny gap', () => {
    // Two WRs with the same profile (projection, prior production, confidence) —
    // the only difference is the market price. One is drafted at his value
    // (1-rank gap, market noise), the other 12+ ranks later (a real mispricing).
    const players = [
      mkPlayer({ id: 1, pos: 'WR', proj: 300, adp: 3, owned: 70, exp: 4, prior: 290, name: 'Elite' }),
      mkPlayer({ id: 2, pos: 'WR', proj: 300, adp: 50, owned: 70, exp: 4, prior: 290, name: 'Faller' }),
      // Deeper filler so the ADP ranks are meaningful.
      ...Array.from({ length: 18 }, (_, i) =>
        mkPlayer({ id: 200 + i, pos: 'WR', proj: 160 - i * 2, adp: 25 + i, owned: 25, exp: 2 }),
      ),
    ]
    const rows = buildStealBoard(players, { scoringFormat: 'ppr' })
    const elite = rows.find((r) => r.playerId === 1)!
    const faller = rows.find((r) => r.playerId === 2)!

    // Same player profile; the only difference is how far the market has let them fall.
    expect(faller.gap - elite.gap).toBeGreaterThan(8)
    // The real mispricing leads the board, and by a decisive margin — the
    // gap-magnitude weight keeps consensus players from masquerading as steals.
    expect(rows[0].playerId).toBe(2)
    expect(faller.stealScore).toBeGreaterThan(elite.stealScore * 3)
  })

  it('still discounts by confidence: a low-confidence outlier cannot outrank a stable steal', () => {
    const players = [
      // Demonstrated producer with a real gap (prior 260, drafted 12 ranks later).
      mkPlayer({ id: 1, pos: 'WR', proj: 280, adp: 50, owned: 70, exp: 5, prior: 260, name: 'Stable' }),
      // Same gap, but a rookie with no prior production — speculative.
      mkPlayer({ id: 2, pos: 'WR', proj: 280, adp: 50, owned: 70, exp: 0, name: 'Rookie' }),
      ...Array.from({ length: 18 }, (_, i) =>
        mkPlayer({ id: 200 + i, pos: 'WR', proj: 160 - i * 2, adp: 25 + i, owned: 25, exp: 2 }),
      ),
    ]
    const rows = buildStealBoard(players, { scoringFormat: 'ppr' })
    const stable = rows.find((r) => r.playerId === 1)!
    const rookie = rows.find((r) => r.playerId === 2)!
    expect(stable.stealScore).toBeGreaterThan(rookie.stealScore)
  })
})
