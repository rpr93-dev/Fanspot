'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { teams, sportPath } from '@/data/teams'
import { STANDINGS_COLUMNS, type StandingGroup } from '@/lib/standings'
import type { SportKey } from '@/lib/models'
import { sportTheme } from '@/lib/sportTheme'
import { EmptyState, ErrorState } from './feedback'

function teamHref(sport: SportKey, teamId: string, abbr: string): string {
  if (teamId) {
    const t = teams.find((x) => x.id === teamId && x.sport === sport)
    if (t) return `/${sportPath[t.sport]}/${t.id}`
  }
  const fallback = teams.find((x) => x.sport === sport && x.abbreviation.toUpperCase() === abbr.toUpperCase())
  return fallback ? `/${sportPath[fallback.sport]}/${fallback.id}` : `/${sport.toLowerCase()}`
}

/** Plain-language tooltips so abbreviated columns are legible to newcomers. */
const COLUMN_HELP: Record<string, string> = {
  'W-L-T': 'Wins-losses-ties',
  'W-L': 'Wins-losses',
  'W-L-OTL': 'Wins-losses-overtime losses',
  PCT: 'Winning percentage',
  GB: 'Games behind the leader',
  STRK: 'Current streak (W = wins, L = losses)',
  PF: 'Points for (scored)',
  PA: 'Points against (allowed)',
  GF: 'Goals for',
  GA: 'Goals against',
  PTS: 'Points',
  GP: 'Games played',
  L10: 'Record over the last ten games',
  W: 'Wins',
  'W-P': 'Wins-position',
}

/** League standings grouped by conference/division. Team rows link to team hubs. */
export function StandingsTable({ sport }: { sport: SportKey }) {
  const [groups, setGroups] = useState<StandingGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const theme = sportTheme(sport)

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
      <div className="grid gap-5 md:grid-cols-2" aria-hidden="true">
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
        <section key={conf.name || 'all'} aria-label={conf.name || 'Standings'} className="min-w-0">
          {conf.name && (
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-1 h-5 rounded-full" style={{ background: theme.accent }} />
              <h3 className="fs-title text-lg">{conf.name}</h3>
            </div>
          )}
          <div className="space-y-5">
            {conf.divisions.map((div) => (
              <div key={div.name || 'all'}>
                {div.name && (
                  <h4 className="fs-mono text-[11px] uppercase tracking-[0.14em] text-fs-muted mb-2">
                    {div.name}
                  </h4>
                )}
                <div className="fs-panel overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[420px]">
                      <thead>
                        <tr className="border-b border-fs-line bg-white/[0.02]">
                          <th scope="col" className="text-left fs-meta font-medium px-3 py-2.5 w-10">
                            #
                          </th>
                          <th scope="col" className="text-left fs-meta font-medium px-3 py-2.5">
                            Team
                          </th>
                          {columns.map((c) => (
                            <th
                              key={c.key}
                              scope="col"
                              title={COLUMN_HELP[c.label]}
                              className="text-right fs-meta font-medium px-2.5 py-2.5 tabular-nums cursor-help"
                            >
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {div.teams.map((row, i) => {
                          const team = teams.find((x) => x.sport === sport && (x.id === row.teamId || x.abbreviation === row.abbr))
                          const accent = team?.colors.primary ?? theme.accent
                          return (
                            <tr
                              key={row.abbr}
                              className="border-b border-fs-line last:border-0 hover:bg-white/[0.04] transition-colors"
                            >
                              <td className="px-3 py-2.5">
                                <span
                                  className="fs-mono text-xs tabular-nums grid place-items-center w-5 h-5 rounded"
                                  style={
                                    i === 0
                                      ? { backgroundColor: `${accent}22`, color: accent }
                                      : { color: 'var(--color-fs-muted-2)' }
                                  }
                                >
                                  {i + 1}
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
                                <Link
                                  href={teamHref(sport, row.teamId, row.abbr)}
                                  className="flex items-center gap-2.5 min-w-0 hover:text-fs-text"
                                >
                                  {row.logo ? (
                                    <img src={row.logo} alt="" className="w-6 h-6 object-contain shrink-0" loading="lazy" />
                                  ) : (
                                    <span className="w-6 h-6 shrink-0" aria-hidden="true" />
                                  )}
                                  <span className="font-semibold truncate">{row.abbr}</span>
                                  <span className="hidden lg:inline text-xs text-fs-muted-2 truncate">{row.name}</span>
                                </Link>
                              </td>
                              {columns.map((c) => (
                                <td key={c.key} className="text-right px-2.5 py-2.5 tabular-nums fs-mono text-[13px]">
                                  {row.extra[c.key] && row.extra[c.key] !== '-' ? row.extra[c.key] : '–'}
                                </td>
                              ))}
                            </tr>
                          )
                        })}
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
