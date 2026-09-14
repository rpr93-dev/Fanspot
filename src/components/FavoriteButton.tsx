'use client'

import { useFavorites } from '@/hooks/useFavorites'
import { isFavorite, type Favorite } from '@/lib/favorites'

/** Star toggle for teams/players. Persists to localStorage, no account needed. */
export function FavoriteButton({
  favorite,
  label,
}: {
  favorite: Favorite
  label?: string
}) {
  const { favorites, toggle, hydrated } = useFavorites()
  // Pre-hydration the button must match the server render (unsaved).
  const active = hydrated && isFavorite(favorites, favorite)
  return (
    <button
      type="button"
      onClick={() => toggle(favorite)}
      aria-pressed={active}
      aria-label={active ? `Remove ${label ?? favorite.name} from favorites` : `Add ${label ?? favorite.name} to favorites`}
      title={active ? 'Remove from favorites' : 'Add to favorites'}
      className={`fs-btn !px-3 transition-colors ${active ? '!text-fs-gold !border-fs-gold/50' : ''}`}
    >
      {active ? '★' : '☆'} <span className="hidden sm:inline">{active ? 'Saved' : 'Save'}</span>
    </button>
  )
}
