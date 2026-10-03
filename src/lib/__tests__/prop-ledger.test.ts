import { extractLiveStats, quartersPlayed, isGameComplete, namesMatch, findAthleteByName, periodsPlayed, periodLabel } from '@/lib/propLedger'

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
  it('matches punctuation and accent variants', () => {
    expect(namesMatch('A.J. Brown', 'AJ Brown')).toBe(true)
    expect(namesMatch("Ja'Marr Chase", 'JaMarr Chase')).toBe(true)
    expect(namesMatch('Nikola Jokić', 'Nikola Jokic')).toBe(true)
  })
  it('rejects first-name prefixes and substrings', () => {
    expect(namesMatch('Chris Jones', 'Christian Jones')).toBe(false)
    expect(namesMatch('Josh Allen', 'Josh Allender')).toBe(false)
    expect(namesMatch('Allen', 'Josh Allen')).toBe(false)
  })
})

describe('findAthleteByName', () => {
  const roster = [
    { displayName: 'Jameson Williams' },
    { displayName: 'Jonah Williams' },
    { displayName: 'Amon-Ra St. Brown' },
  ]
  it('prefers the exact name', () => {
    expect(findAthleteByName(roster, 'Jameson Williams')?.displayName).toBe('Jameson Williams')
    expect(findAthleteByName(roster, 'Amon-Ra St. Brown')?.displayName).toBe('Amon-Ra St. Brown')
  })
  it('refuses an initial that fits two teammates', () => {
    expect(findAthleteByName(roster, 'J. Williams')).toBeUndefined()
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

/** /api/box-score-shaped NBA payload (labels as the route emits them). */
function nbaBoxScore() {
  return {
    status: { state: 'in', shortDetail: '3RD 4:12' },
    teams: [
      { abbreviation: 'NY', linescores: [38, 30, 30] },
      { abbreviation: 'CLE', linescores: [26, 23, 22] },
    ],
    playerStats: [
      {
        teamAbbr: 'NY',
        categories: [
          {
            label: 'Stats',
            athletes: [
              { displayName: 'OG Anunoby', stats: { MIN: '27', PTS: '17', FG: '6-13', '3PT': '1-5', FT: '4-4', REB: '7', AST: '4' } },
              { displayName: 'Bench Warmer', stats: { MIN: '0', PTS: '0', FG: '0-0', '3PT': '0-0', FT: '0-0', REB: '0', AST: '0' } },
            ],
          },
        ],
      },
      { teamAbbr: 'CLE', categories: [] },
    ],
  }
}

describe('extractLiveStats (NBA)', () => {
  it('parses made-att strings for threes', () => {
    const live = extractLiveStats(nbaBoxScore(), [{ name: 'OG Anunoby' }], 'NBA')
    expect(live['OG Anunoby']).toEqual({ points: 17, rebounds: 7, assists: 4, threes: 1 })
  })
  it('treats 0-minute players as DNP (nulls, never zeroes)', () => {
    const live = extractLiveStats(nbaBoxScore(), [{ name: 'Bench Warmer' }], 'NBA')
    expect(live['Bench Warmer']).toEqual({ points: null, rebounds: null, assists: null, threes: null })
  })
})

/** /api/box-score-shaped NHL payload. */
function nhlBoxScore() {
  return {
    status: { state: 'in', shortDetail: '2ND 8:13' },
    teams: [
      { abbreviation: 'VGK', linescores: [0, 2] },
      { abbreviation: 'COL', linescores: [0, 0] },
    ],
    playerStats: [
      {
        teamAbbr: 'VGK',
        categories: [
          {
            label: 'Forwards',
            athletes: [
              { displayName: 'Ivan Barbashev', stats: { G: '0', A: '0', S: '2', SOG: '0', TOI: '16:25' } },
              { displayName: 'Healthy Scratch', stats: { G: '0', A: '0', S: '0', SOG: '0', TOI: '0:00' } },
            ],
          },
          {
            label: 'Goalies',
            athletes: [{ displayName: 'Carter Hart', stats: { GA: '2', SA: '38', SV: '36', TOI: '60:00' } }],
          },
        ],
      },
      { teamAbbr: 'COL', categories: [] },
    ],
  }
}

describe('extractLiveStats (NHL)', () => {
  it('sums points from goals + assists, shots from S (not SOG)', () => {
    const live = extractLiveStats(nhlBoxScore(), [{ name: 'Ivan Barbashev' }, { name: 'Carter Hart' }], 'NHL')
    expect(live['Ivan Barbashev']).toEqual({ goals: 0, assists: 0, points: 0, shots: 2, saves: null })
    expect(live['Carter Hart'].saves).toBe(36)
  })
  it('treats 0:00 TOI as DNP', () => {
    const live = extractLiveStats(nhlBoxScore(), [{ name: 'Healthy Scratch' }], 'NHL')
    expect(live['Healthy Scratch']).toEqual({ goals: null, assists: null, points: null, shots: null, saves: null })
  })
})

/** /api/box-score-shaped MLB payload. */
function mlbBoxScore() {
  return {
    status: { state: 'in', shortDetail: 'Top 7th' },
    teams: [
      { abbreviation: 'PHI', linescores: [1, 0, 0, 0, 0, 0, 0] },
      { abbreviation: 'ATL', linescores: [1, 0, 0, 0, 0, 0, 2] },
    ],
    playerStats: [
      {
        teamAbbr: 'PHI',
        categories: [
          {
            label: 'Batting',
            athletes: [
              { displayName: 'Trea Turner', stats: { 'H-AB': '1-5', AB: '5', R: '1', H: '1', RBI: '0', HR: '0', BB: '0', K: '1', '#P': '14' } },
              { displayName: 'Pinch Runner', stats: { 'H-AB': '0-0', AB: '0', R: '1', H: '0', RBI: '0', HR: '0', BB: '0', K: '0', '#P': '0' } },
            ],
          },
          {
            label: 'Pitching',
            athletes: [
              { displayName: 'Cristopher Sanchez', stats: { IP: '6.2', H: '6', R: '3', ER: '3', BB: '5', K: '6', HR: '0' } },
            ],
          },
        ],
      },
      { teamAbbr: 'ATL', categories: [] },
    ],
  }
}

describe('extractLiveStats (MLB)', () => {
  it('parses batting and pitching lines', () => {
    const live = extractLiveStats(mlbBoxScore(), [{ name: 'Trea Turner' }, { name: 'Cristopher Sanchez' }], 'MLB')
    expect(live['Trea Turner']).toEqual({ hits: 1, rbis: 0, home_runs: 0, strikeouts: null })
    expect(live['Cristopher Sanchez']).toEqual({ hits: null, rbis: null, home_runs: null, strikeouts: 6 })
  })
  it('treats no-plate-appearance runners as DNP', () => {
    const live = extractLiveStats(mlbBoxScore(), [{ name: 'Pinch Runner' }], 'MLB')
    expect(live['Pinch Runner']).toEqual({ hits: null, rbis: null, home_runs: null, strikeouts: null })
  })
})

describe('periodsPlayed / periodLabel', () => {
  it('reads periods from linescores for every sport', () => {
    expect(periodsPlayed(nbaBoxScore())).toBe(3)
    expect(periodsPlayed(nhlBoxScore())).toBe(2)
    expect(periodsPlayed(mlbBoxScore())).toBe(7)
  })
  it('labels periods per sport', () => {
    expect(periodLabel('NFL', 3)).toBe('Q3')
    expect(periodLabel('NBA', 3)).toBe('Q3')
    expect(periodLabel('NHL', 2)).toBe('P2')
    expect(periodLabel('MLB', 7)).toBe('7th')
    expect(periodLabel('MLB', 0)).toBe('')
  })
})
