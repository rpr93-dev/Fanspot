import { describe, it, expect } from 'vitest'
import {
  buildTeamEnvironment,
  environmentScoreFor,
  envSignalFor,
  isSkillPosition,
  type TeamEnvironment,
} from '../environment'
import type { FantasyPlayerEnriched } from '@/lib/fantasy-types'

function mkPlayer(team: string, offensiveRank?: number, impliedPoints?: number): FantasyPlayerEnriched {
  return {
    proTeamAbbr: team,
    vegas: offensiveRank != null ? { offensiveRank, teamImpliedPoints: impliedPoints } : undefined,
  } as unknown as FantasyPlayerEnriched
}

function envFor(score: number, rank = 1, teamCount = 32): TeamEnvironment {
  return { team: 'PIT', envScore: score, envRank: rank, teamCount, impliedPointsPerGame: 20 }
}

describe('buildTeamEnvironment', () => {
  it('maps offensive rank to a 0-100 percentile across teams', () => {
    const env = buildTeamEnvironment([
      mkPlayer('KC', 1),
      mkPlayer('BUF', 2),
      mkPlayer('PIT', 3),
      mkPlayer('CAR', 32),
    ])
    expect(env.get('KC')?.envScore).toBe(100)
    expect(env.get('PIT')?.envScore).toBe(33)
    expect(env.get('CAR')?.envScore).toBe(0)
    expect(env.get('KC')?.envRank).toBe(1)
    expect(env.get('CAR')?.envRank).toBe(32)
    expect(env.get('KC')?.teamCount).toBe(4)
  })

  it('skips teams without Vegas odds and free agents', () => {
    const env = buildTeamEnvironment([
      mkPlayer('KC', 1),
      mkPlayer('FA'),
      mkPlayer('NONE', undefined, 20),
    ])
    expect(env.size).toBe(1)
    expect(env.get('KC')).toBeDefined()
  })

  it('treats a single ranked team as the top offense', () => {
    const env = buildTeamEnvironment([mkPlayer('KC', 1)])
    expect(env.get('KC')?.envScore).toBe(100)
  })
})

describe('environmentScoreFor', () => {
  it('passes the score through for WR/TE and QB', () => {
    expect(environmentScoreFor(envFor(90), 'WR')).toBe(90)
    expect(environmentScoreFor(envFor(90), 'TE')).toBe(90)
    expect(environmentScoreFor(envFor(90), 'QB')).toBe(90)
  })

  it('haircuts RB because a workhorse back can produce on a bad offense', () => {
    expect(environmentScoreFor(envFor(100), 'RB')).toBe(85)
  })

  it('keeps K and D/ST neutral', () => {
    expect(environmentScoreFor(envFor(100), 'K')).toBe(50)
    expect(environmentScoreFor(envFor(0), 'D/ST')).toBe(50)
  })

  it('degrades to neutral when the team has no environment', () => {
    expect(environmentScoreFor(undefined, 'WR')).toBe(50)
  })
})

describe('envSignalFor', () => {
  it('tiers the score into top, average and poor', () => {
    expect(envSignalFor(100)).toBe('top-offense')
    expect(envSignalFor(75)).toBe('top-offense')
    expect(envSignalFor(50)).toBe('average')
    expect(envSignalFor(25)).toBe('poor-offense')
    expect(envSignalFor(0)).toBe('poor-offense')
  })
})

describe('isSkillPosition', () => {
  it('includes the positions a scheme change moves', () => {
    expect(isSkillPosition('QB')).toBe(true)
    expect(isSkillPosition('WR')).toBe(true)
    expect(isSkillPosition('K')).toBe(false)
    expect(isSkillPosition('D/ST')).toBe(false)
  })
})
