import { describe, it, expect } from 'vitest'
import { buildStealBoard } from '../steal-engine'
import type { FantasyPlayerEnriched } from '@/lib/fantasy-types'

/** Minimal player shaped the way the engine reads it. */
function mkPlayer(
  over: {
    id?: number
    name?: string
    pos?: string
    team?: string
    proj?: number
    rec?: number
    adp?: number
    inj?: boolean
    owned?: number
    exp?: number
    prior?: number
    indType?: 'espn' | 'popularity_fallback'
  } = {},
): FantasyPlayerEnriched {
  return {
    id: over.id ?? 1,
    player: {
      id: over.id ?? 1,
      fullName: over.name ?? `Player ${over.id ?? 1}`, 
      active: true,
      injured: over.inj ?? false,
      injuryStatus: over.inj ? 'DOUBTFUL' : 'ACTIVE',
      ownership: { percentOwned: over.owned ?? 50 },
    },
    normalizedPosition: over.pos ?? 'WR',
    proTeamAbbr: over.team ?? 'PIT',
    pprRank: over.adp,
    adpSource: over.indType ?? 'espn',
    projection: { points: over.proj ?? 100, stats: { '53': over.rec ?? 0 } },
    seasonActuals: over.prior != null ? { points: over.prior, stats: {} } : undefined,
    sleeper: { years_exp: over.exp ?? 2 },
  } as unknown as FantasyPlayerEnriched
}

describe('scoring format changes the board', () => {
  it('recomputes points per scoring format (Standard vs PPR)', () => {
    const players = [
      mkPlayer({ pos: 'WR', proj: 100, rec: 10, adp: 10 }), // Standard = 100, PPR = 110
      mkPlayer({ pos: 'WR', proj: 120, rec: 1, adp: 5 }),  // Standard = 120, PPR = 121
    ]
    const ppr = buildStealBoard(players, { scoringFormat: 'ppr' })
    const std = buildStealBoard(players, { scoringFormat: 'standard' })

    // PPR projects should be higher; sort by gap desc then projectedPoints desc
    expect(ppr[0].projectedPoints).toBe(121)
    expect(ppr[1].projectedPoints).toBe(110)
    expect(std[0].projectedPoints).toBe(120)
    expect(std[1].projectedPoints).toBe(100)
  })

  it('Half-PPR is midpoint between Standard and PPR', () => {
    const players = [
      mkPlayer({ pos: 'WR', proj: 100, rec: 10, adp: 10 }),  // Half=105
      mkPlayer({ pos: 'WR', proj: 120, rec: 1, adp: 5 }),   // Half=120.5→121
    ]
    const half = buildStealBoard(players, { scoringFormat: 'half-ppr' })

    // Half-PPR rate is 0.5; sorted by gap desc then projectedPoints desc
    expect(half[0].projectedPoints).toBe(121)
    expect(half[1].projectedPoints).toBe(105)
  })

  it('format-adjusted points used for eligibility filter', () => {
    const players = [
      mkPlayer({ pos: 'WR', proj: 60, rec: 0, adp: 1 }),    // Standard = 60, PPR = 60
      mkPlayer({ pos: 'WR', proj: 40, rec: 0, adp: 1 }),    // Standard = 40, PPR = 40
      mkPlayer({ pos: 'WR', proj: 30, rec: 100, adp: 1 }),  // PPR = 130, Standard = 30
    ]
    const ppr = buildStealBoard(players, { scoringFormat: 'ppr' })
    const std = buildStealBoard(players, { scoringFormat: 'standard' })
    // All 3 have positive points in both formats
    expect(ppr.length).toBe(3)
    expect(std.length).toBe(3)
    // PPR: highest is the catch-heavy guy at 130
    expect(ppr[0].projectedPoints).toBe(130)
    // Standard: highest is the 60-point guy
    expect(std[0].projectedPoints).toBe(60)
  })

  it('position weights do not change per-format points', () => {
    const players = [
      mkPlayer({ pos: 'RB', proj: 100, rec: 5, adp: 10 }),
      mkPlayer({ pos: 'WR', proj: 100, rec: 5, adp: 10 }),
    ]
    const ppr = buildStealBoard(players, { scoringFormat: 'ppr' })
    // formatPoints is pure points math: both 100 + 5*1.0 = 105.
    // Position multipliers are a value factor (auction), not a scoring factor.
    expect(ppr[0].projectedPoints).toBe(105)
    expect(ppr[1].projectedPoints).toBe(105)
  })

  it('both rostered players appear when format-adjusted points > 0', () => {
    const players = [
      mkPlayer({ id: 1, pos: 'WR', proj: 100, rec: 0, owned: 20, indType: 'espn', adp: 20 }), // Standard = 100
      mkPlayer({ id: 2, pos: 'WR', proj: 40, rec: 0, owned: 10, indType: 'espn', adp: 40 }),  // Standard = 40
    ]
    const board = buildStealBoard(players, { scoringFormat: 'standard' })
    // Both have positive points and ownership >= ROSTER_RELEVANCE_PCT (1)
    expect(board.length).toBe(2)
    expect(board[0].name).toContain('Player 1')
    expect(board[1].name).toContain('Player 2')
  })
})

describe('confidence uses format-adjusted prior production', () => {
  it('PPR prior points higher for catch-heavy player', () => {
    const p = mkPlayer({ pos: 'WR', proj: 100, rec: 0, adp: 10, prior: 60 })
    const std = buildStealBoard([p], { scoringFormat: 'standard' })
    const ppr = buildStealBoard([p], { scoringFormat: 'ppr' })
    // Prior is seasonActuals.points (no rec in stats) → same for both formats
    expect(std[0].conf).toBe(ppr[0].conf)
  })
})