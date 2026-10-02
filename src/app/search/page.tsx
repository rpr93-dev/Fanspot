'use client'

import { useState } from 'react'
import { useSearch } from '@/hooks/useSearch'
import { SearchResults } from '@/components/SearchResults'
import { SectionHeader } from '@/components/feedback'

/** Focused search interface (mobile entry point; desktop uses the nav field). */
export default function SearchPage() {
  const [query, setQuery] = useState('')
  const { teams, players, loading, error } = useSearch(query)

  return (
    <div className="min-h-screen fs-page">
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-8">
        <SectionHeader as="h1" eyebrow="Teams · Players" title="Search" />
        <label htmlFor="site-search" className="fs-meta block mb-2">Search teams &amp; players</label>
        <input
          id="site-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try “Mahomes” or “Chiefs”…"
          className="fs-input !py-3 !text-base mb-4"
          autoFocus
          autoComplete="off"
        />
        {query.trim().length >= 2 ? (
          <div className="fs-panel-2 overflow-hidden">
            <SearchResults teams={teams} players={players} loading={loading} error={error} wide />
          </div>
        ) : (
          <p className="fs-meta text-center py-8">Type at least 2 characters to search.</p>
        )}
      </div>
    </div>
  )
}
