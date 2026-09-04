import { describe, it, expect } from 'vitest'
import { computeMarketAdp } from '../steal-engine'
import type { FantasyPlayerEnriched } from '@/lib/fantasy-types'

/**
 * F4 regression fixture builder. Only the fields computeMarketAdp reads are populated;
 * the shape mirrors what unifiedToFantasyPlayerEnriched emits. `pprRank` on a unified
 * row is LEAGUE-WIDE — the within-position ADP rank emerges from sorting the position
 * group by it.
 */
function player(id: number, pos: string, pprRank?: number, overrides: Record<string, unknown> = {}): FantasyPlayerEnriched {
  return {
    id,
    pprRank,
    normalizedPosition: pos,
    syntheticEspnId: false,
    player: {
      active: true,
      ownership: { percentOwned: 60 },
    },
    projection: { points: 250 },
    ...overrides,
  } as unknown as FantasyPlayerEnriched
}

describe('computeMarketAdp', () => {
  // The Stafford case from the sweep: league-wide PPR rank #102, but only 11 QBs sit
  // ahead of him once the position group is sorted by the same figure.
  const stafford = player(12483, 'QB', 102)
  const pool: FantasyPlayerEnriched[] = [
    ...Array.from({ length: 11 }, (_, i) => player(i + 1, 'QB', (i + 1) * 8)),
    stafford,
    player(200, 'QB', 150),
    // Non-QB rows interleave league-wide ranks but must never affect a QB's position rank.
    player(300, 'RB', 20),
    player(301, 'WR', 40),
  ]

  it('ranks ADP within position, consistent with the board', () => {
    const market = computeMarketAdp(stafford, pool)
    expect(market.adpRank).toBe(12)
    expect(market.overallAdpRank).toBe(102)
    expect(market.label).toBe('QB #12 - overall #102')
  })

  it('excludes players the board excludes from the rank pool', () => {
    const polluted = [
      ...pool,
      player(999, 'QB', 4, { syntheticEspnId: true }),
      player(998, 'QB', 6, { player: { active: false, ownership: { percentOwned: 60 } } }),
      player(997, 'QB', 7, { player: { active: true, ownership: { percentOwned: 2 } } }),
      player(996, 'QB', undefined),
      player(995, 'QB', 8, { projection: { points: 0 } }),
    ]
    // None of the five ineligible rows may shift the target's within-QB rank.
    expect(computeMarketAdp(stafford, polluted)).toEqual(computeMarketAdp(stafford, pool))
  })

  it('returns only the overall rank for non-board positions', () => {
    const lb = player(500, 'LB', 80)
    const market = computeMarketAdp(lb, [...pool, lb])
    expect(market.adpRank).toBeUndefined()
    expect(market.overallAdpRank).toBe(80)
    expect(market.label).toBeUndefined()
  })

  it('returns nothing when the row carries no usable ADP', () => {
    const noAdp = player(700, 'QB', undefined)
    expect(computeMarketAdp(noAdp, [noAdp])).toEqual({})
  })
})
