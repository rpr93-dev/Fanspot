import {
  isOutTier,
  isRosterOut,
  parseAttempts,
  parseRosterInjuries,
  teamQbs,
} from '@/lib/injury'

describe('injury tiers', () => {
  it('swaps only on out', () => {
    expect(isOutTier('out')).toBe(true)
    expect(isOutTier('Out')).toBe(true)
    expect(isOutTier('doubtful')).toBe(false)
    expect(isOutTier('questionable')).toBe(false)
    expect(isOutTier('healthy')).toBe(false)
    expect(isOutTier(null)).toBe(false)
  })
  it('recognizes roster out statuses', () => {
    expect(isRosterOut('Out')).toBe(true)
    expect(isRosterOut('IR')).toBe(true)
    expect(isRosterOut('Questionable')).toBe(false)
    expect(isRosterOut('Active')).toBe(false)
  })
})

describe('parseRosterInjuries', () => {
  it('flattens injury entries', () => {
    const roster = {
      athletes: [
        { displayName: 'Sam Darnold', injuries: [{ status: 'Questionable', date: '2026-09-10T00:47Z' }] },
        { displayName: 'Healthy Guy', injuries: [] },
        { displayName: 'No Key Guy' },
      ],
    }
    expect(parseRosterInjuries(roster)).toEqual([
      { name: 'Sam Darnold', status: 'Questionable', date: '2026-09-10T00:47Z' },
    ])
  })
  it('tolerates garbage', () => {
    expect(parseRosterInjuries(null)).toEqual([])
    expect(parseRosterInjuries({})).toEqual([])
  })
})

describe('parseAttempts', () => {
  it('parses C/ATT splits', () => {
    expect(parseAttempts('17/32')).toBe(32)
    expect(parseAttempts('4/9')).toBe(9)
    expect(parseAttempts('0/0')).toBe(0)
  })
  it('passes plain numbers through', () => {
    expect(parseAttempts('12')).toBe(12)
    expect(parseAttempts(7)).toBe(7)
    expect(parseAttempts('')).toBe(null)
    expect(parseAttempts('--')).toBe(null)
    expect(parseAttempts(null)).toBe(null)
  })
})

describe('teamQbs', () => {
  const bs = {
    playerStats: [
      {
        teamAbbr: 'SEA',
        categories: [
          {
            label: 'Passing',
            athletes: [
              { displayName: 'Sam Darnold', stats: { 'C/ATT': '4/9', YDS: '62', TD: '0' } },
              { displayName: 'Drew Lock', stats: { 'C/ATT': '11/15', YDS: '118', TD: '1' } },
            ],
          },
        ],
      },
      { teamAbbr: 'NE', categories: [] },
    ],
  }
  it('lists QBs by attempts desc', () => {
    expect(teamQbs(bs, 'SEA')).toEqual([
      { name: 'Drew Lock', attempts: 15, yards: 118 },
      { name: 'Sam Darnold', attempts: 9, yards: 62 },
    ])
  })
  it('scopes to the team', () => {
    expect(teamQbs(bs, 'NE')).toEqual([])
    expect(teamQbs(bs, 'sea')).toHaveLength(2)
  })
})
