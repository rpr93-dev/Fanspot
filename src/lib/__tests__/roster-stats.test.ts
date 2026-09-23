import { describe, it, expect } from 'vitest'
import { rosterStatColumns, sportPositionOrder } from '@/lib/roster-stats'
import { getPeriodLabels } from '@/components/game/PlayerBoxScore'

const keys = (sport: string, pos: string) => rosterStatColumns(sport, pos).map((c) => c.key)

describe('rosterStatColumns', () => {
  it('uses ESPN core-API stat names for MLB hitters and pitchers', () => {
    expect(keys('MLB', 'CF')).toEqual(['avg', 'homeRuns', 'RBIs', 'runs', 'onBasePct', 'OPS', 'stolenBases'])
    for (const pos of ['SP', 'RP', 'P']) {
      expect(keys('MLB', pos)).toContain('ERA')
      expect(keys('MLB', pos)).not.toContain('avg')
    }
  })

  it('splits NHL skaters and goalies', () => {
    expect(keys('NHL', 'C')).toContain('shotsTotal')
    expect(keys('NHL', 'C')).toContain('timeOnIcePerGame')
    expect(keys('NHL', 'G')).toEqual(['wins', 'losses', 'avgGoalsAgainst', 'savePct', 'saves', 'shutouts'])
  })

  it('uses per-game NBA averages for every position', () => {
    expect(keys('NBA', 'PG')).toEqual(keys('NBA', 'C'))
    expect(keys('NBA', 'G')[0]).toBe('avgPoints')
  })

  it('maps NFL kicker/defender columns to real ESPN keys', () => {
    expect(keys('NFL', 'PK')).toEqual(['fieldGoalsMade', 'fieldGoalAttempts', 'extraPointsMade', 'extraPointAttempts'])
    expect(keys('NFL', 'CB')).toContain('passesDefended')
    expect(keys('NFL', 'CB')).toContain('fumblesForced')
    expect(keys('NFL', 'OT')).toEqual([])
  })

  it('orders MLB starters/relievers and NBA/NHL generic positions', () => {
    expect(sportPositionOrder.MLB.slice(0, 2)).toEqual(['SP', 'RP'])
    expect(sportPositionOrder.NBA).toContain('G')
    expect(sportPositionOrder.NBA).toContain('F')
  })
})

describe('getPeriodLabels', () => {
  it('labels any number of overtimes / extra innings', () => {
    expect(getPeriodLabels('NBA', 6)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'OT', '2OT'])
    expect(getPeriodLabels('MLB', 11)).toHaveLength(11)
    expect(getPeriodLabels('MLB', 11)[10]).toBe('11')
    expect(getPeriodLabels('NHL', 4)).toEqual(['1st', '2nd', '3rd', 'OT'])
    expect(getPeriodLabels('NHL', 5)[4]).toBe('SO')
    expect(getPeriodLabels('NHL', 6).slice(4)).toEqual(['2OT', '3OT'])
  })

  it('always covers regulation even before any scoring', () => {
    expect(getPeriodLabels('NFL')).toHaveLength(4)
    expect(getPeriodLabels('MLB')).toHaveLength(9)
  })
})
