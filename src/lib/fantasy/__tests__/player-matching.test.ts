import { describe, it, expect } from 'vitest'
import {
  buildMatchContext,
  matchEspnPlayerToMaster,
  normalizeName,
  type UnmatchedEspnPlayer,
} from '../player-matching-engine'
import type { CanonicalPlayer } from '../player-types'

function canon(sleeperId: string, fullName: string, position: string, team: string, espnId?: number): CanonicalPlayer {
  const [firstName, ...rest] = fullName.split(' ')
  return { sleeperId, espnId, fullName, firstName, lastName: rest.join(' '), position, team, rookie: false, active: true }
}

function ctxOf(players: CanonicalPlayer[]) {
  const bySleeperId = new Map(players.map((p) => [p.sleeperId, p]))
  const byEspnId = new Map(players.filter((p) => p.espnId != null).map((p) => [p.espnId!, p]))
  return buildMatchContext({ bySleeperId, byEspnId, byGsisId: new Map(), byPfrId: new Map(), players })
}

function espn(espnId: number, fullName: string, position: string, team: string): UnmatchedEspnPlayer {
  const [firstName, ...rest] = fullName.split(' ')
  return { espnId, fullName, firstName, lastName: rest.join(' '), position, team }
}

describe('normalizeName', () => {
  it('drops suffixes, punctuation and accents', () => {
    expect(normalizeName('Odell Beckham Jr.')).toBe(normalizeName('Odell Beckham'))
    expect(normalizeName('Marvin Harrison Jr')).toBe('marvinharrison')
    expect(normalizeName("Ja'Marr Chase")).toBe('jamarrchase')
    expect(normalizeName('A.J. Brown')).toBe('ajbrown')
    expect(normalizeName('Michael Pittman III')).toBe('michaelpittman')
    expect(normalizeName('José Ramírez')).toBe('joseramirez')
  })
})

describe('matchEspnPlayerToMaster', () => {
  it('matches by espn id when names agree', () => {
    const ctx = ctxOf([canon('1', 'Josh Allen', 'QB', 'BUF', 3918298)])
    const r = matchEspnPlayerToMaster(espn(3918298, 'Josh Allen', 'QB', 'BUF'), ctx)
    expect(r?.strategy).toBe('espn-id')
  })

  it('rejects an espn-id join whose names disagree and falls back to name', () => {
    const ctx = ctxOf([
      canon('1', 'Travis Kelce', 'TE', 'KC', 999),
      canon('2', 'Jalen Hurts', 'QB', 'PHI'),
    ])
    const r = matchEspnPlayerToMaster(espn(999, 'Jalen Hurts', 'QB', 'PHI'), ctx)
    expect(r?.canonical.sleeperId).toBe('2')
    expect(r?.strategy).toBe('name-position')
  })

  it('disambiguates namesakes by team and refuses when it cannot', () => {
    // Two different "Josh Allen"s: the BUF QB and the edge rusher listed as a
    // fantasy-irrelevant position, plus a hypothetical second QB namesake.
    const ctx = ctxOf([
      canon('1', 'Josh Allen', 'QB', 'BUF'),
      canon('2', 'Josh Allen', 'QB', 'JAX'),
    ])
    expect(matchEspnPlayerToMaster(espn(1, 'Josh Allen', 'QB', 'BUF'), ctx)?.canonical.sleeperId).toBe('1')
    expect(matchEspnPlayerToMaster(espn(2, 'Josh Allen', 'QB', 'JAX'), ctx)?.canonical.sleeperId).toBe('2')
    // Free agent ESPN row with two same-position namesakes: ambiguous.
    expect(matchEspnPlayerToMaster(espn(3, 'Josh Allen', 'QB', 'FA'), ctx)).toBeNull()
  })

  it('never fuzzy-matches across positions or teams', () => {
    const ctx = ctxOf([canon('1', 'Mike Williams', 'WR', 'NYJ')])
    expect(matchEspnPlayerToMaster(espn(5, 'Mike Williamson', 'RB', 'NYJ'), ctx)).toBeNull()
    expect(matchEspnPlayerToMaster(espn(6, 'Mike Wiliams', 'WR', 'LAC'), ctx)).toBeNull()
    const hit = matchEspnPlayerToMaster(espn(7, 'Mike Wiliams', 'WR', 'NYJ'), ctx)
    expect(hit?.strategy).toBe('fuzzy')
    expect(hit!.confidence).toBeLessThan(0.9)
  })

  it('does not substring-match a different player', () => {
    // Old engine scored any substring as 0.9 ("Chris Godwin" ⊂ "Chris Godwinson").
    const ctx = ctxOf([canon('1', 'Chris Godwinson', 'WR', 'TB')])
    expect(matchEspnPlayerToMaster(espn(8, 'Chris Godwin', 'WR', 'TB'), ctx)).toBeNull()
  })

  it('refuses an exact-name hit at the wrong position and team', () => {
    const ctx = ctxOf([canon('1', 'Zach Ertz', 'TE', 'WAS')])
    expect(matchEspnPlayerToMaster(espn(9, 'Zach Ertz', 'WR', 'DET'), ctx)).toBeNull()
    // Same team, provider position drift: allowed via name-team.
    expect(matchEspnPlayerToMaster(espn(9, 'Zach Ertz', 'WR', 'WAS'), ctx)?.strategy).toBe('name-team')
  })

  it('matches suffix variants exactly', () => {
    const ctx = ctxOf([canon('1', 'Marvin Harrison Jr.', 'WR', 'ARI')])
    const r = matchEspnPlayerToMaster(espn(10, 'Marvin Harrison', 'WR', 'ARI'), ctx)
    expect(r?.canonical.sleeperId).toBe('1')
    expect(r?.strategy).toBe('name-position')
  })
})
