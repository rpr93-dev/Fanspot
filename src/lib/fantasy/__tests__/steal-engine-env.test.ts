import { describe, it, expect } from 'vitest'
import { buildStealBoard, envAdjustedGap, type StealRow } from '../steal-engine'
import type { TeamEnvironment } from '../environment'
import type { FantasyPlayerEnriched } from '@/lib/fantasy-types'

interface MkInput {
  id: number
  name: string
  pos: string
  team: string
  proj: number
  adp: number
  inj?: boolean
  owned?: number
  exp?: number
  prior?: number
}

function mkPlayer(i: MkInput): FantasyPlayerEnriched {
  return {
    id: i.id,
    player: {
      id: i.id,
      fullName: i.name,
      active: true,
      injured: i.inj ?? false,
      injuryStatus: i.inj ? 'DOUBTFUL' : 'ACTIVE',
      ownership: { percentOwned: i.owned ?? 50 },
    },
    normalizedPosition: i.pos,
    proTeamAbbr: i.team,
    pprRank: i.adp,
    adpSource: 'espn',
    projection: { points: i.proj, stats: {} },
    seasonActuals: i.prior != null ? { points: i.prior, stats: {} } : undefined,
    sleeper: { years_exp: i.exp ?? 2 },
  } as unknown as FantasyPlayerEnriched
}

function envMap(scores: Record<string, number>): Map<string, TeamEnvironment> {
  const m = new Map<string, TeamEnvironment>()
  for (const [team, score] of Object.entries(scores)) {
    m.set(team, { team, envScore: score, envRank: 1, teamCount: 32, impliedPointsPerGame: 20 })
  }
  return m
}

describe('buildStealBoard with environment', () => {
  it('lifts confidence on a top-tier offense and cuts it on a bottom-tier one', () => {
    const players = [
      mkPlayer({ id: 1, name: 'WR A', pos: 'WR', team: 'KC', proj: 300, adp: 30 }),
      mkPlayer({ id: 2, name: 'WR B', pos: 'WR', team: 'PIT', proj: 100, adp: 5 }),
    ]
    const env = envMap({ KC: 100, PIT: 0 })
    const rows = buildStealBoard(players, { scoringFormat: 'ppr' }, env)

    const rowA = rows.find((r) => r.playerId === 1) as StealRow
    const rowB = rows.find((r) => r.playerId === 2) as StealRow
    expect(rowA.envScore).toBe(100)
    expect(rowA.envSignal).toBe('top-offense')
    expect(rowA.envRank).toBe(1)
    expect(rowA.envTeamCount).toBe(32)
    expect(rowB.envScore).toBe(0)
    expect(rowB.envSignal).toBe('poor-offense')
    expect(rowA.conf - rowB.conf).toBe(20)
  })

  it('is unchanged when no environment map is passed (neutral 50)', () => {
    const players = [mkPlayer({ id: 1, name: 'WR A', pos: 'WR', team: 'KC', proj: 300, adp: 30 })]
    const withEnv = buildStealBoard(players, { scoringFormat: 'ppr' }, envMap({ KC: 100 }))
    const withoutEnv = buildStealBoard(players, { scoringFormat: 'ppr' })
    expect(withoutEnv[0].envScore).toBe(50)
    expect(withoutEnv[0].conf).toBeLessThan(withEnv[0].conf)
  })

  it('applies the scheme delta on top of the Vegas environment for skill positions', () => {
    const players = [
      mkPlayer({ id: 1, name: 'WR A', pos: 'WR', team: 'PIT', proj: 300, adp: 30 }),
      mkPlayer({ id: 2, name: 'K A', pos: 'K', team: 'PIT', proj: 150, adp: 10 }),
    ]
    const env = envMap({ PIT: 0 })
    const scheme = new Map([['PIT', { team: 'PIT', delta: 20, hasSignal: true, headlines: ['new coordinator'], fetchedAt: Date.now() }]])
    const rows = buildStealBoard(players, { scoringFormat: 'ppr' }, env, scheme)

    const wr = rows.find((r) => r.playerId === 1) as StealRow
    const kicker = rows.find((r) => r.playerId === 2) as StealRow
    expect(wr.envScore).toBe(20)
    expect(wr.schemeDelta).toBe(20)
    expect(wr.schemeHeadline).toBe('new coordinator')
    expect(kicker.envScore).toBe(50)
    expect(kicker.schemeDelta).toBeUndefined()
  })

  it('clamps the environment score at the 0-100 bounds', () => {
    const players = [mkPlayer({ id: 1, name: 'WR A', pos: 'WR', team: 'KC', proj: 300, adp: 30 })]
    const env = envMap({ KC: 100 })
    const scheme = new Map([['KC', { team: 'KC', delta: 20, hasSignal: true, headlines: ['upgrade'], fetchedAt: Date.now() }]])
    const rows = buildStealBoard(players, { scoringFormat: 'ppr' }, env, scheme)
    expect(rows[0].envScore).toBe(100)
  })
})

describe('envAdjustedGap', () => {
  const base = (gap: number, envScore: number): StealRow =>
    ({ gap, envScore, envSignal: 'average', pos: 'WR', posRank: 1, adpRank: 1 } as unknown as StealRow)

  it('adds up to +5 for a top offense and −5 for a bottom one', () => {
    expect(envAdjustedGap(base(1, 100))).toBe(6)
    expect(envAdjustedGap(base(1, 0))).toBe(-4)
    expect(envAdjustedGap(base(1, 50))).toBe(1)
  })
})
