import { describe, it, expect } from 'vitest'
import {
  normalizeStatus,
  normalizeEvent,
  scoreToNumber,
  scoreToDisplay,
  groupGames,
  relevanceSort,
  toDateKey,
  shiftDateKey,
  dayLabel,
  formatClock,
  periodLabelFor,
  feedScore,
  parseRecord,
  attachStoryTeams,
  normalizeSportKey,
  type NormalizedGame,
} from '../models'

function rawEvent(overrides: Record<string, any> = {}) {
  return {
    id: '401772isolated',
    name: 'Chiefs at Bills',
    shortName: 'KC @ BUF',
    date: '2026-09-14T17:00:00Z',
    week: { number: 2, text: 'Week 2' },
    seasonType: { type: 2 },
    competitions: [
      {
        competitors: [
          {
            homeAway: 'away',
            score: '24',
            winner: true,
            team: { id: '12', abbreviation: 'KC', displayName: 'Kansas City Chiefs', logo: 'kc.png' },
            records: [{ name: 'overall', summary: '2-0' }],
          },
          {
            homeAway: 'home',
            score: { displayValue: '21' },
            winner: false,
            team: { id: '2', abbreviation: 'BUF', displayName: 'Buffalo Bills', logo: 'buf.png' },
          },
        ],
        status: {
          type: {
            id: '3',
            name: 'STATUS_FINAL',
            state: 'post',
            completed: true,
            description: 'Final',
            detail: 'Final',
            shortDetail: 'Final',
          },
        },
        venue: { fullName: 'Highmark Stadium', address: { city: 'Orchard Park', state: 'NY' } },
        broadcasts: [{ names: ['CBS'] }],
        odds: [
          {
            provider: { name: 'ESPN BET' },
            details: 'BUF -1.5',
            overUnder: '48.5',
            spread: -1.5,
            homeTeamOdds: { moneyLine: -120 },
            awayTeamOdds: { moneyLine: 100 },
          },
        ],
        ...overrides.competition,
      },
    ],
    ...overrides.event,
  }
}

describe('normalizeSportKey', () => {
  it('accepts case-insensitive sport keys', () => {
    expect(normalizeSportKey('nfl')).toBe('NFL')
    expect(normalizeSportKey('NBA')).toBe('NBA')
  })
  it('rejects unknown sports', () => {
    expect(normalizeSportKey('soccer')).toBeNull()
    expect(normalizeSportKey(null)).toBeNull()
  })
})

describe('scoreToNumber / scoreToDisplay', () => {
  it('handles plain-string scores', () => {
    expect(scoreToNumber('24')).toBe(24)
    expect(scoreToDisplay('24')).toBe('24')
  })
  it('handles object scores', () => {
    expect(scoreToNumber({ displayValue: '21' })).toBe(21)
    expect(scoreToDisplay({ displayValue: '21' })).toBe('21')
  })
  it('returns null for missing scores', () => {
    expect(scoreToNumber(null)).toBeNull()
    expect(scoreToNumber('')).toBeNull()
    expect(scoreToDisplay(undefined)).toBe('')
  })
})

describe('normalizeStatus', () => {
  it('maps pre state', () => {
    const s = normalizeStatus({ state: 'pre', completed: false, description: 'Sun 9/14' }, 'NFL')
    expect(s.phase).toBe('pre')
    expect(s.completed).toBe(false)
  })
  it('maps live state with clock and period', () => {
    const s = normalizeStatus(
      { state: 'in', completed: false, shortDetail: 'Q3 4:12' },
      'NFL',
      { displayClock: 252, period: 3 },
    )
    expect(s.phase).toBe('live')
    expect(s.clock).toBe('4:12')
    expect(s.period).toBe(3)
    expect(s.periodLabel).toBe('Q3')
  })
  it('maps completed/post to final', () => {
    const s = normalizeStatus({ state: 'post', completed: true, shortDetail: 'Final' }, 'NBA')
    expect(s.phase).toBe('final')
    expect(s.completed).toBe(true)
  })
  it('detects postponements and delays from text', () => {
    expect(normalizeStatus({ state: 'pre', description: 'Postponed' }, 'MLB').phase).toBe('postponed')
    expect(normalizeStatus({ state: 'pre', detail: 'Delayed - rain' }, 'MLB').phase).toBe('delayed')
  })
  it('never throws on odd shapes', () => {
    expect(normalizeStatus(null, 'NFL').phase).toBe('pre')
    expect(normalizeStatus(undefined, 'NHL').phase).toBe('pre')
  })
})

describe('formatClock', () => {
  it('formats seconds as M:SS', () => {
    expect(formatClock(252)).toBe('4:12')
    expect(formatClock(0)).toBe('0:00')
  })
  it('passes through clock strings', () => {
    expect(formatClock('4:12')).toBe('4:12')
  })
  it('returns null for junk', () => {
    expect(formatClock(null)).toBeNull()
    expect(formatClock('abc')).toBeNull()
  })
})

describe('periodLabelFor', () => {
  it('labels quarters and periods', () => {
    expect(periodLabelFor('NFL', 2)).toBe('Q2')
    expect(periodLabelFor('NHL', 1)).toBe('P1')
  })
  it('labels MLB innings with half', () => {
    expect(periodLabelFor('MLB', 7, { inningHalf: 'Top' })).toBe('Top 7')
    expect(periodLabelFor('MLB', 9, { inningHalf: 'Bottom' })).toBe('Bot 9')
  })
})

describe('normalizeEvent', () => {
  it('normalizes a full event', () => {
    const g = normalizeEvent('NFL', rawEvent())
    expect(g?.id).toBe('401772isolated')
    expect(g?.away.abbr).toBe('KC')
    expect(g?.away.score).toBe(24)
    expect(g?.home.score).toBe(21)
    expect(g?.status.phase).toBe('final')
    expect(g?.venueName).toBe('Highmark Stadium')
    expect(g?.venueCity).toBe('Orchard Park, NY')
    expect(g?.broadcast).toBe('CBS')
    expect(g?.weekText).toBe('Week 2')
    expect(g?.odds?.spread).toBe(-1.5)
    expect(g?.odds?.total).toBe(48.5)
    expect(g?.away.recordSummary).toBe('2-0')
  })
  it('returns null without a competition', () => {
    expect(normalizeEvent('NFL', { id: 'x' })).toBeNull()
    expect(normalizeEvent('NFL', null)).toBeNull()
  })
})

function game(id: string, phase: 'pre' | 'live' | 'final', date: string, away = 'KC', home = 'BUF'): NormalizedGame {
  return {
    id, sport: 'NFL', date, name: '', shortName: '', weekText: null, seasonType: 2,
    venueName: null, venueCity: null, broadcast: null,
    status: { phase, completed: phase === 'final', detail: '', shortDetail: '', clock: null, period: null, periodLabel: null },
    away: { id: 'a', abbr: away, name: away, logo: '', homeAway: 'away', score: phase === 'pre' ? null : 21, scoreDisplay: '', winner: null, recordSummary: null },
    home: { id: 'h', abbr: home, name: home, logo: '', homeAway: 'home', score: phase === 'pre' ? null : 20, scoreDisplay: '', winner: null, recordSummary: null },
    odds: null,
  }
}

describe('groupGames', () => {
  it('splits by phase with correct ordering', () => {
    const g = groupGames([
      game('f1', 'final', '2026-09-13T17:00:00Z'),
      game('u1', 'pre', '2026-09-15T17:00:00Z'),
      game('l1', 'live', '2026-09-14T17:00:00Z'),
      game('f2', 'final', '2026-09-14T20:00:00Z'),
    ])
    expect(g.live.map((x) => x.id)).toEqual(['l1'])
    expect(g.upcoming.map((x) => x.id)).toEqual(['u1'])
    // Most recent final first.
    expect(g.final.map((x) => x.id)).toEqual(['f2', 'f1'])
  })
})

describe('relevanceSort', () => {
  it('orders live > upcoming > final', () => {
    const sorted = relevanceSort([
      game('f', 'final', '2026-09-13T17:00:00Z'),
      game('u', 'pre', '2026-09-15T17:00:00Z'),
      game('l', 'live', '2026-09-14T17:00:00Z'),
    ])
    expect(sorted.map((x) => x.id)).toEqual(['l', 'u', 'f'])
  })
  it('boosts favorites within a bucket without filtering others', () => {
    const sorted = relevanceSort(
      [
        game('a', 'pre', '2026-09-15T17:00:00Z', 'KC', 'BUF'),
        game('b', 'pre', '2026-09-15T18:00:00Z', 'DAL', 'PHI'),
      ],
      new Set(['DAL']),
    )
    expect(sorted.map((x) => x.id)).toEqual(['b', 'a'])
  })
})

describe('date helpers', () => {
  it('round-trips date keys', () => {
    expect(toDateKey(new Date(2026, 8, 14))).toBe('20260914')
    expect(shiftDateKey('20260914', -1)).toBe('20260913')
    expect(shiftDateKey('20260914', 1)).toBe('20260915')
  })
  it('labels relative days', () => {
    const now = new Date(2026, 8, 14, 12)
    expect(dayLabel('20260914', now)).toBe('Today')
    expect(dayLabel('20260913', now)).toBe('Yesterday')
    expect(dayLabel('20260915', now)).toBe('Tomorrow')
    expect(dayLabel('20260920', now)).toContain('Sep')
  })
})

describe('feedScore', () => {
  it('decays old stories but keeps them positive', () => {
    const now = new Date('2026-09-14T12:00:00Z').getTime()
    const fresh = feedScore(80, '2026-09-14T11:00:00Z', now)
    const old = feedScore(80, '2026-09-01T11:00:00Z', now)
    expect(fresh).toBeGreaterThan(old)
    expect(old).toBeGreaterThan(0)
    // A fresh major story beats an old perfect one.
    expect(feedScore(70, '2026-09-14T11:00:00Z', now)).toBeGreaterThan(
      feedScore(100, '2026-09-01T11:00:00Z', now),
    )
  })
})

describe('parseRecord', () => {
  it('parses W-L and W-L-T', () => {
    expect(parseRecord('10-2')).toEqual({ wins: 10, losses: 2, ties: 0 })
    expect(parseRecord('8-8-1')).toEqual({ wins: 8, losses: 8, ties: 1 })
    expect(parseRecord('n/a')).toBeNull()
  })
})

describe('attachStoryTeams', () => {
  it('matches team nicknames in the text', () => {
    const s = attachStoryTeams({ title: 'Chiefs trade for star receiver', snippet: '', league: 'nfl' })
    expect(s.teamIds).toContain('kc')
  })
  it('ignores other leagues', () => {
    const s = attachStoryTeams({ title: 'Chiefs win again', snippet: '', league: 'nba' })
    expect(s.teamIds).not.toContain('kc')
  })
})
