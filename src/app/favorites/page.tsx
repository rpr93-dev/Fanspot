'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useFavorites } from '@/hooks/useFavorites'
import { SectionHeader, EmptyState } from '@/components/feedback'
import { useSearch } from '@/hooks/useSearch'

function AddFavorites({ query }: { query: string }) {
  const { teams, loading } = useSearch(query)
  const { toggle } = useFavorites()
  if (query.trim().length < 2) return null
  return (
    <div className="fs-panel-2 p-3 mt-3">
      {loading && teams.length === 0 ? (
        <p className="fs-meta p-2">Searching…</p>
      ) : teams.length === 0 ? (
        <p className="text-sm text-fs-muted p-2">No teams match “{query}”.</p>
      ) : (
        teams.slice(0, 5).map((t) => (
          <div key={`${t.sport}:${t.teamId}`} className="flex items-center gap-3 p-2">
            <img
              src={`https://a.espncdn.com/i/teamlogos/${t.sport.toLowerCase()}/500/${t.abbr.toLowerCase()}.png`}
              alt=""
              className="w-7 h-7 object-contain"
              loading="lazy"
            />
            <span className="text-sm flex-1 truncate">{t.name}</span>
            <button
              type="button"
              className="fs-btn"
              onClick={() =>
                toggle({ kind: 'team', sport: t.sport, teamId: t.teamId, abbr: t.abbr, name: t.name })
              }
            >
              + Save
            </button>
          </div>
        ))
      )}
    </div>
  )
}

export default function FavoritesPage() {
  const { favorites, toggle } = useFavorites()
  const [query, setQuery] = useState('')

  const teamFavs = favorites.filter((f) => f.kind === 'team')
  const playerFavs = favorites.filter((f) => f.kind === 'player')

  return (
    <div className="min-h-screen fs-page">
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-8 max-w-4xl">
        <SectionHeader
          eyebrow="No account needed"
          title="Favorites"
          action={<p className="fs-meta hidden sm:block">Saved on this device</p>}
        />

        <div className="fs-panel p-4 sm:p-5 mb-6">
          <label htmlFor="fav-search" className="fs-meta block mb-2">
            Add teams
          </label>
          <input
            id="fav-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a team name…"
            className="fs-input"
            autoComplete="off"
          />
          <AddFavorites query={query} />
        </div>

        {favorites.length === 0 ? (
          <EmptyState
            title="No favorites yet."
            hint="Save teams (and soon players) to prioritize them across scores, news, and home."
          />
        ) : (
          <div className="space-y-6">
            {teamFavs.length > 0 && (
              <section>
                <h2 className="fs-title text-lg mb-3">Teams ({teamFavs.length})</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {teamFavs.map((f) =>
                    f.kind === 'team' ? (
                      <div key={`team:${f.sport}:${f.teamId}`} className="fs-panel p-3 flex items-center gap-3">
                        <img
                          src={`https://a.espncdn.com/i/teamlogos/${f.sport.toLowerCase()}/500/${f.abbr.toLowerCase()}.png`}
                          alt=""
                          className="w-9 h-9 object-contain shrink-0"
                          loading="lazy"
                        />
                        <Link
                          href={`/${f.sport.toLowerCase()}/${f.teamId}`}
                          className="flex-1 min-w-0 hover:text-fs-text"
                        >
                          <span className="block text-sm font-semibold truncate">{f.name}</span>
                          <span className="fs-meta">{f.sport}</span>
                        </Link>
                        <button type="button" className="fs-btn" onClick={() => toggle(f)}>
                          Remove
                        </button>
                      </div>
                    ) : null,
                  )}
                </div>
              </section>
            )}
            {playerFavs.length > 0 && (
              <section>
                <h2 className="fs-title text-lg mb-3">Players ({playerFavs.length})</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {playerFavs.map((f) =>
                    f.kind === 'player' ? (
                      <div key={`player:${f.sport}:${f.playerId}`} className="fs-panel p-3 flex items-center gap-3">
                        <span className="w-9 h-9 rounded-full bg-fs-panel-2 border border-fs-line shrink-0 flex items-center justify-center fs-mono text-xs text-fs-muted">
                          {f.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                        </span>
                        <Link
                          href={`/${f.sport.toLowerCase()}/player/${f.playerId}`}
                          className="flex-1 min-w-0 hover:text-fs-text"
                        >
                          <span className="block text-sm font-semibold truncate">{f.name}</span>
                          <span className="fs-meta">{f.sport}{f.teamAbbr ? ` · ${f.teamAbbr}` : ''}</span>
                        </Link>
                        <button type="button" className="fs-btn" onClick={() => toggle(f)}>
                          Remove
                        </button>
                      </div>
                    ) : null,
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
