'use client'

import { useEffect, useRef, useState } from 'react'
import type { PlayerResult, TeamResult } from '@/app/api/search/route'

export interface SearchData {
  teams: TeamResult[]
  players: PlayerResult[]
}

/**
 * Debounced search against /api/search. Fast: teams resolve from cached
 * static data, players from a short-TTL server cache — no per-keystroke
 * provider fan-out.
 */
export function useSearch(query: string, delayMs = 300) {
  const [data, setData] = useState<SearchData>({ teams: [], players: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setData({ teams: [], players: [] })
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const id = ++seq.current
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
        if (!res.ok) throw new Error(`Search returned ${res.status}`)
        const json = (await res.json()) as SearchData
        if (seq.current === id) setData({ teams: json.teams ?? [], players: json.players ?? [] })
      } catch {
        if (seq.current === id) {
          setData({ teams: [], players: [] })
          setError('Search failed — check your connection and try again.')
        }
      } finally {
        if (seq.current === id) setLoading(false)
      }
    }, delayMs)
    return () => clearTimeout(timer)
  }, [query, delayMs])

  return { ...data, loading, error }
}
