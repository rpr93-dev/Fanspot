import { describe, expect, it } from 'vitest'
import { abbrFromTeamName, findPlayer, normalizeName } from '../names'

describe('normalizeName', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeName('C.J. Stroud')).toBe('c j stroud')
    expect(normalizeName("D'Andre Swift")).toBe('d andre swift')
    expect(normalizeName('Amon-Ra St. Brown')).toBe('amon ra st brown')
  })

  it('drops jr/sr/roman suffixes', () => {
    expect(normalizeName('Patrick Mahomes II')).toBe('patrick mahomes')
    expect(normalizeName('Marvin Harrison Jr.')).toBe('marvin harrison')
  })

  it('collapses whitespace', () => {
    expect(normalizeName('  Bijan   Robinson  ')).toBe('bijan robinson')
  })
})

describe('abbrFromTeamName', () => {
  it('maps nicknames and cities', () => {
    expect(abbrFromTeamName('49ers')).toBe('SF')
    expect(abbrFromTeamName('San Francisco')).toBe('SF')
    expect(abbrFromTeamName('Chiefs')).toBe('KC')
    expect(abbrFromTeamName('Kansas City')).toBe('KC')
    expect(abbrFromTeamName('Green Bay')).toBe('GB')
    expect(abbrFromTeamName('Tampa Bay')).toBe('TB')
  })

  it('returns null for non-teams', () => {
    expect(abbrFromTeamName('Bijan Robinson')).toBeNull()
  })
})

describe('findPlayer', () => {
  const rows = [
    { name: 'Bijan Robinson', pos: 'RB', team: 'ATL' },
    { name: 'Josh Allen', pos: 'QB', team: 'BUF' },
    { name: 'Josh Allen', pos: 'LB', team: 'JAX' },
    { name: 'San Francisco 49ers D/ST', pos: 'D/ST', team: 'SF' },
    { name: 'Kansas City Chiefs D/ST', pos: 'D/ST', team: 'KC' },
  ]

  it('matches exact normalized names', () => {
    expect(findPlayer(rows, 'Bijan Robinson')?.pos).toBe('RB')
    expect(findPlayer(rows, 'C.J. Stroud')).toBeNull()
  })

  it('disambiguates same-name players with the position hint', () => {
    expect(findPlayer(rows, 'Josh Allen', 'QB')?.team).toBe('BUF')
    expect(findPlayer(rows, 'Josh Allen', 'LB')?.team).toBe('JAX')
    expect(findPlayer(rows, 'Josh Allen')?.team).toBe('BUF') // first match
  })

  it('matches D/ST by team alias', () => {
    expect(findPlayer(rows, '49ers Defense')?.team).toBe('SF')
    expect(findPlayer(rows, 'Chiefs D/ST')?.team).toBe('KC')
    expect(findPlayer(rows, 'San Francisco DEF')?.team).toBe('SF')
  })
})
