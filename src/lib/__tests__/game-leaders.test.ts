import { describe, it, expect } from 'vitest'
import {
  LEADER_RULES,
  leaderNumeric,
  leadersForTeam,
  selectGameLeaders,
  selectTeamLeaders,
} from '@/lib/gameLeaders'

const nfl = [
  {
    teamAbbr: 'BUF',
    categories: [
      { label: 'Passing', statNames: ['C/ATT', 'YDS'], athletes: [
        { id: '3918298', displayName: 'Josh Allen', position: 'QB', stats: { 'C/ATT': '12/19', YDS: '210', TD: '1' } },
      ] },
      { label: 'Rushing', statNames: ['CAR', 'YDS'], athletes: [
        { id: '1', displayName: 'Josh Allen', stats: { CAR: '10', YDS: '121' } },
        { id: '2', displayName: 'James Cook III', stats: { CAR: '14', YDS: '68' } },
      ] },
      { label: 'Receiving', statNames: ['REC', 'YDS'], athletes: [
        { id: '3', displayName: 'Khalil Shakir', stats: { REC: '3', YDS: '80' } },
        { id: '4', displayName: 'Keon Coleman', stats: { REC: '5', YDS: '96' } },
      ] },
      { label: 'Defense', statNames: ['TOT', 'SOLO'], athletes: [
        { id: '5', displayName: 'Cole Bishop', stats: { TOT: '11', SOLO: '6' } },
        { id: '6', displayName: 'Terrel Bernard', stats: { TOT: '9', SOLO: '5' } },
      ] },
      { label: 'Punting', statNames: ['NO', 'YDS'], athletes: [
        { id: '7', displayName: 'Tommy Doman Jr.', stats: { NO: '1', YDS: '52' } },
      ] },
    ],
  },
  { teamAbbr: 'LAR', categories: [] },
]

const nba = [
  {
    teamAbbr: 'DEN',
    categories: [
      { label: 'Stats', statNames: ['MIN', 'PTS', 'REB', 'AST'], athletes: [
        { id: 'a', displayName: 'Nikola Jokic', position: 'C', stats: { MIN: '36', PTS: '31', REB: '14', AST: '11' } },
        { id: 'b', displayName: 'Jamal Murray', position: 'G', stats: { MIN: '34', PTS: '22', REB: '4', AST: '7' } },
      ] },
    ],
  },
]

const nhl = [
  {
    teamAbbr: 'MTL',
    categories: [
      { label: 'Forwards', statNames: ['G', 'A', 'SOG'], athletes: [
        { id: 'x', displayName: 'Josh Anderson', stats: { G: '2', A: '0', SOG: '3' } },
        { id: 'y', displayName: 'Nick Suzuki', stats: { G: '1', A: '2', SOG: '4' } },
      ] },
      { label: 'Goalies', statNames: ['SV', 'SV%'], athletes: [
        { id: 'z', displayName: 'Jakub Dobes', stats: { SV: '18', 'SV%': '.783' } },
      ] },
    ],
  },
]

describe('leaderNumeric', () => {
  it('parses plain values, ratios (by numerator), percentages and signs', () => {
    expect(leaderNumeric('210')).toBe(210)
    expect(leaderNumeric('3/3')).toBe(3)
    expect(leaderNumeric('.783')).toBeCloseTo(0.783)
    expect(leaderNumeric('-2')).toBe(-2)
    expect(leaderNumeric('+6')).toBe(6)
    expect(leaderNumeric('11.1')).toBe(11.1)
  })
  it('is unknown (not zero) for missing or unparsable input', () => {
    expect(leaderNumeric(undefined)).toBeNull()
    expect(leaderNumeric(null)).toBeNull()
    expect(leaderNumeric('')).toBeNull()
    expect(leaderNumeric('-')).toBeNull()
    expect(leaderNumeric('n/a')).toBeNull()
  })
})

describe('selectTeamLeaders', () => {
  it('picks the leader per category in rule order', () => {
    const leaders = selectTeamLeaders(nfl[0], 4)
    expect(leaders.map((l) => [l.statLabel, l.playerName, l.value])).toEqual([
      ['Pass Yds', 'Josh Allen', '210'],
      ['Rush Yds', 'Josh Allen', '121'],
      ['Rec Yds', 'Keon Coleman', '96'],
      ['Tackles', 'Cole Bishop', '11'],
    ])
  })

  it('honours the per-team limit', () => {
    expect(selectTeamLeaders(nfl[0], 2)).toHaveLength(2)
  })

  it('skips categories whose best value is zero or missing', () => {
    const team = {
      teamAbbr: 'X',
      categories: [
        { label: 'Passing', statNames: ['YDS'], athletes: [{ displayName: 'A', stats: { YDS: '0' } }] },
        { label: 'Rushing', statNames: ['YDS'], athletes: [] },
      ],
    }
    expect(selectTeamLeaders(team)).toEqual([])
  })

  it('handles categories with no athletes and missing stats maps', () => {
    expect(selectTeamLeaders({ teamAbbr: 'X' })).toEqual([])
    expect(
      selectTeamLeaders({ teamAbbr: 'X', categories: [{ label: 'Passing', athletes: [{ displayName: 'A' }] }] }),
    ).toEqual([])
  })

  it('derives NBA points/rebounds/assists from the single Stats table', () => {
    const leaders = selectTeamLeaders(nba[0], 4)
    expect(leaders.map((l) => `${l.statLabel}:${l.playerName}`)).toEqual([
      'Points:Nikola Jokic',
      'Rebounds:Nikola Jokic',
      'Assists:Nikola Jokic',
    ])
  })

  it('derives NHL goals/assists/saves', () => {
    const leaders = selectTeamLeaders(nhl[0], 4)
    expect(leaders.map((l) => `${l.statLabel}:${l.playerName}:${l.value}`)).toEqual([
      'Goals:Josh Anderson:2',
      'Assists:Nick Suzuki:2',
      'Saves:Jakub Dobes:18',
    ])
  })
})

describe('selectGameLeaders / leadersForTeam', () => {
  it('flattens every team in feed order', () => {
    const all = selectGameLeaders(nfl, 2)
    expect(all.filter((l) => l.teamAbbr === 'BUF')).toHaveLength(2)
    expect(all.filter((l) => l.teamAbbr === 'LAR')).toHaveLength(0)
  })

  it('returns nothing for a pregame/empty payload instead of zeroes', () => {
    expect(selectGameLeaders(null)).toEqual([])
    expect(selectGameLeaders([])).toEqual([])
    expect(selectGameLeaders([{ teamAbbr: 'BUF', categories: [] }])).toEqual([])
  })

  it('finds a team case-insensitively', () => {
    expect(leadersForTeam(nfl, 'buf', 1)).toHaveLength(1)
    expect(leadersForTeam(nfl, 'nope')).toEqual([])
  })
})

describe('LEADER_RULES', () => {
  it('only targets stats each sport actually publishes', () => {
    // Guard against a typo silently disabling a row: every rule must name a
    // stat that appears in a real ESPN `statNames` list of that category.
    const known: Record<string, string[]> = {
      Passing: ['C/ATT', 'YDS', 'TD', 'INT'],
      Rushing: ['CAR', 'YDS', 'TD'],
      Receiving: ['REC', 'YDS', 'TD'],
      Defense: ['TOT', 'SOLO', 'SACKS'],
      Kicking: ['FG', 'PCT', 'XP', 'PTS'],
      Stats: ['MIN', 'PTS', 'REB', 'AST'],
      Forwards: ['G', 'A', 'SOG'],
      Defenses: ['SOG', 'TOI'],
      Goalies: ['SV', 'SV%'],
      Batting: ['H-AB', 'R', 'H', 'RBI', 'HR'],
      Pitching: ['IP', 'R', 'K'],
    }
    for (const rule of LEADER_RULES) {
      expect(known[rule.category], `unknown category ${rule.category}`).toBeDefined()
      expect(known[rule.category]).toContain(rule.stat)
      expect(rule.label.length).toBeGreaterThan(0)
    }
  })
})
