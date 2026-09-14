import { describe, it, expect } from 'vitest'
import {
  barShares,
  isMissingRow,
  parseCompoundPart,
  parseStatNumeric,
} from '../stat-value'
import { numericForStat } from '../GameStatsSection'

describe('parseStatNumeric', () => {
  it('parses plain integers and decimals', () => {
    expect(parseStatNumeric('72')).toBe(72)
    expect(parseStatNumeric('312')).toBe(312)
    expect(parseStatNumeric('4.8')).toBeCloseTo(4.8)
    expect(parseStatNumeric('1,234')).toBe(1234)
  })

  it('parses percentages as magnitudes', () => {
    expect(parseStatNumeric('67%')).toBe(67)
    expect(parseStatNumeric('40%')).toBe(40)
  })

  it('parses time of possession into seconds', () => {
    expect(parseStatNumeric('7:26')).toBe(7 * 60 + 26)
    expect(parseStatNumeric('7:34')).toBe(7 * 60 + 34)
    // ordering preserved: 7:34 > 7:26
    expect(parseStatNumeric('7:34')! > parseStatNumeric('7:26')!).toBe(true)
  })

  it('parses ratios as efficiency', () => {
    const a = parseStatNumeric('4/10')
    const b = parseStatNumeric('7/10')
    expect(a).toBeCloseTo(40)
    expect(b).toBeCloseTo(70)
    expect(b! > a!).toBe(true)
  })

  it('returns null for missing/malformed input without NaN', () => {
    for (const bad of [null, undefined, '', '-', '--', 'n/a', 'N/A', 'abc']) {
      const v = parseStatNumeric(bad as any)
      expect(v == null || Number.isFinite(v)).toBe(true)
      if (bad !== 'abc') expect(v).toBeNull()
    }
    expect(parseStatNumeric('abc')).toBeNull()
  })

  it('handles negative values finitely', () => {
    const v = parseStatNumeric('-3')
    expect(v).toBe(-3)
    expect(Number.isFinite(v!)).toBe(true)
  })
})

describe('barShares', () => {
  it('splits proportionally for uneven values (10 vs 90)', () => {
    const { awayShare, homeShare } = barShares(10, 90)
    expect(awayShare).toBeCloseTo(0.1)
    expect(homeShare).toBeCloseTo(0.9)
    expect(awayShare + homeShare).toBeCloseTo(1)
  })

  it('gives the 51-yard team substantially more than 26 yards', () => {
    const { awayShare, homeShare } = barShares(26, 51)
    expect(homeShare).toBeGreaterThan(awayShare)
    expect(homeShare).toBeCloseTo(51 / 77)
  })

  it('returns 50/50 for 0 vs 0 and null vs null', () => {
    expect(barShares(0, 0)).toEqual({ awayShare: 0.5, homeShare: 0.5 })
    expect(barShares(null, null)).toEqual({ awayShare: 0.5, homeShare: 0.5 })
  })

  it('keeps a minimum visible sliver for shutouts', () => {
    const { awayShare, homeShare } = barShares(0, 14)
    expect(awayShare).toBeGreaterThan(0)
    expect(awayShare).toBeLessThan(homeShare)
    expect(awayShare + homeShare).toBeCloseTo(1)
    const flipped = barShares(14, 0)
    expect(flipped.homeShare).toBeGreaterThan(0)
    expect(flipped.awayShare).toBeGreaterThan(flipped.homeShare)
  })

  it('never emits NaN or Infinity', () => {
    const cases: [number | null, number | null][] = [
      [null, 5],
      [5, null],
      [null, null],
      [0, 0],
      [-5, 10],
      [-8, -3],
      [Infinity as any, 10],
      [NaN as any, NaN as any],
    ]
    for (const [a, h] of cases) {
      const { awayShare, homeShare } = barShares(a, h)
      expect(Number.isFinite(awayShare)).toBe(true)
      expect(Number.isFinite(homeShare)).toBe(true)
      expect(awayShare).toBeGreaterThanOrEqual(0)
      expect(homeShare).toBeGreaterThanOrEqual(0)
      expect(awayShare + homeShare).toBeCloseTo(1)
    }
  })
})

describe('parseCompoundPart', () => {
  it('takes the requested side of dash/slash compounds', () => {
    expect(parseCompoundPart('5-60', 'second')).toBe(60)
    expect(parseCompoundPart('5-60', 'first')).toBe(5)
    expect(parseCompoundPart('1-8', 'first')).toBe(1)
    expect(parseCompoundPart('17/32', 'second')).toBe(32)
  })

  it('returns null for non-compounds without NaN', () => {
    expect(parseCompoundPart('72', 'first')).toBeNull()
    expect(parseCompoundPart('', 'second')).toBeNull()
  })
})

describe('numericForStat', () => {
  it('compares penalty yards, not penalty count', () => {
    // 5 penalties for 60 yards vs 8 for 55: the bar should favor 60 yards.
    expect(numericForStat('totalPenaltiesYards', '5-60')).toBe(60)
    expect(numericForStat('totalPenaltiesYards', '8-55')).toBe(55)
  })

  it('compares sack count for sacks-yards-lost', () => {
    expect(numericForStat('sacksYardsLost', '1-8')).toBe(1)
  })

  it('compares down efficiency for convertible downs', () => {
    expect(numericForStat('thirdDownEff', '7-14')).toBeCloseTo(50)
    expect(numericForStat('completionAttempts', '17/32')).toBeCloseTo((17 / 32) * 100)
  })

  it('falls back to generic parsing for ordinary stats', () => {
    expect(numericForStat('totalYards', '260')).toBe(260)
    expect(numericForStat('possessionTime', '24:48')).toBe(24 * 60 + 48)
    expect(numericForStat('totalYards', null)).toBeNull()
  })
})

describe('isMissingRow', () => {
  it('detects empty rows', () => {
    expect(isMissingRow(null, null)).toBe(true)
    expect(isMissingRow('-', '-')).toBe(true)
    expect(isMissingRow('', '')).toBe(true)
    expect(isMissingRow('42', null)).toBe(false)
    expect(isMissingRow(null, '72')).toBe(false)
  })
})
