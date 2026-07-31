import { describe, it, expect } from 'vitest'
import { resolveTeamTheme, adjustForDarkTheme, luminance, themeVars } from '../team-theme'
import { teams } from '@/data/teams'

describe('resolveTeamTheme', () => {
  it('returns null with no team code so the board keeps its neutral palette', () => {
    expect(resolveTeamTheme('nfl', null)).toBeNull()
    expect(resolveTeamTheme('nfl', '')).toBeNull()
  })

  it('returns null for an unknown code rather than guessing a team', () => {
    expect(resolveTeamTheme('nfl', 'ZZZ')).toBeNull()
  })

  it('does not match a team from another league', () => {
    // LAL is an NBA team; asking for it on an NFL board must not resolve.
    expect(resolveTeamTheme('nfl', 'LAL')).toBeNull()
    expect(resolveTeamTheme('nba', 'LAL')?.name).toBe('Los Angeles Lakers')
  })

  it('resolves by abbreviation or by slug id', () => {
    expect(resolveTeamTheme('nfl', 'NYG')?.name).toBe('New York Giants')
    expect(resolveTeamTheme('nfl', 'nyg')?.name).toBe('New York Giants')
  })

  it('gives the two accents enough separation to read as a pair', () => {
    const theme = resolveTeamTheme('nfl', 'PIT')
    expect(theme).not.toBeNull()
    expect(theme!.accent).not.toBe(theme!.accentSoft)
  })
})

describe('adjustForDarkTheme', () => {
  it('lifts a near-black brand color into the legible band', () => {
    // Raiders black would be invisible on the #0B0F0D board.
    const out = adjustForDarkTheme('#000000')
    expect(luminance(out)).toBeGreaterThanOrEqual(0.17)
  })

  it('lifts Giants navy while keeping it blue', () => {
    const out = adjustForDarkTheme('#0B2265')
    expect(luminance(out)).toBeGreaterThanOrEqual(0.17)
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16))
    expect(b).toBeGreaterThan(r)
    expect(b).toBeGreaterThan(g)
  })

  it('pulls a near-white brand color down off the glare ceiling', () => {
    expect(luminance(adjustForDarkTheme('#FFFFFF'))).toBeLessThanOrEqual(0.76)
  })

  it('leaves an already-legible color close to where it started', () => {
    const start = '#8BC53F'
    expect(Math.abs(luminance(adjustForDarkTheme(start)) - luminance(start))).toBeLessThan(0.05)
  })

  it('brings every team in the data set into the legible band', () => {
    for (const t of teams) {
      for (const hex of [t.colors.primary, t.colors.secondary]) {
        const l = luminance(adjustForDarkTheme(hex))
        expect(l, `${t.name} ${hex}`).toBeGreaterThanOrEqual(0.17)
        expect(l, `${t.name} ${hex}`).toBeLessThanOrEqual(0.76)
      }
    }
  })
})

describe('themeVars', () => {
  it('emits nothing when there is no theme', () => {
    expect(themeVars(null)).toEqual({})
  })

  it('only themes chrome — never the value/reach encoding', () => {
    const vars = themeVars(resolveTeamTheme('nfl', 'PIT'))
    expect(Object.keys(vars).sort()).toEqual(['--accent', '--accent-glow', '--accent-soft'])
    expect(Object.keys(vars)).not.toContain('--turf')
    expect(Object.keys(vars)).not.toContain('--red')
  })
})
