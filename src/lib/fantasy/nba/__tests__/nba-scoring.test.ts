import { describe, it, expect } from 'vitest'
import {
  NBA_POINTS_WEIGHTS,
  NBA_SEASON_GAMES,
  NBA_STAT,
  computeCategoryValues,
  isNbaScoring,
  makeStatLine,
  nbaEligiblePositions,
  nbaFantasyPoints,
  nbaFantasyPointsPerGame,
  nbaPrimaryPosition,
  nbaSeasonId,
  nbaStatLineText,
  nbaTeamAbbr,
  normalizeNbaName,
  perGame,
  sleeperNbaTeam,
  type CategoryInput,
  type NbaStatLine,
} from '../nba-scoring'

/** Season-totals line: PTS 2000 over 72 GP with a realistic shape around it. */
function starLine(over: Partial<Record<string, number>> = {}): NbaStatLine {
  const totals: Record<string, number> = {
    [NBA_STAT.PTS]: 2000,
    [NBA_STAT.REB]: 800,
    [NBA_STAT.AST]: 600,
    [NBA_STAT.STL]: 100,
    [NBA_STAT.BLK]: 80,
    [NBA_STAT.TPM]: 150,
    [NBA_STAT.FGM]: 750,
    [NBA_STAT.FGA]: 1500,
    [NBA_STAT.FTM]: 350,
    [NBA_STAT.FTA]: 420,
    [NBA_STAT.TO]: 220,
    [NBA_STAT.MIN]: 2500,
    [NBA_STAT.GP]: 72,
    ...over,
  }
  return { totals, gp: totals[NBA_STAT.GP] }
}

function benchLine(): NbaStatLine {
  return starLine({
    [NBA_STAT.PTS]: 400,
    [NBA_STAT.REB]: 150,
    [NBA_STAT.AST]: 80,
    [NBA_STAT.STL]: 20,
    [NBA_STAT.BLK]: 10,
    [NBA_STAT.TPM]: 30,
    [NBA_STAT.FGM]: 150,
    [NBA_STAT.FGA]: 350,
    [NBA_STAT.FTM]: 70,
    [NBA_STAT.FTA]: 100,
    [NBA_STAT.TO]: 60,
    [NBA_STAT.MIN]: 800,
    [NBA_STAT.GP]: 60,
  })
}

describe('nbaFantasyPoints', () => {
  it('applies ESPN default points weights to season totals', () => {
    const line = starLine()
    let expected = 0
    for (const [id, w] of Object.entries(NBA_POINTS_WEIGHTS)) expected += w * line.totals[id]
    expect(nbaFantasyPoints(line)).toBeCloseTo(expected, 6)
    // Spot-check the documented weights: PTS 1, AST 2, STL 4, TO -2.
    expect(expected).toBe(
      2000 * 1 + 150 * 1 + 1500 * -1 + 750 * 2 + 420 * -1 + 350 * 1 + 800 * 1 + 600 * 2 + 100 * 4 + 80 * 4 + 220 * -2,
    )
  })

  it('returns 0 without a line and scales per game by GP', () => {
    expect(nbaFantasyPoints(undefined)).toBe(0)
    const line = starLine()
    expect(nbaFantasyPointsPerGame(line)).toBeCloseTo(nbaFantasyPoints(line) / 72, 9)
    expect(nbaFantasyPointsPerGame(undefined)).toBe(0)
  })
})

describe('computeCategoryValues', () => {
  function pool(): CategoryInput[] {
    const inputs: CategoryInput[] = []
    for (let i = 0; i < 40; i++) {
      inputs.push({ id: i, line: i === 0 ? starLine() : benchLine() })
    }
    return inputs
  }

  it('ranks the star far above replacement bodies', () => {
    const values = computeCategoryValues(pool())
    const star = values.get(0)!
    const bench = values.get(1)!
    expect(star.zPerGame).toBeGreaterThan(bench.zPerGame)
    expect(star.value).toBeGreaterThan(bench.value)
  })

  it('counts turnovers against (TO z is sign-flipped)', () => {
    const clean = starLine({ [NBA_STAT.TO]: 50 })
    const sloppy = starLine({ [NBA_STAT.TO]: 400 })
    const inputs: CategoryInput[] = [{ id: 1, line: clean }]
    for (let i = 2; i <= 30; i++) inputs.push({ id: i, line: benchLine() })
    const cleanVal = computeCategoryValues(inputs).get(1)!
    const sloppyInputs: CategoryInput[] = [{ id: 1, line: sloppy }]
    for (let i = 2; i <= 30; i++) sloppyInputs.push({ id: i, line: benchLine() })
    const sloppyVal = computeCategoryValues(sloppyInputs).get(1)!
    expect(cleanVal.z['TO']).toBeGreaterThan(sloppyVal.z['TO'])
    expect(cleanVal.value).toBeGreaterThan(sloppyVal.value)
  })

  it('scales value by games played over an 82-game season', () => {
    const full = starLine({ [NBA_STAT.GP]: 82 })
    const half = starLine({ [NBA_STAT.GP]: 41 })
    const mk = (line: NbaStatLine, id: number): CategoryInput[] => {
      const inputs: CategoryInput[] = [{ id, line }]
      for (let i = 100; i < 130; i++) inputs.push({ id: i, line: benchLine() })
      return inputs
    }
    const fullVal = computeCategoryValues(mk(full, 7)).get(7)!
    const halfVal = computeCategoryValues(mk(half, 7)).get(7)!
    // Same per-game quality, half the season: value halves.
    expect(fullVal.zPerGame).toBeCloseTo(halfVal.zPerGame, 6)
    expect(fullVal.value).toBeCloseTo(halfVal.value * 2, 6)
    expect(NBA_SEASON_GAMES).toBe(82)
  })

  it('returns an empty map with no usable inputs', () => {
    expect(computeCategoryValues([]).size).toBe(0)
  })
})

describe('nbaTeamAbbr', () => {
  it('maps the verified ESPN fba proTeamIds', () => {
    expect(nbaTeamAbbr(1)).toBe('ATL')
    expect(nbaTeamAbbr(7)).toBe('DEN')
    expect(nbaTeamAbbr(24)).toBe('SAS')
    expect(nbaTeamAbbr(25)).toBe('OKC')
    expect(nbaTeamAbbr(26)).toBe('UTA')
    expect(nbaTeamAbbr(27)).toBe('WSH')
    expect(nbaTeamAbbr(30)).toBe('CHA')
  })

  it('sends unknown ids (and free agents) to FA', () => {
    expect(nbaTeamAbbr(0)).toBe('FA')
    expect(nbaTeamAbbr(999)).toBe('FA')
  })
})

describe('nbaSeasonId', () => {
  it('rolls over in July (2026-27 ends in 2027)', () => {
    expect(nbaSeasonId(new Date(2026, 6, 1))).toBe(2027) // July
    expect(nbaSeasonId(new Date(2026, 9, 15))).toBe(2027) // October
    expect(nbaSeasonId(new Date(2026, 5, 30))).toBe(2026) // June
    expect(nbaSeasonId(new Date(2027, 0, 10))).toBe(2027) // January
  })
})

describe('positions and names', () => {
  it('maps defaultPositionId 1-5 to PG-PF-C', () => {
    expect(nbaPrimaryPosition(1)).toBe('PG')
    expect(nbaPrimaryPosition(5)).toBe('C')
    expect(nbaPrimaryPosition(99)).toBeUndefined()
  })

  it('builds eligibility from primary plus combo slots only', () => {
    // Slot 9 (PF/C combo) and slot 12 add nothing beyond the base positions.
    expect(nbaEligiblePositions(4, [3, 9, 12])).toEqual(['PF'])
    expect(nbaEligiblePositions(4, [3, 4])).toEqual(['PF', 'C'])
    expect(nbaEligiblePositions(1, [0, 5])).toEqual(['PG'])
  })

  it('strips suffixes and punctuation for exact joins', () => {
    expect(normalizeNbaName('LeBron James Jr.')).toBe('lebron james')
    // Apostrophes split the token, identically on both sides of the join.
    expect(normalizeNbaName("D'Angelo Russell")).toBe('d angelo russell')
    expect(normalizeNbaName('Nikola Jokić')).toBe('nikola jokic')
  })

  it('maps Sleeper team codes to ESPN abbrs', () => {
    expect(sleeperNbaTeam('NOP')).toBe('NO')
    expect(sleeperNbaTeam('WAS')).toBe('WSH')
    expect(sleeperNbaTeam('LAL')).toBe('LAL')
    expect(sleeperNbaTeam(null)).toBeUndefined()
  })

  it('accepts only the two NBA scoring formats', () => {
    expect(isNbaScoring('points')).toBe(true)
    expect(isNbaScoring('category')).toBe(true)
    expect(isNbaScoring('ppr')).toBe(false)
  })
})

describe('stat line helpers', () => {
  it('makeStatLine falls back on GP and rejects empty totals', () => {
    expect(makeStatLine(undefined)).toBeUndefined()
    expect(makeStatLine({})).toBeUndefined()
    const noGp = makeStatLine({ [NBA_STAT.PTS]: 100 })
    expect(noGp?.gp).toBeGreaterThan(0)
    expect(perGame(noGp, NBA_STAT.PTS)).toBeCloseTo(100 / noGp!.gp, 9)
  })

  it('formats the per-game line in PTS/REB/AST/STL/BLK/3PM order', () => {
    const text = nbaStatLineText(starLine())
    expect(text).toContain('27.8 PTS')
    expect(text).toContain('11.1 REB')
    expect(text).toContain('8.3 AST')
    expect(text).toMatch(/STL.*BLK.*3PM/)
    expect(nbaStatLineText(undefined)).toBe('')
  })
})
