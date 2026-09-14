/**
 * Local favorites (no accounts): favorite teams + players persisted to
 * localStorage. Favorites prioritize content (homepage, scoreboard, news),
 * never filter it.
 */

export interface FavoriteTeam {
  kind: 'team'
  sport: string
  teamId: string
  abbr: string
  name: string
}

export interface FavoritePlayer {
  kind: 'player'
  sport: string
  playerId: string
  name: string
  teamAbbr: string | null
}

export type Favorite = FavoriteTeam | FavoritePlayer

const STORAGE_KEY = 'fanspot:favorites:v1'

function readRaw(): Favorite[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (f): f is Favorite =>
        !!f &&
        typeof f === 'object' &&
        ((f as Favorite).kind === 'team' || (f as Favorite).kind === 'player'),
    )
  } catch {
    return []
  }
}

function writeRaw(favs: Favorite[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favs))
  } catch {
    /* storage full / private mode — favorites just don't persist */
  }
}

export function loadFavorites(): Favorite[] {
  return readRaw()
}

export function saveFavorites(favs: Favorite[]): void {
  writeRaw(favs)
}

function teamKey(f: FavoriteTeam): string {
  return `team:${f.sport.toUpperCase()}:${f.teamId}`
}

function playerKey(f: FavoritePlayer): string {
  return `player:${f.sport.toUpperCase()}:${f.playerId}`
}

export function favoriteKey(f: Favorite): string {
  return f.kind === 'team' ? teamKey(f) : playerKey(f)
}

export function isFavorite(favs: Favorite[], candidate: Favorite): boolean {
  const key = favoriteKey(candidate)
  return favs.some((f) => favoriteKey(f) === key)
}

export function toggleFavorite(favs: Favorite[], candidate: Favorite): Favorite[] {
  const key = favoriteKey(candidate)
  if (favs.some((f) => favoriteKey(f) === key)) {
    return favs.filter((f) => favoriteKey(f) !== key)
  }
  return [...favs, candidate]
}

/** Uppercase team abbreviations of favorited teams — for relevance boosts. */
export function favoriteTeamAbbrs(favs: Favorite[]): Set<string> {
  return new Set(
    favs.filter((f): f is FavoriteTeam => f.kind === 'team').map((f) => f.abbr.toUpperCase()),
  )
}

/** Favorited team ids (`sport:id`) — for news/story boosts. */
export function favoriteTeamIds(favs: Favorite[]): Set<string> {
  return new Set(
    favs
      .filter((f): f is FavoriteTeam => f.kind === 'team')
      .map((f) => `${f.sport.toUpperCase()}:${f.teamId}`),
  )
}
