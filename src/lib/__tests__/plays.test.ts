import { describe, it, expect } from 'vitest'
import { normalizePlays, classifyHighlight } from '../plays'

function nflPlay(text: string, overrides: Record<string, any> = {}) {
  return {
    id: 'p1',
    text,
    period: { number: 2 },
    clock: { displayValue: '4:12' },
    scoringPlay: false,
    start: { down: 2, distance: 7, possessionText: 'KC 27' },
    team: { abbreviation: 'KC' },
    ...overrides,
  }
}

describe('normalizePlays (NFL drives)', () => {
  it('flattens previous + current drives chronologically', () => {
    const plays = normalizePlays('NFL', {
      drives: {
        previous: [
          { team: { abbreviation: 'KC' }, plays: [nflPlay('First'), nflPlay('Second')] },
        ],
        current: { team: { abbreviation: 'BUF' }, plays: [nflPlay('Latest', { team: { abbreviation: 'BUF' } })] },
      },
    })
    expect(plays.map((p) => p.text)).toEqual(['First', 'Second', 'Latest'])
    expect(plays[0].teamAbbr).toBe('KC')
    expect(plays[2].teamAbbr).toBe('BUF')
    expect(plays[0].periodLabel).toBe('Q2')
    expect(plays[0].clock).toBe('4:12')
    expect(plays[0].detail).toBe('2nd & 7 · KC 27')
  })

  it('flags scoring plays and big moments', () => {
    const plays = normalizePlays('NFL', {
      drives: {
        previous: [],
        current: {
          team: { abbreviation: 'KC' },
          plays: [
            nflPlay('Patrick Mahomes pass complete to Travis Kelce for 25 yds for a TD', { scoringPlay: true }),
            nflPlay('Josh Allen pass intercepted by Trent McDuffie'),
            nflPlay('Incomplete pass'),
          ],
        },
      },
    })
    expect(plays[0].highlight).toBe(true)
    expect(plays[0].scoring).toBe(true)
    expect(plays[1].highlight).toBe(true)
    expect(plays[2].highlight).toBe(false)
  })

  it('returns [] when there is no play data', () => {
    expect(normalizePlays('NFL', {})).toEqual([])
    expect(normalizePlays('NFL', null)).toEqual([])
    expect(normalizePlays('MLB', {})).toEqual([])
  })
})

describe('normalizePlays (details fallback)', () => {
  it('reads generic details entries', () => {
    const plays = normalizePlays('NBA', {
      details: [
        { id: 'd1', text: 'Jayson Tatum makes 3-pt jump shot', scoringPlay: true, period: 4, clock: '0:32', team: { abbreviation: 'BOS' } },
        { id: 'd2', text: '', type: { text: 'Foul on Jaylen Brown' } },
      ],
    })
    expect(plays).toHaveLength(2)
    expect(plays[0].highlight).toBe(true)
    expect(plays[0].periodLabel).toBe('Q4')
    expect(plays[1].text).toBe('Foul on Jaylen Brown')
  })
})

describe('classifyHighlight', () => {
  it('matches big-event keywords', () => {
    expect(classifyHighlight('Aaron Judge hits a home run', false)).toBe(true)
    expect(classifyHighlight('Ejected from the game', false)).toBe(true)
    expect(classifyHighlight('5-yard run up the middle', false)).toBe(false)
    expect(classifyHighlight('Anything', true)).toBe(true)
  })
})
