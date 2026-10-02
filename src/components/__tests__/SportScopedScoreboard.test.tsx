import { describe, it, expect } from 'vitest'
import { shouldShowScoreboard } from '../SportScopedScoreboard'

describe('shouldShowScoreboard', () => {
  it('hides the strip on the homepage', () => {
    expect(shouldShowScoreboard('/')).toBe(false)
    expect(shouldShowScoreboard(null)).toBe(false)
  })

  it('hides the strip everywhere inside the league sections', () => {
    expect(shouldShowScoreboard('/nfl')).toBe(false)
    expect(shouldShowScoreboard('/nba/lal')).toBe(false)
    expect(shouldShowScoreboard('/nhl/game/123')).toBe(false)
    expect(shouldShowScoreboard('/MLB/bos')).toBe(false)
    expect(shouldShowScoreboard('/nfl/player/123')).toBe(false)
  })

  it('keeps the strip on cross-league browsing pages', () => {
    expect(shouldShowScoreboard('/scores')).toBe(true)
    expect(shouldShowScoreboard('/fantasy/nfl')).toBe(true)
  })

  it('hides the strip on the search, favorites, and news tools', () => {
    expect(shouldShowScoreboard('/search')).toBe(false)
    expect(shouldShowScoreboard('/favorites')).toBe(false)
    expect(shouldShowScoreboard('/news')).toBe(false)
  })
})
