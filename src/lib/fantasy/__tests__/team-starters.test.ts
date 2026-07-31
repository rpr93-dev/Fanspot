import { describe, it, expect } from 'vitest'
import { pickTeamStarters, UNSETTLED_MARGIN } from '../team-starters'
import type { FantasyPlayerEnriched } from '@/lib/fantasy-types'

let nextId = 1

function player(over: {
  name: string
  pos: string
  team: string
  depthChartOrder?: number
  percentStarted?: number
  percentOwned?: number
  projectedPoints?: number
  active?: boolean
}): FantasyPlayerEnriched {
  const id = nextId++
  return {
    id,
    player: {
      id,
      fullName: over.name,
      firstName: over.name.split(' ')[0],
      lastName: over.name.split(' ').slice(1).join(' '),
      defaultPositionId: 0,
      proTeamId: 0,
      active: over.active ?? true,
      injured: false,
      injuryStatus: 'ACTIVE',
      ownership: {
        averageDraftPosition: 100,
        percentOwned: over.percentOwned ?? 0,
        percentStarted: over.percentStarted ?? 0,
        auctionValueAverage: 0,
        activityLevel: 0,
      },
      draftRanksByRankType: {},
      stats: [],
      eligibleSlots: [],
      droppable: true,
      jersey: '',
    },
    normalizedPosition: over.pos,
    proTeamAbbr: over.team,
    projection: { points: over.projectedPoints ?? 100, stats: {} },
    sleeper: { depth_chart_order: over.depthChartOrder },
  } as unknown as FantasyPlayerEnriched
}

describe('pickTeamStarters', () => {
  it('returns one entry per position, in order', () => {
    const picks = pickTeamStarters([player({ name: 'A', pos: 'QB', team: 'KC' })], 'KC')
    expect(picks.map((p) => p.pos)).toEqual(['QB', 'RB', 'WR', 'TE'])
  })

  it('uses depth chart order rather than list order', () => {
    const roster = [
      // Listed first but third on the depth chart.
      player({ name: 'Backup Back', pos: 'RB', team: 'KC', depthChartOrder: 3, projectedPoints: 90 }),
      player({ name: 'Lead Back', pos: 'RB', team: 'KC', depthChartOrder: 1, projectedPoints: 80 }),
    ]
    const rb = pickTeamStarters(roster, 'KC').find((p) => p.pos === 'RB')
    expect(rb?.player?.name).toBe('Lead Back')
    expect(rb?.evidence).toBe('depth-chart')
  })

  it('does not let a higher projection override the depth chart', () => {
    const roster = [
      player({ name: 'Starter', pos: 'WR', team: 'KC', depthChartOrder: 1, projectedPoints: 100 }),
      player({ name: 'Rookie Hype', pos: 'WR', team: 'KC', depthChartOrder: 4, projectedPoints: 260 }),
    ]
    const wr = pickTeamStarters(roster, 'KC').find((p) => p.pos === 'WR')
    expect(wr?.player?.name).toBe('Starter')
  })

  it('falls back to start rate when no depth chart data exists', () => {
    const roster = [
      player({ name: 'Rarely Started', pos: 'TE', team: 'KC', percentStarted: 3, projectedPoints: 120 }),
      player({ name: 'Widely Started', pos: 'TE', team: 'KC', percentStarted: 78, projectedPoints: 110 }),
    ]
    const te = pickTeamStarters(roster, 'KC').find((p) => p.pos === 'TE')
    expect(te?.player?.name).toBe('Widely Started')
    expect(te?.evidence).toBe('usage')
  })

  it('flags a genuine competition instead of naming one player', () => {
    const roster = [
      player({ name: 'QB One', pos: 'QB', team: 'PIT', depthChartOrder: 1, percentStarted: 20, projectedPoints: 240 }),
      player({ name: 'QB Two', pos: 'QB', team: 'PIT', depthChartOrder: 1, percentStarted: 18, projectedPoints: 235 }),
    ]
    const qb = pickTeamStarters(roster, 'PIT').find((p) => p.pos === 'QB')
    expect(qb?.unsettled).toBe(true)
    expect(qb?.reason).toContain('QB One')
    expect(qb?.reason).toContain('QB Two')
    expect(qb?.contender?.name).toBe('QB Two')
  })

  it('does not flag a settled job as a competition', () => {
    const roster = [
      player({ name: 'Franchise QB', pos: 'QB', team: 'KC', depthChartOrder: 1, percentStarted: 95 }),
      player({ name: 'Clipboard', pos: 'QB', team: 'KC', depthChartOrder: 2, percentStarted: 0 }),
    ]
    const qb = pickTeamStarters(roster, 'KC').find((p) => p.pos === 'QB')
    expect(qb?.unsettled).toBe(false)
    expect(qb?.reason).toBe('')
    expect(UNSETTLED_MARGIN).toBeGreaterThan(0)
  })

  it('says so when a position is empty rather than borrowing from another', () => {
    const te = pickTeamStarters([player({ name: 'Only QB', pos: 'QB', team: 'KC' })], 'KC').find(
      (p) => p.pos === 'TE',
    )
    expect(te?.player).toBeNull()
    expect(te?.reason).toContain('No TE')
  })

  it('ignores other teams and inactive players', () => {
    const roster = [
      player({ name: 'Other Team', pos: 'QB', team: 'BUF', depthChartOrder: 1 }),
      player({ name: 'Retired', pos: 'QB', team: 'KC', depthChartOrder: 1, active: false }),
      player({ name: 'Actual', pos: 'QB', team: 'KC', depthChartOrder: 2 }),
    ]
    const qb = pickTeamStarters(roster, 'kc').find((p) => p.pos === 'QB')
    expect(qb?.player?.name).toBe('Actual')
  })
})
