'use client'

import Link from 'next/link'
import { leadersForTeam, type LeaderTeam } from '@/lib/gameLeaders'
import { normalizeSportKey, playerPageHref } from '@/lib/models'

/**
 * Game Leaders — side-by-side top performers for the two teams, derived from
 * the box score already on the page (`/api/box-score`), so there is no extra
 * request and nothing invented. Player names link to their player page when
 * the feed supplies an id.
 *
 * Renders nothing at all before the game starts or when the feed carries no
 * per-player statistics, which keeps the overview free of empty scaffolding.
 */
export function GameLeaders({
  sport,
  playerStats,
  awayAbbr,
  homeAbbr,
  limit = 4,
  className = '',
}: {
  sport: string
  playerStats: LeaderTeam[] | null | undefined
  awayAbbr: string
  homeAbbr: string
  limit?: number
  className?: string
}) {
  // Only link out when the sport maps to a real player route (an unknown
  // sport would otherwise build a `/undefined/player/..` href).
  const sportKey = normalizeSportKey(sport)
  const columns = [
    { abbr: awayAbbr, rows: leadersForTeam(playerStats, awayAbbr, limit) },
    { abbr: homeAbbr, rows: leadersForTeam(playerStats, homeAbbr, limit) },
  ]
  if (columns.every((c) => c.rows.length === 0)) return null

  return (
    <section aria-label="Game leaders" className={`fs-panel p-4 sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-1">
        <h2 className="fs-title text-lg">Game Leaders</h2>
        <span className="fs-meta">Top performers</span>
      </div>

      <div className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {columns.map((col) => (
          <div key={col.abbr} className="min-w-0">
            <p className="fs-meta mb-2 pb-1 border-b border-[rgba(242,245,241,0.08)]">{col.abbr}</p>
            {col.rows.length === 0 ? (
              <p className="text-sm text-fs-muted">No player stats yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {col.rows.map((leader, i) => (
                  <li
                    key={`${leader.statLabel}-${leader.playerId ?? leader.playerName}-${i}`}
                    className="flex items-start justify-between gap-3"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-snug text-fs-text/95">
                        {leader.jersey ? (
                          <span className="fs-mono mr-1.5 text-xs text-fs-muted-2">{leader.jersey}</span>
                        ) : null}
                        {leader.playerId && sportKey ? (
                          <Link
                            href={playerPageHref(sportKey, leader.playerId)}
                            className="underline-offset-2 hover:text-fs-text hover:underline"
                          >
                            {leader.playerName}
                          </Link>
                        ) : (
                          leader.playerName
                        )}
                      </span>
                      <span className="fs-meta mt-0.5 block">
                        {leader.statLabel}
                        {leader.position ? ` · ${leader.position}` : ''}
                      </span>
                    </span>
                    <span className="fs-mono shrink-0 text-base font-bold leading-tight tabular-nums text-fs-text">
                      {leader.value}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
