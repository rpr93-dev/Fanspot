import { describe, it, expect } from 'vitest'
import {
  normalizeStandingsChildren,
  groupStandingsRows,
  statMapOf,
  STANDINGS_COLUMNS,
} from '../standings'

const nflChildren = [
  {
    name: 'American Football Conference',
    abbreviation: 'AFC',
    standings: {
      entries: [
        {
          team: { abbreviation: 'BAL', displayName: 'Baltimore Ravens', logos: [{ href: 'bal.png' }] },
          stats: [
            { name: 'wins', displayValue: '1' },
            { name: 'losses', displayValue: '0' },
            { name: 'ties', displayValue: '0' },
            { name: 'winPercent', displayValue: '1.000' },
            { name: 'pointsFor', displayValue: '41' },
            { name: 'pointsAgainst', displayValue: '23' },
            { name: 'streak', displayValue: 'W1' },
          ],
        },
        {
          team: { abbreviation: 'KC', displayName: 'Kansas City Chiefs', logos: [{ href: 'kc.png' }] },
          stats: [
            { name: 'wins', displayValue: '0' },
            { name: 'losses', displayValue: '1' },
            { name: 'ties', displayValue: '0' },
            { name: 'winPercent', displayValue: '.000' },
            { name: 'pointsFor', displayValue: '20' },
            { name: 'pointsAgainst', displayValue: '27' },
            { name: 'streak', displayValue: 'L1' },
          ],
        },
      ],
    },
  },
]

describe('statMapOf', () => {
  it('maps name -> displayValue', () => {
    expect(statMapOf([{ name: 'wins', displayValue: '90' }])).toEqual({ wins: '90' })
    expect(statMapOf(null as any)).toEqual({})
  })
})

describe('normalizeStandingsChildren', () => {
  it('normalizes rows with grouping keys and computed records', () => {
    const rows = normalizeStandingsChildren(nflChildren, 'NFL')
    expect(rows).toHaveLength(2)
    const bal = rows.find((r) => r.abbr === 'BAL')!
    expect(bal.name).toBe('Baltimore Ravens')
    expect(bal.teamId).toBe('bal')
    expect(bal.conference).toBe('AFC')
    expect(bal.division).toBe('North')
    expect(bal.wins).toBe(1)
    expect(bal.pct).toBe(1)
    expect(bal.extra.record).toBe('1-0')
    expect(bal.extra.streak).toBe('W1')
  })

  it('handles missing stats gracefully', () => {
    const rows = normalizeStandingsChildren(
      [{ standings: { entries: [{ team: { abbreviation: 'XX' }, stats: [] }] } }],
      'NBA',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].wins).toBeNull()
    expect(rows[0].conference).toBe('')
  })

  it('skips entries without abbreviations', () => {
    const rows = normalizeStandingsChildren(
      [{ standings: { entries: [{ team: {}, stats: [] }] } }],
      'MLB',
    )
    expect(rows).toHaveLength(0)
  })
})

describe('groupStandingsRows', () => {
  it('groups by conference/division sorted by pct', () => {
    const rows = normalizeStandingsChildren(nflChildren, 'NFL')
    const groups = groupStandingsRows(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('AFC')
    const north = groups[0].divisions.find((d) => d.name === 'North')!
    expect(north.teams[0].abbr).toBe('BAL')
    const west = groups[0].divisions.find((d) => d.name === 'West')!
    expect(west.teams[0].abbr).toBe('KC')
  })
})

describe('STANDINGS_COLUMNS', () => {
  it('covers all sports with record first', () => {
    for (const sport of ['NFL', 'NBA', 'NHL', 'MLB'] as const) {
      expect(STANDINGS_COLUMNS[sport].length).toBeGreaterThan(0)
      expect(STANDINGS_COLUMNS[sport][0].key).toBe('record')
    }
  })
})
