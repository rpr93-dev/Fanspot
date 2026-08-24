import { describe, expect, it } from 'vitest'
import { computeFantasyProsValues, parseFantasyProsHtml } from '../engine/fantasypros'
import type { FpPlayer } from '../engine/fantasypros'
import { DEFAULT_STARTERS } from '@/lib/fantasy/auction-engine'

const FIXTURE = `<html><body><script>var ecrData = {"type":"Draft","scoring":"STD","count":6,"players":[
{"player_id":1,"player_name":"Josh Allen","player_team_id":"BUF","player_position_id":"QB","player_positions":"QB","player_owned_avg":99.7,"rank_ecr":2,"pos_rank":"QB1","tier":1,"player_bye_week":"7"},
{"player_id":2,"player_name":"Bijan Robinson","player_team_id":"ATL","player_position_id":"RB","player_positions":"RB","player_owned_avg":98.5,"rank_ecr":3,"pos_rank":"RB1","tier":1,"player_bye_week":"6"},
{"player_id":3,"player_name":"Houston Texans","player_team_id":"HOU","player_position_id":"DST","player_positions":"DST","player_owned_avg":90,"rank_ecr":80,"pos_rank":"DST1","tier":9,"player_bye_week":"8"},
{"player_id":4,"player_name":"Brandon Aubrey","player_team_id":"DAL","player_position_id":"K","player_positions":"K","player_owned_avg":95,"rank_ecr":110,"pos_rank":"K1","tier":9,"player_bye_week":"5"},
{"player_id":5,"player_name":"Not Eligible","player_team_id":"XXX","player_position_id":"LB","player_positions":"LB","rank_ecr":999,"pos_rank":"LB1"},
{"player_id":6,"player_name":"","player_team_id":"","player_position_id":"QB","player_positions":"QB","rank_ecr":1,"pos_rank":"QB2"}
]};</script></body></html>`

describe('parseFantasyProsHtml', () => {
  it('extracts and normalizes the ecrData blob', () => {
    const players = parseFantasyProsHtml(FIXTURE)
    expect(players).toHaveLength(4)

    const allen = players.find((p) => p.name === 'Josh Allen')
    expect(allen).toMatchObject({ team: 'BUF', pos: 'QB', posEcr: 1, ecr: 2, tier: 1, owned: 99.7 })

    // DST maps to D/ST and its rank is parsed from "DST1".
    const texans = players.find((p) => p.name === 'Houston Texans')
    expect(texans).toMatchObject({ team: 'HOU', pos: 'D/ST', posEcr: 1 })
  })

  it('skips non-auction positions and empty names', () => {
    const players = parseFantasyProsHtml(FIXTURE)
    expect(players.map((p) => p.name)).toEqual(['Josh Allen', 'Bijan Robinson', 'Houston Texans', 'Brandon Aubrey'])
  })

  it('returns [] for unparseable html', () => {
    expect(parseFantasyProsHtml('<html>no data here</html>')).toEqual([])
  })
})

describe('computeFantasyProsValues', () => {
  const players: FpPlayer[] = [
    { playerId: 1, name: 'QB1', team: 'BUF', pos: 'QB', posEcr: 1, ecr: 1, tier: 1, owned: 99, bye: '7' },
    { playerId: 2, name: 'QB2', team: 'KC', pos: 'QB', posEcr: 2, ecr: 4, tier: 1, owned: 95, bye: '8' },
    { playerId: 3, name: 'RB1', team: 'DET', pos: 'RB', posEcr: 1, ecr: 2, tier: 1, owned: 98, bye: '6' },
    { playerId: 4, name: 'RB2', team: 'ATL', pos: 'RB', posEcr: 2, ecr: 5, tier: 2, owned: 92, bye: '12' },
    { playerId: 5, name: 'K1', team: 'DAL', pos: 'K', posEcr: 1, ecr: 90, tier: 9, owned: 95, bye: '5' },
  ]

  // Deterministic linear curve: rank 1 -> 200 points, -2 per rank, floored at 0.
  const curves: Record<string, (r: number) => number> = {
    QB: (r) => Math.max(0, 200 - (r - 1) * 2),
    RB: (r) => Math.max(0, 200 - (r - 1) * 2),
    WR: (r) => Math.max(0, 200 - (r - 1) * 2),
    TE: (r) => Math.max(0, 200 - (r - 1) * 2),
    K: (r) => Math.max(0, 200 - (r - 1) * 2),
    'D/ST': (r) => Math.max(0, 200 - (r - 1) * 2),
  }

  const settings = { budget: 200, teams: 12, rosterSize: 16, scoringFormat: 'ppr' as const }

  it('prices better ECR ranks higher within a position', () => {
    const { entries } = computeFantasyProsValues(players, settings, DEFAULT_STARTERS, curves)
    const qb1 = entries.find((e) => e.player.name === 'QB1')?.value ?? 0
    const qb2 = entries.find((e) => e.player.name === 'QB2')?.value ?? 0
    expect(qb1).toBeGreaterThan(qb2)
  })

  it('keeps every value at or above the $1 floor', () => {
    const { entries } = computeFantasyProsValues(players, settings, DEFAULT_STARTERS, curves)
    for (const e of entries) expect(e.value).toBeGreaterThanOrEqual(1)
  })

  it('prices kickers and defenses far cheaper than skill positions', () => {
    const { entries } = computeFantasyProsValues(players, settings, DEFAULT_STARTERS, curves)
    const k1 = entries.find((e) => e.player.name === 'K1')?.value ?? 999
    const rb1 = entries.find((e) => e.player.name === 'RB1')?.value ?? 0
    expect(k1).toBeLessThan(rb1)
    expect(k1).toBeLessThan(5)
  })

  it('computes replacement levels from the curve at starter depth', () => {
    const { assumptions } = computeFantasyProsValues(players, settings, DEFAULT_STARTERS, curves)
    // QB gets no flex share, so depth = 12 -> curve(12) = 200 - 22 = 178
    expect(assumptions.replacementLevels.QB).toBe(178)
    // RB depth = round((2 + 0.4) * 12) = 29 -> curve(29) = 200 - 56 = 144
    expect(assumptions.replacementLevels.RB).toBe(144)
    expect(assumptions.marketUnavailable).toBe(true)
  })

  it('is deterministic for the same inputs', () => {
    const a = computeFantasyProsValues(players, settings, DEFAULT_STARTERS, curves)
    const b = computeFantasyProsValues(players, settings, DEFAULT_STARTERS, curves)
    expect(a.entries.map((e) => e.value)).toEqual(b.entries.map((e) => e.value))
  })
})
