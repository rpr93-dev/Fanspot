'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  loadFavorites,
  saveFavorites,
  toggleFavorite,
  favoriteTeamAbbrs,
  type Favorite,
} from '@/lib/favorites'

/**
 * Favorites state synced with localStorage.
 *
 * SSR-safe by construction: the initial state is ALWAYS empty (matching the
 * server render), and stored favorites load in an effect after mount. Reading
 * localStorage during the first client render would diverge from SSR HTML
 * and crash hydration (React #418).
 */
export function useFavorites() {
  const [favorites, setFavorites] = useState<Favorite[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setFavorites(loadFavorites())
    setHydrated(true)
  }, [])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key == null || e.key.endsWith(':favorites:v1')) setFavorites(loadFavorites())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback((candidate: Favorite) => {
    setFavorites((prev) => {
      const next = toggleFavorite(prev, candidate)
      saveFavorites(next)
      return next
    })
  }, [])

  return { favorites, toggle, hydrated, favoriteAbbrs: favoriteTeamAbbrs(favorites) }
}
