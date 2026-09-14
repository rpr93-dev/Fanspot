import { describe, it, expect } from 'vitest'
import {
  dispScore,
  isPrimetime,
  isLiveGame,
  isFinalGame,
  liveSideStats,
  nflSeasonYear,
  LIVE_STAT_ROWS,
} from '../scheduleWeek'

const ev = (state: string, completed = false) => ({
  competitions: [{ status: { type: { state, completed } } }],
})

describe('dispScore', () => {
  it('reads plain-string and object score shapes', () => {
    expect(dispScore('27')).toBe('27')
    expect(dispScore({ displayValue: '27' })).toBe('27')
    expect(dispScore(null)).toBe('')
    expect(dispScore(undefined)).toBe('')
  })
})

describe('game state helpers', () => {
  it('classifies live / final / pre', () => {
    expect(isLiveGame(ev('in'))).toBe(true)
    expect(isLiveGame(ev('pre'))).toBe(false)
    expect(isFinalGame(ev('post', true))).toBe(true)
    expect(isFinalGame(ev('pre'))).toBe(false)
    expect(isFinalGame(ev('in'))).toBe(false)
    expect(isLiveGame({})).toBe(false)
    expect(isFinalGame(undefined)).toBe(false)
  })
})

describe('nflSeasonYear', () => {
  it('attributes Jan/Feb to the prior season', () => {
    expect(nflSeasonYear(new Date(2026, 0, 15))).toBe(2025)
    expect(nflSeasonYear(new Date(2026, 1, 1))).toBe(2025)
    expect(nflSeasonYear(new Date(2026, 8, 10))).toBe(2026)
    expect(nflSeasonYear(new Date(2026, 11, 31))).toBe(2026)
  })
})

describe('isPrimetime', () => {
  it('flags Sunday night (8:20 PM ET kickoff)', () => {
    const game = new Date(Date.UTC(2026, 8, 14, 0, 20)) // Mon 00:20 UTC = Sun 20:20 ET
    expect(isPrimetime(game.toISOString())).toBe(true)
  })
  it('flags Monday night and Thursday night', () => {
    expect(isPrimetime('2026-09-15T00:15:00Z')).toBe(true) // Mon 8:15 PM ET
    expect(isPrimetime('2026-09-11T00:35:00Z')).toBe(true) // Fri 00:35 UTC -> Thu 8:35 PM ET
  })
  it('rejects Sunday afternoon slots', () => {
    expect(isPrimetime('2026-09-13T17:00:00Z')).toBe(false) // Sun 1 PM ET
  })
  it('survives garbage input', () => {
    expect(isPrimetime('not-a-date')).toBe(false)
  })
})

describe('liveSideStats', () => {
  const boxscore = {
    teams: [
      {
        homeAway: 'away',
        statistics: [
          { name: 'totalYards', displayValue: '257' },
          { name: 'possessionTime', displayValue: '18:19' },
        ],
      },
      {
        homeAway: 'home',
        statistics: [{ name: 'totalYards', displayValue: '180' }],
      },
    ],
  }

  it('maps away/home stat maps by name', () => {
    const sides = liveSideStats(boxscore)
    expect(sides?.away.totalYards).toBe('257')
    expect(sides?.home.totalYards).toBe('180')
    expect(sides?.home.possessionTime ?? '').toBe('')
  })

  it('returns null without two-sided data', () => {
    expect(liveSideStats(null)).toBeNull()
    expect(liveSideStats({ teams: [{ homeAway: 'away' }] })).toBeNull()
  })

  it('has a fixed live row set with keys matching ESPN stat names', () => {
    const keys = LIVE_STAT_ROWS.map((r) => r.key)
    expect(keys).toContain('totalYards')
    expect(keys).toContain('thirdDownEff')
  })
})
