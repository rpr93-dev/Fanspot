import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GAME_HUB_PREFS,
  SPLIT_MAX,
  SPLIT_MIN,
  activeMultiviewPreset,
  clampSplit,
  isGameHubMode,
  isGameHubShell,
  isMultiviewLayout,
  multiviewBoardClass,
  multiviewTileClass,
  nextMode,
  parseGameHubPrefs,
  serializeGameHubPrefs,
} from '@/lib/gameHub'

describe('clampSplit', () => {
  it('keeps a valid ratio and clamps out-of-range values', () => {
    expect(clampSplit(0.5)).toBe(0.5)
    expect(clampSplit(0.1)).toBe(SPLIT_MIN)
    expect(clampSplit(0.99)).toBe(SPLIT_MAX)
  })
  it('falls back to the default for non-numeric input', () => {
    expect(clampSplit('nope')).toBe(DEFAULT_GAME_HUB_PREFS.split)
    expect(clampSplit(undefined)).toBe(DEFAULT_GAME_HUB_PREFS.split)
    expect(clampSplit(NaN)).toBe(DEFAULT_GAME_HUB_PREFS.split)
  })
})

describe('mode guards', () => {
  it('accepts only the three known modes/layouts', () => {
    expect(isGameHubMode('watch')).toBe(true)
    expect(isGameHubMode('command')).toBe(true)
    expect(isGameHubMode('multiview')).toBe(true)
    expect(isGameHubMode('theater')).toBe(false)
    expect(isMultiviewLayout('auto')).toBe(true)
    expect(isMultiviewLayout('grid')).toBe(false)
  })
  it('accepts only the two hub shells', () => {
    expect(isGameHubShell('old')).toBe(true)
    expect(isGameHubShell('v2')).toBe(true)
    expect(isGameHubShell('v3')).toBe(false)
  })
})

describe('nextMode', () => {
  it('cycles and wraps in both directions', () => {
    expect(nextMode('watch', 1)).toBe('command')
    expect(nextMode('multiview', 1)).toBe('watch')
    expect(nextMode('watch', -1)).toBe('multiview')
  })
})

describe('parseGameHubPrefs', () => {
  it('returns defaults for empty/corrupt input', () => {
    expect(parseGameHubPrefs(null)).toEqual(DEFAULT_GAME_HUB_PREFS)
    expect(parseGameHubPrefs('{not json')).toEqual(DEFAULT_GAME_HUB_PREFS)
    expect(parseGameHubPrefs('"a string"')).toEqual(DEFAULT_GAME_HUB_PREFS)
  })
  it('keeps valid fields and repairs invalid ones per-field', () => {
    const p = parseGameHubPrefs(
      JSON.stringify({ mode: 'command', split: 5, sidebarCollapsed: true, multiviewLayout: 'focus' }),
    )
    expect(p.mode).toBe('command')
    expect(p.split).toBe(SPLIT_MAX)
    expect(p.sidebarCollapsed).toBe(true)
    expect(p.multiviewLayout).toBe('focus')
  })
  it('drops unknown modes/layouts back to defaults', () => {
    const p = parseGameHubPrefs(JSON.stringify({ mode: 'theater', multiviewLayout: 'grid' }))
    expect(p.mode).toBe(DEFAULT_GAME_HUB_PREFS.mode)
    expect(p.multiviewLayout).toBe(DEFAULT_GAME_HUB_PREFS.multiviewLayout)
  })
  it('defaults the shell to Old and keeps a valid v2 opt-in', () => {
    expect(parseGameHubPrefs(JSON.stringify({ mode: 'watch' })).shell).toBe('old')
    expect(parseGameHubPrefs(JSON.stringify({ shell: 'v2' })).shell).toBe('v2')
    expect(parseGameHubPrefs(JSON.stringify({ shell: 'v3' })).shell).toBe('old')
    expect(DEFAULT_GAME_HUB_PREFS.shell).toBe('old')
  })
})

describe('serialize/parse round-trip', () => {
  it('preserves a valid prefs object', () => {
    const prefs = { shell: 'v2' as const, mode: 'multiview' as const, split: 0.4, sidebarCollapsed: true, multiviewLayout: 'stack' as const }
    expect(parseGameHubPrefs(serializeGameHubPrefs(prefs))).toEqual(prefs)
  })
  it('clamps the split on the way out', () => {
    const out = parseGameHubPrefs(
      serializeGameHubPrefs({ ...DEFAULT_GAME_HUB_PREFS, split: 0.01 }),
    )
    expect(out.split).toBe(SPLIT_MIN)
  })
})

describe('multiview layout presets', () => {
  it('gives a single column for one stream in every layout', () => {
    expect(multiviewBoardClass(1)).toContain('grid-cols-1')
    expect(multiviewBoardClass(1, 'focus')).toContain('grid-cols-1')
    expect(multiviewTileClass(1, 0, 'focus')).toBe('')
  })
  it('lifts the first tile for a 3-up auto layout', () => {
    expect(multiviewBoardClass(3)).toContain('xl:grid-cols-2')
    expect(multiviewTileClass(3, 0)).toBe('xl:col-span-2')
    expect(multiviewTileClass(3, 1)).toBe('')
  })
  it('forces a single column in stack layout', () => {
    expect(multiviewBoardClass(4, 'stack')).toBe('grid gap-3 grid-cols-1')
    expect(multiviewTileClass(4, 0, 'stack')).toBe('')
  })
  it('matches only the exact count+layout preset', () => {
    expect(activeMultiviewPreset(4, 'auto')?.count).toBe(4)
    expect(activeMultiviewPreset(4, 'stack')).toBeNull()
  })
})
