import type { FantasySport, EspnFantasyPlayer, EspnFantasyResponse, SleeperPlayer, DraftType, ScoringFormat, StealScore, FantasyPlayerEnriched } from '@/lib/fantasy-types'
import { assertEspnShape, mapProTeamId, mapPosition } from '@/lib/fantasy-types'

describe('fantasy-types', () => {
  it('type assertions compile', () => {
    const _sport: FantasySport = 'nfl'
    const _draft: DraftType = 'snake'
    const _scoring: ScoringFormat = 'ppr'
    expect(_sport).toBe('nfl')
    expect(_draft).toBe('snake')
    expect(_scoring).toBe('ppr')
  })

  it('assertEspnShape throws on null', () => {
    expect(() => assertEspnShape(null)).toThrow('ESPN fantasy response is not an object')
  })

  it('assertEspnShape throws on missing players', () => {
    expect(() => assertEspnShape({})).toThrow('missing players array')
  })

  it('assertEspnShape passes valid shape', () => {
    expect(() => assertEspnShape({ players: [] })).not.toThrow()
  })

  it('mapProTeamId returns correct abbreviation', () => {
    expect(mapProTeamId('nfl', 18)).toBe('NE')
    expect(mapProTeamId('nba', 8)).toBe('GSW')
    expect(mapProTeamId('nhl', 25)).toBe('LAK')
    expect(mapProTeamId('mlb', 19)).toBe('NYY')
  })

  it('mapProTeamId returns undefined for unknown', () => {
    expect(mapProTeamId('nfl', 999)).toBeUndefined()
  })

  it('mapPosition returns correct position', () => {
    expect(mapPosition('nfl', 1)).toBe('QB')
    expect(mapPosition('nfl', 2)).toBe('RB')
    expect(mapPosition('nfl', 16)).toBe('D/ST')
    expect(mapPosition('nba', 5)).toBe('C')
    expect(mapPosition('nhl', 5)).toBe('G')
    expect(mapPosition('mlb', 11)).toBe('DH')
  })
})
