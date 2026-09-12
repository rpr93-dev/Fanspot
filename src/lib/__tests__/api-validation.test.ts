import { describe, it, expect } from 'vitest'
import {
  isValidTeam,
  isValidSeason,
  isValidDate,
  isValidEventId,
  isAllowedSport,
  isKnownEspnSport,
  isValidDateRange,
} from '@/lib/api-validation'

describe('isValidTeam', () => {
  it('accepts 2-4 char alnum abbreviations, case-insensitive', () => {
    expect(isValidTeam('NE')).toBe(true)
    expect(isValidTeam('ne')).toBe(true)
    expect(isValidTeam('LV')).toBe(true)
    expect(isValidTeam('LAC')).toBe(true)
    expect(isValidTeam('WSH')).toBe(true)
    expect(isValidTeam('10')).toBe(true)
  })
  it('rejects wrong lengths and shapes', () => {
    expect(isValidTeam('N')).toBe(false)
    expect(isValidTeam('ABCDE')).toBe(false)
    expect(isValidTeam('')).toBe(false)
    expect(isValidTeam('New England')).toBe(false)
    expect(isValidTeam('ne;rm')).toBe(false)
    expect(isValidTeam('../../etc/passwd')).toBe(false)
    expect(isValidTeam(null)).toBe(false)
    expect(isValidTeam(undefined)).toBe(false)
    expect(isValidTeam(123)).toBe(false)
  })
})

describe('isValidSeason', () => {
  it('accepts YYYY', () => {
    expect(isValidSeason('2026')).toBe(true)
    expect(isValidSeason('1999')).toBe(true)
  })
  it('rejects everything else', () => {
    expect(isValidSeason('26')).toBe(false)
    expect(isValidSeason('20261')).toBe(false)
    expect(isValidSeason('20-6')).toBe(false)
    expect(isValidSeason('')).toBe(false)
    expect(isValidSeason(null)).toBe(false)
  })
})

describe('isValidDate', () => {
  it('accepts YYYYMMDD', () => {
    expect(isValidDate('20260913')).toBe(true)
  })
  it('rejects separators and wrong lengths', () => {
    expect(isValidDate('2026-09-13')).toBe(false)
    expect(isValidDate('2026091')).toBe(false)
    expect(isValidDate('202609131')).toBe(false)
    expect(isValidDate('')).toBe(false)
    expect(isValidDate(undefined)).toBe(false)
  })
})

describe('isValidEventId', () => {
  it('accepts numeric ids', () => {
    expect(isValidEventId('401351234')).toBe(true)
    expect(isValidEventId('1')).toBe(true)
  })
  it('rejects non-numerics', () => {
    expect(isValidEventId('abc')).toBe(false)
    expect(isValidEventId('401.5')).toBe(false)
    expect(isValidEventId('-4')).toBe(false)
    expect(isValidEventId('401 35')).toBe(false)
    expect(isValidEventId('')).toBe(false)
    expect(isValidEventId(null)).toBe(false)
  })
})

describe('isAllowedSport / isKnownEspnSport', () => {
  it('allowlists the four sports, case-insensitive', () => {
    for (const s of ['nfl', 'NBA', 'Nhl', 'MLB']) {
      expect(isAllowedSport(s)).toBe(true)
      expect(isKnownEspnSport(s)).toBe(true)
    }
  })
  it('rejects unknown and empty sports', () => {
    expect(isAllowedSport('soccer')).toBe(false)
    expect(isAllowedSport('')).toBe(false)
    expect(isAllowedSport('../evil')).toBe(false)
    expect(isAllowedSport(null)).toBe(false)
  })
  it('internal espn extra sports pass isKnownEspnSport only', () => {
    expect(isKnownEspnSport('NBA_SUMMER')).toBe(true)
    expect(isAllowedSport('NBA_SUMMER')).toBe(false)
  })
})

describe('isValidDateRange', () => {
  it('accepts YYYYMM, YYYYMMDD, and ranges of both', () => {
    expect(isValidDateRange('202609')).toBe(true)
    expect(isValidDateRange('20260913')).toBe(true)
    expect(isValidDateRange('20260901-20260930')).toBe(true)
    expect(isValidDateRange('20260101-20270228')).toBe(true)
    expect(isValidDateRange('20261001-202610')).toBe(true)
  })
  it('rejects injection and malformed values', () => {
    expect(isValidDateRange('2026-09-13')).toBe(false)
    expect(isValidDateRange('20260')).toBe(false)
    expect(isValidDateRange('202609133')).toBe(false)
    expect(isValidDateRange('202609-')).toBe(false)
    expect(isValidDateRange('*&limit=999')).toBe(false)
    expect(isValidDateRange('')).toBe(false)
    expect(isValidDateRange(undefined)).toBe(false)
  })
})
