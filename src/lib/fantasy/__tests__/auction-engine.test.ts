import { describe, it, expect } from 'vitest'
import {
  buildAuctionBoard,
  clampSettings,
  computeReplacementLevels,
  DEFAULT_AUCTION_SETTINGS,
} from '../auction-engine'
import type { FantasyPlayerEnriched } from '@/lib/fantasy-types'

let nextId = 1

/** Minimal player shaped the way the auction engine reads it. */
function player(
  over: {
    name?: string
    pos?: string
    proj?: number
    rec?: number
    auction?: number
    team?: string
    injuryStatus?: string
  } = {},
): FantasyPlayerEnriched {
  const id = nextId++
  return {
    id,
    proTeamAbbr: over.team ?? 'NE',
    normalizedPosition: over.pos ?? 'RB',
    projection: { points: over.proj ?? 100, stats: { '53': over.rec ?? 0 } },
    player: {
      id,
      fullName: over.name ?? `Player ${id}`,
      injuryStatus: over.injuryStatus,
      ownership: { auctionValueAverage: over.auction ?? 0 },
    },
  } as unknown as FantasyPlayerEnriched
}

/** A pool deep enough that replacement level lands inside it. */
function pool(pos: string, count: number, top: number, step: number): FantasyPlayerEnriched[] {
  return Array.from({ length: count }, (_, i) =>
    player({ pos, proj: top - i * step, name: `${pos}${i + 1}` }),
  )
}

function fullLeague(): FantasyPlayerEnriched[] {
  return [
    ...pool('QB', 40, 400, 5),
    ...pool('RB', 80, 300, 3),
    ...pool('WR', 100, 260, 2),
    ...pool('TE', 40, 200, 4),
    ...pool('K', 30, 170, 2),
    ...pool('D/ST', 32, 140, 2),
  ]
}

describe('clampSettings', () => {
  it('falls back to defaults when values are absent or non-numeric', () => {
    expect(clampSettings({})).toEqual(DEFAULT_AUCTION_SETTINGS)
    expect(clampSettings({ budget: 'abc', teams: undefined })).toEqual(DEFAULT_AUCTION_SETTINGS)
  })

  it('accepts numeric strings from the query string', () => {
    expect(clampSettings({ budget: '300', teams: '10', rosterSize: '15' })).toEqual({
      budget: 300,
      teams: 10,
      rosterSize: 15,
      scoringFormat: 'ppr',
    })
  })

  it('bounds absurd input rather than producing absurd prices', () => {
    expect(clampSettings({ budget: 1, teams: 1, rosterSize: 0 })).toEqual({
      budget: 10,
      teams: 2,
      rosterSize: 1,
      scoringFormat: 'ppr',
    })
    expect(clampSettings({ budget: 99999, teams: 500, rosterSize: 999 })).toEqual({
      budget: 1000,
      teams: 20,
      rosterSize: 40,
      scoringFormat: 'ppr',
    })
  })

  it('passes through a valid scoring format and rejects an invalid one', () => {
    expect(clampSettings({ scoringFormat: 'standard' }).scoringFormat).toBe('standard')
    expect(clampSettings({ scoringFormat: 'half-ppr' }).scoringFormat).toBe('half-ppr')
    expect(clampSettings({ scoringFormat: 'bogus' }).scoringFormat).toBe('ppr')
  })
})

describe('computeReplacementLevels', () => {
  it('sets the line at the last player the league will actually start', () => {
    // 12 teams x 1 QB = 12 starters, so replacement is QB12: 400 - 11*5 = 345.
    const levels = computeReplacementLevels(pool('QB', 40, 400, 5), { ...DEFAULT_AUCTION_SETTINGS, teams: 12 })
    expect(levels.QB).toBe(345)
  })

  it('drops the line as teams are removed, because fewer starters are needed', () => {
    const deep = computeReplacementLevels(pool('RB', 80, 300, 3), { ...DEFAULT_AUCTION_SETTINGS, teams: 12 })
    const shallow = computeReplacementLevels(pool('RB', 80, 300, 3), { ...DEFAULT_AUCTION_SETTINGS, teams: 8 })
    expect(shallow.RB).toBeGreaterThan(deep.RB)
  })

  it('never runs past the end of a short pool', () => {
    const levels = computeReplacementLevels(pool('TE', 3, 200, 10), { ...DEFAULT_AUCTION_SETTINGS, teams: 12 })
    expect(levels.TE).toBe(180)
  })
})

describe('buildAuctionBoard', () => {
  it('spends the whole budget: total value tracks the money in the room', () => {
    const { rows, assumptions } = buildAuctionBoard(fullLeague(), {
      budget: 200,
      teams: 12,
      rosterSize: 16,
      scoringFormat: 'ppr',
    })
    const spent = rows.reduce((s, r) => s + r.value, 0)
    // Only priced players above replacement carry value; the rest are $1 fillers.
    expect(spent).toBeLessThanOrEqual(assumptions.totalMoney)
    expect(spent).toBeGreaterThan(assumptions.totalMoney * 0.3)
  })

  it('scales values with the budget the user enters', () => {
    const cheap = buildAuctionBoard(fullLeague(), { budget: 100, teams: 12, rosterSize: 16, scoringFormat: 'ppr' })
    const rich = buildAuctionBoard(fullLeague(), { budget: 400, teams: 12, rosterSize: 16, scoringFormat: 'ppr' })
    const topCheap = cheap.rows[0]
    const topRich = rich.rows.find((r) => r.name === topCheap.name)!
    expect(topRich.value).toBeGreaterThan(topCheap.value * 2)
  })

  it('never prices a rostered player below $1', () => {
    const { rows } = buildAuctionBoard(fullLeague(), DEFAULT_AUCTION_SETTINGS)
    expect(rows.every((r) => r.value >= 1)).toBe(true)
  })

  it('excludes players projected below replacement rather than pricing them at zero', () => {
    const { rows } = buildAuctionBoard(fullLeague(), DEFAULT_AUCTION_SETTINGS)
    // QB40 is far below the QB12 line and should not appear at any price.
    expect(rows.some((r) => r.name === 'QB40')).toBe(false)
  })

  it('reports market as null when no auction prices are published', () => {
    const { rows, assumptions } = buildAuctionBoard(fullLeague(), DEFAULT_AUCTION_SETTINGS)
    expect(assumptions.marketUnavailable).toBe(true)
    expect(rows.every((r) => r.market === null && r.surplus === null)).toBe(true)
  })

  it('rescales published prices to this leaguerather than taking them at face value', () => {
    const players = fullLeague()
    players.forEach((p, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(p.player as any).ownership = { auctionValueAverage: i < 100 ? 10 : 0 }
    })
    const { rows, assumptions } = buildAuctionBoard(players, {
      budget: 200,
      teams: 12,
      rosterSize: 16,
      scoringFormat: 'ppr',
    })
    expect(assumptions.marketUnavailable).toBe(false)
    const priced = rows.filter((r) => r.market != null)
    expect(priced.length).toBeGreaterThan(0)
    // Published total is 100 x $10 = $1000 against $2400 of real money, so ~2.4x.
    expect(priced[0]!.market).toBeCloseTo(24, 0)
  })

  it('ranks by surplus within position, not across the whole board', () => {
    const players = fullLeague()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    players.forEach((p) => ((p.player as any).ownership = { auctionValueAverage: 10 }))
    const { rows } = buildAuctionBoard(players, DEFAULT_AUCTION_SETTINGS)
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      const inPos = rows.filter((r) => r.pos === pos).sort((a, b) => a.posRank - b.posRank)
      expect(inPos[0]?.posRank).toBe(1)
      for (let i = 1; i < inPos.length; i++) {
        expect(inPos[i]!.surplus!).toBeLessThanOrEqual(inPos[i - 1]!.surplus!)
      }
    }
  })

  it('holds severely injured players out of the ranking instead of calling them bargains', () => {
    const players = fullLeague()
    const star = players.find((p) => p.player.fullName === 'RB1')!
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(star.player as any).injuryStatus = 'OUT'
    const { rows, injuryWatch } = buildAuctionBoard(players, DEFAULT_AUCTION_SETTINGS)
    expect(rows.some((r) => r.name === 'RB1')).toBe(false)
    expect(injuryWatch.some((r) => r.name === 'RB1')).toBe(true)
    // Still priced, so the number is available rather than hidden.
    expect(injuryWatch.find((r) => r.name === 'RB1')!.value).toBeGreaterThan(1)
  })

  it('holds suspended players out of the ranking even though they are healthy', () => {
    const players = fullLeague()
    const star = players.find((p) => p.player.fullName === 'RB1')!
    // Sleeper's roster status is the field that carries a suspension.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(star as any).sleeper = { status: 'Suspended' }
    const { rows, injuryWatch } = buildAuctionBoard(players, DEFAULT_AUCTION_SETTINGS)
    expect(rows.some((r) => r.name === 'RB1')).toBe(false)
    const held = injuryWatch.find((r) => r.name === 'RB1')!
    expect(held.suspended).toBe(true)
    // Not an injury, so the tier must stay clean.
    expect(held.injuryTier).toBe('healthy')
    expect(held.value).toBeGreaterThan(1)
  })

  it('prices kickers and defenses far below skill players at equal raw surplus', () => {
    const { rows } = buildAuctionBoard(fullLeague(), DEFAULT_AUCTION_SETTINGS)
    const topDst = rows.filter((r) => r.pos === 'D/ST').sort((a, b) => b.value - a.value)[0]
    const topRb = rows.filter((r) => r.pos === 'RB').sort((a, b) => b.value - a.value)[0]
    expect(topDst!.value).toBeLessThan(topRb!.value / 5)
  })

  it('includes every draftable position on the board', () => {
    const { rows } = buildAuctionBoard(fullLeague(), DEFAULT_AUCTION_SETTINGS)
    const seen = new Set(rows.map((r) => r.pos))
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST']) {
      expect(seen.has(pos)).toBe(true)
    }
  })

  it('values a catch-heavy player higher in PPR than Standard', () => {
    const league = [
      player({ name: 'CatchKing', pos: 'WR', proj: 130, rec: 40, team: 'NYG' }),
      player({ name: 'YardGrinder', pos: 'WR', proj: 150, rec: 0, team: 'TEN' }),
      player({ name: 'BenchWarmer', pos: 'WR', proj: 90, rec: 0, team: 'CHI' }),
    ]
    const std = buildAuctionBoard(league, { ...DEFAULT_AUCTION_SETTINGS, scoringFormat: 'standard' })
    const ppr = buildAuctionBoard(league, { ...DEFAULT_AUCTION_SETTINGS, scoringFormat: 'ppr' })
    const stdCatch = std.rows.find((r) => r.name === 'CatchKing')!
    const pprCatch = ppr.rows.find((r) => r.name === 'CatchKing')!
    const stdYard = std.rows.find((r) => r.name === 'YardGrinder')!
    const pprYard = ppr.rows.find((r) => r.name === 'YardGrinder')!
    // Standard: YardGrinder projects above CatchKing. PPR adds 40 points to CatchKing.
    expect(stdYard.projectedPoints).toBeGreaterThan(stdCatch.projectedPoints)
    expect(pprCatch.projectedPoints).toBeGreaterThan(pprYard.projectedPoints)
    expect(pprCatch.value).toBeGreaterThan(stdCatch.value)
  })
})
