'use client'

import { useState } from 'react'
import { useSearch } from '@/hooks/useSearch'
import { SearchResults } from '@/components/SearchResults'
import { SectionHeader } from '@/components/feedback'

/** Focused search interface (mobile entry point; desktop uses the nav field). */
export default function SearchPage() {
  const [query, setQuery] = useState('')
  const { teams, players, loading } = useSearch(query)

  return (
    <div className="min-h-screen fs-page">
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-8 max-w-2xl">
        <SectionHeader eyebrow="Teams · Players" title="Search" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try “Mahomes” or “Chiefs”…"
          aria-label="Search teams and players"
          className="fs-input !py-3 !text-base mb-4"
          autoFocus
          autoComplete="off"
        />
        {query.trim().length >= 2 ? (
          <div className="fs-panel-2 overflow-hidden">
            <SearchResults teams={teams} players={players} loading={loading} />
          </div>
        ) : (
          <p className="fs-meta text-center py-8">Type at least 2 characters to search.</p>
        )}
      </div>
    </div>
  )
}
