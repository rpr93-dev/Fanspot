import { describe, it, expect } from 'vitest'
import { buildSeasonProjections, matchupMultiplier } from '@/lib/seasonProjections'
import { groupByPlayer, type MarketInfo } from '@/lib/oddsProps'

const athlete = (id: string, name: string, pos: string, stats: Record<string, string>, injuries: any[] = []) => ({
  id,
  displayName: name,
  position: { abbreviation: pos },
  seasonStats: stats,
  injuries,
})

describe('matchupMultiplier', () => {
  it('scales by implied total vs league average and clamps per sport', () => {
    expect(matchupMultiplier('NBA', 114)).toBe(1)
    expect(matchupMultiplier('NBA', 200)).toBe(1.15)
    expect(matchupMultiplier('NFL', 44)).toBe(1.4)
    expect(matchupMultiplier('MLB', NaN)).toBe(1)
  })
})

describe('buildSeasonProjections', () => {
  it('projects NBA regulars by minutes and skips players ruled out', () => {
    const roster = [
      athlete('1', 'Star', 'SF', { gamesPlayed: '60', avgMinutes: '36', avgPoints: '28.4', avgRebounds: '7.1', avgAssists: '5.0', avgThreePointFieldGoalsMade: '3.1' }),
      athlete('2', 'Injured', 'PG', { gamesPlayed: '60', avgMinutes: '38', avgPoints: '30' }, [{ status: 'Out' }]),
      athlete('3', 'Questionable', 'C', { gamesPlayed: '40', avgMinutes: '30', avgPoints: '15', avgRebounds: '11' }, [{ status: 'Day-To-Day' }]),
      athlete('4', 'Rookie', 'G', { gamesPlayed: '1', avgMinutes: '40', avgPoints: '40' }),
    ]
    const out = buildSeasonProjections('NBA', roster, 'BOS', 1)
    expect(out.map((p) => p.name)).toEqual(['Star', 'Questionable'])
    expect(out[0].lines.find((l) => l.stat === 'points')?.value).toBe(28.4)
    expect(out[1].status).toBe('Day-To-Day')
    expect(out[0].lines.every((l) => l.sd > 0)).toBe(true)
  })

  it('applies the matchup multiplier to offense only (not goalie saves)', () => {
    const roster = [
      athlete('1', 'Winger', 'LW', { games: '80', points: '80', shotsTotal: '240', goals: '40' }),
      athlete('2', 'Backup G', 'G', { gameStarted: '20', saves: '500' }),
      athlete('3', 'Starter G', 'G', { gameStarted: '60', saves: '1650' }),
    ]
    const out = buildSeasonProjections('NHL', roster, 'EDM', 1.1)
    const winger = out.find((p) => p.name === 'Winger')!
    expect(winger.lines.find((l) => l.stat === 'points')?.value).toBe(1.1)
    expect(winger.lines.find((l) => l.stat === 'shots')?.value).toBe(3.3)
    const goalie = out.find((p) => p.position === 'G')!
    expect(goalie.name).toBe('Starter G')
    expect(goalie.lines[0]).toMatchObject({ stat: 'saves', value: 27.5 })
  })

  it('only projects the announced MLB probable starter, never a guessed pitcher', () => {
    const roster = [
      athlete('10', 'Ace', 'SP', { gamesStarted: '30', strikeouts: '210', innings: '180' }),
      athlete('11', 'Other SP', 'SP', { gamesStarted: '30', strikeouts: '150', innings: '170' }),
      athlete('12', 'Slugger', 'RF', { gamesPlayed: '150', plateAppearances: '640', hits: '165', totalBases: '300', RBIs: '110', homeRuns: '40' }),
    ]
    expect(buildSeasonProjections('MLB', roster, 'NYY', 1).some((p) => p.position === 'SP')).toBe(false)
    const withProbable = buildSeasonProjections('MLB', roster, 'NYY', 1, { probablePitcherIds: ['11'] })
    expect(withProbable[0]).toMatchObject({ name: 'Other SP', note: 'Probable starter' })
    expect(withProbable[0].lines[0]).toMatchObject({ stat: 'strikeouts', value: 5 })
    const opener = buildSeasonProjections('MLB', [athlete('13', 'Opener', 'RP', { gamesStarted: '0', gamesPlayed: '50', strikeouts: '60' })], 'NYY', 1, { probablePitcherIds: ['13'] })
    expect(opener[0].lines[0]).toMatchObject({ stat: 'strikeouts', value: 1.2 })
    const slugger = withProbable.find((p) => p.name === 'Slugger')!
    expect(slugger.lines.find((l) => l.stat === 'home_runs')?.value).toBe(0.27)
  })
})

describe('groupByPlayer (The Odds API player props)', () => {
  const info: Record<string, MarketInfo> = { player_points: { label: 'PTS', position: null, stat: 'points' } }

  it('reads the player from description and the side from name', () => {
    const players = groupByPlayer(
      [{
        key: 'player_points',
        outcomes: [
          { name: 'Over', description: 'Jalen Brunson', point: 26.5, price: -115 },
          { name: 'Under', description: 'Jalen Brunson', point: 26.5, price: -105 },
          { name: 'Over', description: 'Karl-Anthony Towns', point: 26.5, price: 100 },
          { name: 'Under', description: 'Karl-Anthony Towns', point: 26.5, price: -120 },
        ],
      }],
      info,
    )
    expect(players.map((p) => p.name)).toEqual(['Jalen Brunson', 'Karl-Anthony Towns'])
    expect(players[0].props[0]).toMatchObject({ stat: 'points', line: 26.5, over: -115, under: -105 })
    expect(players[1].props[0]).toMatchObject({ over: 100, under: -120 })
  })

  it('still handles the player-in-name shape', () => {
    const players = groupByPlayer(
      [{ key: 'player_points', outcomes: [{ name: 'A Player', description: 'Over', point: 10.5, price: 110 }, { name: 'A Player', description: 'Under', point: 10.5, price: -130 }] }],
      info,
    )
    expect(players[0]).toMatchObject({ name: 'A Player' })
    expect(players[0].props[0]).toMatchObject({ over: 110, under: -130 })
  })
})
