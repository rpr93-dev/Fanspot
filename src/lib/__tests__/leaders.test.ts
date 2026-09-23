import { describe, it, expect } from 'vitest'
import {
  LEADER_CATEGORIES,
  formatLeaderValue,
  leadersSeasonYear,
  parseAthleteId,
  parseTeamRefId,
} from '../leaders'

describe('parseAthleteId', () => {
  it('extracts the id from an athlete $ref', () => {
    expect(
      parseAthleteId('http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/athletes/4360689?lang=en&region=us'),
    ).toBe('4360689')
  })
  it('returns null for junk', () => {
    expect(parseAthleteId(null)).toBeNull()
    expect(parseAthleteId('http://example.com/teams/5')).toBeNull()
  })
})

describe('parseTeamRefId', () => {
  it('extracts the id from a team $ref', () => {
    expect(
      parseTeamRefId('http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/teams/18?lang=en&region=us'),
    ).toBe('18')
  })
  it('returns null for junk', () => {
    expect(parseTeamRefId(undefined)).toBeNull()
  })
})

describe('leadersSeasonYear', () => {
  it('follows season boundaries', () => {
    expect(leadersSeasonYear('NFL', new Date(2026, 8, 14))).toBe(2026) // Sep
    expect(leadersSeasonYear('NFL', new Date(2026, 2, 1))).toBe(2025) // Mar
    // NBA/NHL seasons are labeled by their ending year (2025-26 = 2026).
    expect(leadersSeasonYear('NBA', new Date(2026, 8, 14))).toBe(2026) // Sep: 2025-26 just ended
    expect(leadersSeasonYear('NBA', new Date(2026, 10, 15))).toBe(2027) // Nov: 2026-27 underway
    expect(leadersSeasonYear('NHL', new Date(2027, 1, 1))).toBe(2027) // Feb: 2026-27 mid-season
    expect(leadersSeasonYear('MLB', new Date(2026, 8, 14))).toBe(2026)
  })
})

describe('formatLeaderValue', () => {
  it('keeps clean displays as-is', () => {
    expect(formatLeaderValue('passingYards', '410', 410)).toBe('410')
    expect(formatLeaderValue('pointsPerGame', '32.7', 32.7)).toBe('32.7')
  })
  it('collapses composite baseball lines to precise numbers', () => {
    expect(formatLeaderValue('avg', '177-565, 6 HR, 7 3B', 0.31327)).toBe('.313')
    expect(formatLeaderValue('ERA', '184.2 IP, 40 ER', 1.95)).toBe('1.95')
    expect(formatLeaderValue('homeRuns', '129-541, 44 HR', 44)).toBe('44')
    expect(formatLeaderValue('strikeouts', '166.1 IP, 236 K', 236)).toBe('236')
  })
})

describe('LEADER_CATEGORIES', () => {
  it('defines leaders for every sport', () => {
    for (const sport of ['NFL', 'NBA', 'NHL', 'MLB'] as const) {
      expect(LEADER_CATEGORIES[sport].length).toBeGreaterThanOrEqual(5)
      for (const c of LEADER_CATEGORIES[sport]) {
        expect(c.key.length).toBeGreaterThan(0)
        expect(c.label.length).toBeGreaterThan(0)
      }
    }
  })
  it('matches the task brief categories', () => {
    const keys = (s: 'NFL' | 'NBA' | 'NHL' | 'MLB') => LEADER_CATEGORIES[s].map((c) => c.key)
    expect(keys('NFL')).toContain('passingYards')
    expect(keys('NFL')).toContain('sacks')
    expect(keys('NBA')).toContain('pointsPerGame')
    expect(keys('NHL')).toContain('goals')
    expect(keys('MLB')).toContain('homeRuns')
    expect(keys('MLB')).toContain('ERA')
  })
})
