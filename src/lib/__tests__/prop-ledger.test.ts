import { extractLiveStats, quartersPlayed, isGameComplete, namesMatch } from '@/lib/propLedger'

/** Minimal /api/box-score-shaped fixture (labels as the route emits them). */
function boxScore() {
  return {
    status: { state: 'in', shortDetail: '2ND 8:13', description: '2nd & 8:13' },
    teams: [
      { abbreviation: 'NE', linescores: [7, 3] },
      { abbreviation: 'NYJ', linescores: [0, 7] },
    ],
    playerStats: [
      {
        teamAbbr: 'NE',
        categories: [
          {
            label: 'Passing',
            athletes: [
              { displayName: 'Drake Maye', stats: { 'C/ATT': '17/32', YDS: '167', AVG: '5.2', TD: '3', INT: '0' } },
            ],
          },
          {
            label: 'Rushing',
            athletes: [
              { displayName: 'Drake Maye', stats: { CAR: '5', YDS: '39', AVG: '7.8', TD: '0' } },
              { displayName: 'Rhamondre Stevenson', stats: { CAR: '14', YDS: '37', AVG: '2.6', TD: '0' } },
            ],
          },
          {
            label: 'Receiving',
            athletes: [
              { displayName: 'Stefon Diggs', stats: { REC: '5', YDS: '51', AVG: '10.2', TD: '0', TGTS: '8' } },
              { displayName: 'Rhamondre Stevenson', stats: { REC: '2', YDS: '14', AVG: '7.0', TD: '1', TGTS: '3' } },
            ],
          },
        ],
      },
      { teamAbbr: 'NYJ', categories: [] },
    ],
  }
}

describe('namesMatch', () => {
  it('matches exact and suffix variants', () => {
    expect(namesMatch('Drake Maye', 'Drake Maye')).toBe(true)
    expect(namesMatch('Michael Pittman', 'Michael Pittman Jr')).toBe(true)
  })
  it('rejects shared-last-name collisions', () => {
    expect(namesMatch('Bijan Robinson', 'Brian Robinson')).toBe(false)
  })
  it('matches single-token abbreviations', () => {
    expect(namesMatch('T.Tagovailoa', 'Tua Tagovailoa')).toBe(true)
  })
})

describe('extractLiveStats', () => {
  it('maps ESPN labels to model stat keys', () => {
    const live = extractLiveStats(boxScore(), [{ name: 'Drake Maye' }, { name: 'Stefon Diggs' }])
    expect(live['Drake Maye'].passing_yards).toBe(167)
    expect(live['Drake Maye'].rushing_yards).toBe(39)
    expect(live['Drake Maye'].tds).toBe(3) // 3 pass + 0 rush
    expect(live['Stefon Diggs'].receiving_yards).toBe(51)
    expect(live['Stefon Diggs'].receptions).toBe(5)
    expect(live['Stefon Diggs'].tds).toBe(0)
  })
  it('sums TDs across categories', () => {
    const live = extractLiveStats(boxScore(), [{ name: 'Rhamondre Stevenson' }])
    expect(live['Rhamondre Stevenson'].rushing_yards).toBe(37)
    expect(live['Rhamondre Stevenson'].receptions).toBe(2)
    expect(live['Rhamondre Stevenson'].tds).toBe(1)
  })
  it('returns nulls for players absent from the box score', () => {
    const live = extractLiveStats(boxScore(), [{ name: 'Nobody Inactive' }])
    expect(live['Nobody Inactive']).toEqual({
      passing_yards: null, rushing_yards: null, receiving_yards: null,
      receptions: null, tds: null,
    })
  })
})

describe('quartersPlayed / isGameComplete', () => {
  it('reads quarters from linescores', () => {
    expect(quartersPlayed(boxScore())).toBe(2)
    expect(quartersPlayed({ teams: [] })).toBe(0)
    expect(quartersPlayed(null)).toBe(0)
  })
  it('detects completed games', () => {
    expect(isGameComplete(boxScore())).toBe(false)
    expect(isGameComplete({ status: { state: 'post' } })).toBe(true)
    expect(isGameComplete({ status: { state: 'in', shortDetail: 'Final' } })).toBe(true)
  })
})
