import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadFavorites,
  saveFavorites,
  toggleFavorite,
  isFavorite,
  favoriteTeamAbbrs,
  favoriteTeamIds,
  type Favorite,
} from '../favorites'

const chiefs: Favorite = { kind: 'team', sport: 'NFL', teamId: 'kc', abbr: 'KC', name: 'Kansas City Chiefs' }
const mahomes: Favorite = { kind: 'player', sport: 'NFL', playerId: '4040715', name: 'Patrick Mahomes', teamAbbr: 'KC' }

beforeEach(() => {
  // vitest node env has no DOM storage — minimal in-memory stub.
  const store = new Map<string, string>()
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true })
})

describe('favorites', () => {
  it('starts empty and persists toggles', () => {
    expect(loadFavorites()).toEqual([])
    const afterAdd = toggleFavorite([], chiefs)
    expect(isFavorite(afterAdd, chiefs)).toBe(true)
  })

  it('toggles off an existing favorite', () => {
    const added = toggleFavorite([], chiefs)
    const removed = toggleFavorite(added, { ...chiefs })
    expect(removed).toEqual([])
    expect(isFavorite(removed, chiefs)).toBe(false)
  })

  it('keeps teams and players independent', () => {
    let favs: Favorite[] = []
    favs = toggleFavorite(favs, chiefs)
    favs = toggleFavorite(favs, mahomes)
    expect(favs).toHaveLength(2)
    // A player with the same name shape does not collide with the team.
    expect(isFavorite(favs, chiefs)).toBe(true)
    expect(isFavorite(favs, mahomes)).toBe(true)
  })

  it('survives reload via localStorage', () => {
    saveFavorites([chiefs, mahomes])
    expect(loadFavorites()).toHaveLength(2)
  })

  it('derives abbreviation and id sets', () => {
    const favs = [chiefs, mahomes]
    expect(favoriteTeamAbbrs(favs)).toEqual(new Set(['KC']))
    expect(favoriteTeamIds(favs)).toEqual(new Set(['NFL:kc']))
  })

  it('ignores corrupt storage', () => {
    localStorage.setItem('fanspot:favorites:v1', 'not-json{')
    expect(loadFavorites()).toEqual([])
  })
})
