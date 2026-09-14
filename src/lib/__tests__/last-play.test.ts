import { describe, it, expect } from 'vitest'
import { extractLastPlay, formatDownDistance, formatLastPlayMeta } from '../lastPlay'

function play(text: string, overrides: Record<string, any> = {}) {
  return {
    text,
    period: { number: 2 },
    clock: { displayValue: '0:17' },
    scoringPlay: false,
    start: { down: 2, distance: 7 },
    ...overrides,
  }
}

const summary = {
  drives: {
    current: {
      team: { abbreviation: 'SEA' },
      plays: [play('First play'), play('Latest play')],
    },
    previous: [{ team: { abbreviation: 'NE' }, plays: [play('Old play')] }],
  },
}

describe('extractLastPlay', () => {
  it('takes the last play of the ongoing drive', () => {
    const lp = extractLastPlay(summary)
    expect(lp?.text).toBe('Latest play')
    expect(lp?.period).toBe(2)
    expect(lp?.clock).toBe('0:17')
    expect(lp?.down).toBe(2)
    expect(lp?.distance).toBe(7)
    expect(lp?.possessionAbbr).toBe('SEA')
    expect(lp?.scoringPlay).toBe(false)
  })

  it('falls back to the most recent completed drive when current has no plays', () => {
    const lp = extractLastPlay({
      drives: {
        current: { team: { abbreviation: 'SEA' }, plays: [] },
        previous: [
          { team: { abbreviation: 'NE' }, plays: [play('Old play', { text: 'Old play' })] },
          { team: { abbreviation: 'NE' }, plays: [] },
        ],
      },
    })
    expect(lp?.text).toBe('Old play')
    expect(lp?.possessionAbbr).toBe('NE')
  })

  it('returns null when there is no usable play-by-play, never throws', () => {
    expect(extractLastPlay(null)).toBeNull()
    expect(extractLastPlay({})).toBeNull()
    expect(extractLastPlay({ drives: {} })).toBeNull()
    expect(extractLastPlay({ drives: { current: { plays: [{ text: '  ' }] } } })).toBeNull()
    expect(extractLastPlay({ drives: { current: 'garbage' } })).toBeNull()
  })

  it('flags scoring plays', () => {
    const lp = extractLastPlay({
      drives: { current: { plays: [play('Touchdown!', { scoringPlay: true })] } },
    })
    expect(lp?.scoringPlay).toBe(true)
  })

  it('captures field position from the play start', () => {
    const lp = extractLastPlay({
      drives: {
        current: {
          team: { abbreviation: 'NE' },
          plays: [
            play('D.Maye pass short left to R.Stevenson pushed ob at NE 44 for 17 yards (E.Jones).', {
              start: {
                down: 1,
                distance: 15,
                yardLine: 73,
                yardsToEndzone: 73,
                downDistanceText: '1st & 15 at NE 27',
                possessionText: 'NE 27',
              },
            }),
          ],
        },
      },
    })
    expect(lp?.yardLine).toBe(73)
    expect(lp?.spot).toBe('NE 27')
  })

  it('leaves field position null when the feed has none', () => {
    const lp = extractLastPlay(summary)
    expect(lp?.yardLine).toBeNull()
    expect(lp?.spot).toBeNull()
  })

  it('clamps absurd yardage into the 0-100 field', () => {
    const lp = extractLastPlay({
      drives: { current: { plays: [play('Weird play', { start: { down: 1, distance: 10, yardsToEndzone: 140 } })] } },
    })
    expect(lp?.yardLine).toBe(100)
  })
})

describe('formatDownDistance', () => {
  it('formats ordinals', () => {
    expect(formatDownDistance(1, 10)).toBe('1st & 10')
    expect(formatDownDistance(2, 7)).toBe('2nd & 7')
    expect(formatDownDistance(3, 1)).toBe('3rd & 1')
    expect(formatDownDistance(4, 2)).toBe('4th & 2')
  })

  it('returns null for non-scrimmage plays', () => {
    expect(formatDownDistance(0, 0)).toBeNull()
    expect(formatDownDistance(null, 7)).toBeNull()
    expect(formatDownDistance(2, null)).toBeNull()
  })
})

describe('formatLastPlayMeta', () => {
  it('composes period, clock, down and possession', () => {
    const lp = extractLastPlay(summary)!
    expect(formatLastPlayMeta(lp, 'Q')).toBe('Q2 · 0:17 · 2nd & 7 · SEA ball')
  })

  it('returns null when nothing contextual is known', () => {
    expect(
      formatLastPlayMeta(
        { text: 'x', period: null, clock: null, scoringPlay: false, down: null, distance: null, possessionAbbr: null },
        'Q',
      ),
    ).toBeNull()
  })
})
