'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { teams, sportPath } from '@/data/teams'
import { STANDINGS_COLUMNS, type StandingGroup } from '@/lib/standings'
import type { SportKey } from '@/lib/models'
import { EmptyState, ErrorState } from './feedback'

function teamHref(sport: SportKey, teamId: string, abbr: string): string {
  if (teamId) {
    const t = teams.find((x) => x.id === teamId && x.sport === sport)
    if (t) return `/${sportPath[t.sport]}/${t.id}`
  }
  const fallback = teams.find((x) => x.sport === sport && x.abbreviation.toUpperCase() === abbr.toUpperCase())
  return fallback ? `/${sportPath[fallback.sport]}/${fallback.id}` : `/${sport.toLowerCase()}`
}

/** League standings grouped by conference/division. Team rows link to team hubs. */
export function StandingsTable({ sport }: { sport: SportKey }) {
  const [groups, setGroups] = useState<StandingGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/standings-league?sport=${sport}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Standings returned ${r.status}`)
        return r.json()
      })
      .then((json) => {
        if (!cancelled) setGroups(json.groups ?? [])
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load standings')
      })
    return () => {
      cancelled = true
    }
  }, [sport])

  const columns = STANDINGS_COLUMNS[sport]

  if (error) return <ErrorState message={`Couldn't load standings: ${error}`} />
  if (!groups) {
    return (
      <div className="grid gap-4 md:grid-cols-2" aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i} className="fs-skeleton h-64" />
        ))}
      </div>
    )
  }
  if (groups.length === 0) return <EmptyState title="Standings unavailable for this league right now." />

  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start">
      {groups.map((conf) => (
        <section key={conf.name || 'all'} aria-label={conf.name || 'Standings'}>
          {conf.name && <h3 className="fs-title text-lg mb-3">{conf.name}</h3>}
          <div className="space-y-5">
            {conf.divisions.map((div) => (
              <div key={div.name || 'all'}>
                {div.name && <h4 className="fs-meta mb-2">{div.name}</h4>}
                <div className="fs-panel overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[420px]">
                      <thead>
                        <tr className="border-b border-fs-line">
                          <th scope="col" className="text-left fs-meta font-medium px-3 py-2">
                            Team
                          </th>
                          {columns.map((c) => (
                            <th
                              key={c.key}
                              scope="col"
                              className="text-right fs-meta font-medium px-2 py-2 tabular-nums"
                            >
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {div.teams.map((row) => (
                          <tr key={row.abbr} className="border-b border-fs-line last:border-0 hover:bg-white/[0.03]">
                            <td className="px-3 py-2">
                              <Link
                                href={teamHref(sport, row.teamId, row.abbr)}
                                className="flex items-center gap-2 min-w-0 hover:text-fs-text"
                              >
                                {row.logo ? (
                                  <img src={row.logo} alt="" className="w-6 h-6 object-contain shrink-0" loading="lazy" />
                                ) : (
                                  <span className="w-6 h-6 shrink-0" aria-hidden="true" />
                                )}
                                <span className="font-semibold truncate">{row.abbr}</span>
                                <span className="hidden xl:inline text-xs text-fs-muted-2 truncate">{row.name}</span>
                              </Link>
                            </td>
                            {columns.map((c) => (
                              <td key={c.key} className="text-right px-2 py-2 tabular-nums fs-mono text-[13px]">
                                {row.extra[c.key] && row.extra[c.key] !== '-' ? row.extra[c.key] : '–'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
