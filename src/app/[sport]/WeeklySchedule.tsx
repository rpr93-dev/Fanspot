'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  dispScore,
  isFinalGame,
  isLiveGame,
  isPrimetime,
  LIVE_STAT_ROWS,
} from '@/lib/scheduleWeek'

interface GameEvent {
  id: string
  date: string
  name: string
  shortName: string
  week?: { number: number; text: string }
  competitions: any[]
}

function gameDetail(e: any): string {
  const st = e?.competitions?.[0]?.status?.type
  return st?.shortDetail ?? null
}

/** Head-to-head live team stats for a game in progress. Polls on the same
 *  cadence as the schedule while the game runs; hides itself when empty. */
function LiveStatsBlock({ eventId }: { eventId: string }) {
  const [stats, setStats] = useState<{ away: Record<string, string>; home: Record<string, string> } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function grab() {
      try {
        const res = await fetch(`/api/live-stats?eventId=${eventId}`, { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled && json?.stats) setStats(json.stats)
      } catch { /* keep last snapshot */ }
    }
    grab()
    const id = setInterval(() => { if (!document.hidden) grab() }, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [eventId])

  const rows = (stats
    ? LIVE_STAT_ROWS
        .map((r) => ({ label: r.label, away: stats.away[r.key] ?? '', home: stats.home[r.key] ?? '' }))
        .filter((r) => r.away.trim() !== '' || r.home.trim() !== '')
    : [])

  if (rows.length === 0) {
    return <p className="text-xs text-fs-muted-2 animate-pulse py-1">Loading live stats…</p>
  }

  return (
    <div className="space-y-0.5 py-1 tabular-nums">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,5.5rem)_minmax(0,1fr)] items-center gap-2 text-xs leading-5">
          <span className={`text-right font-semibold ${num(r.away) >= num(r.home) ? 'text-fs-text' : 'text-fs-muted-2'}`}>{r.away || '—'}</span>
          <span className="text-center text-fs-muted-2 truncate">{r.label}</span>
          <span className={`text-left font-semibold ${num(r.home) > num(r.away) ? 'text-fs-text' : 'text-fs-muted-2'}`}>{r.home || '—'}</span>
        </div>
      ))}
    </div>
  )
}

function num(v: string | undefined): number {
  if (!v) return -1
  const m = String(v).trim().match(/^([\d.]+)/)
  return m ? parseFloat(m[1]) : -1
}

export default function WeeklySchedule({
  week: weekParam,
  view: viewParam,
  currentWeek,
}: {
  week?: number
  view?: string
  currentWeek: number
}) {
  const week = weekParam && weekParam >= 1 && weekParam <= 18 ? weekParam : currentWeek
  const view = viewParam === 'primetime' ? 'primetime' : 'all'

  const [events, setEvents] = useState<GameEvent[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/schedule-week?sport=nfl&week=${week}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`Schedule API returned ${res.status}`)
      const json = await res.json()
      setEvents((json?.events ?? []) as GameEvent[])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [week])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  // Poll cadence follows the game clock: fast while anything is live or
  // kicking off within the gameday window (so `pre` flips to `in` on the
  // card without a manual refresh), slow otherwise.
  useEffect(() => {
    if (!events) return
    const now = Date.now()
    const urgent = events.some((e) => {
      if (isLiveGame(e)) return true
      if (isFinalGame(e)) return false
      const t = new Date(e.date).getTime()
      return Number.isFinite(t) && Math.abs(now - t) < 6 * 60 * 60 * 1000
    })
    const id = setInterval(() => { if (!document.hidden) load() }, urgent ? 30_000 : 15 * 60_000)
    return () => clearInterval(id)
  }, [events, load])

  const allGames = [...(events ?? [])].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  )
  const primetimeGames = allGames.filter((g) => isPrimetime(g.date))
  const displayGames = view === 'all' ? allGames : primetimeGames
  const liveCount = allGames.filter(isLiveGame).length

  return (
    <div className="mb-10">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <p className="fs-eyebrow mb-2" style={{ '--tint': '#013369' } as React.CSSProperties}>NFL Schedule</p>
          <h2 className="fs-title text-3xl sm:text-4xl">
            {week === currentWeek ? 'This Week' : `Week ${week}`}
            {liveCount > 0 && (
              <span className="ml-3 inline-flex items-center gap-1.5 align-middle px-2.5 py-1 rounded-full text-xs font-bold tracking-wider bg-fs-red/15 text-fs-red">
                <span className="w-1.5 h-1.5 rounded-full bg-fs-red animate-pulse" />
                {liveCount} LIVE
              </span>
            )}
          </h2>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
          {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
            <Link
              key={w}
              href={`/nfl?week=${w}&view=${view}`}
              className={`px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
                week === w
                  ? 'bg-[#013369] text-white shadow-lg'
                  : w === currentWeek
                    ? 'bg-fs-gold/10 text-fs-gold hover:bg-fs-gold/20 hover:text-fs-gold'
                    : 'bg-white/5 text-fs-muted hover:bg-white/10 hover:text-fs-text'
              }`}
            >
              {w === currentWeek ? `Week ${w} · now` : `Week ${w}`}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <Link
          href={`/nfl?week=${week}&view=all`}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            view !== 'primetime'
              ? 'bg-[#013369] text-white shadow-lg'
              : 'bg-white/5 text-fs-muted hover:bg-white/10 hover:text-fs-text'
          }`}
        >
          All Games ({allGames.length})
        </Link>
        <Link
          href={`/nfl?week=${week}&view=primetime`}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            view === 'primetime'
              ? 'bg-[#013369] text-white shadow-lg'
              : 'bg-white/5 text-fs-muted hover:bg-white/10 hover:text-fs-text'
          }`}
        >
          Primetime ({primetimeGames.length})
        </Link>
      </div>

      {loading && !events ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="fs-skeleton h-40 rounded-xl" />
          ))}
        </div>
      ) : error && !events ? (
        <div className="fs-panel p-6 text-center">
          <p className="text-fs-red">Couldn&rsquo;t load the schedule: {error}</p>
        </div>
      ) : displayGames.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayGames.map((game) => {
            const comp = game.competitions?.[0]
            const teamsList = comp?.competitors ?? []
            const homeTeam = teamsList.find((t: any) => t.homeAway === 'home')
            const awayTeam = teamsList.find((t: any) => t.homeAway === 'away')
            const status = comp?.status?.type
            const isCompleted = isFinalGame(game)
            const isLive = isLiveGame(game)
            const detail = gameDetail(game)

            return (
              <Link key={game.id} href={`/nfl/game/${game.id}`} className="block group">
                <div
                  className={`fs-panel p-4 sm:p-5 hover-card cursor-pointer group transition-all duration-300 ${isLive ? 'ring-1 ring-fs-red/40' : ''}`}
                  style={{ '--tint': '#013369', '--tint-border': '#01336926', '--card-color': '#013369' } as React.CSSProperties}
                >
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <span className="fs-meta truncate">
                      {game.week?.text ??
                        (typeof game.week?.number === 'number' ? `Week ${game.week.number}` : 'Game')}
                    </span>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                        isCompleted
                          ? 'bg-white/10 text-fs-muted-2'
                          : isLive
                            ? 'bg-fs-red/20 text-fs-red animate-pulse'
                            : 'bg-fs-gold/20 text-fs-gold'
                      }`}
                    >
                      {isLive ? `LIVE${detail ? ` · ${detail}` : ''}` : isCompleted ? 'FINAL' : status?.shortDetail || 'PRE'}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {awayTeam && (
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {awayTeam.team?.logo && (
                            <img src={awayTeam.team.logo} alt="" className="w-8 h-8 object-contain" />
                          )}
                          <span className="font-semibold text-sm truncate">{awayTeam.team?.abbreviation}</span>
                          {awayTeam.winner === true && !isLive && (
                            <span className="text-[10px] font-bold text-fs-turf">W</span>
                          )}
                        </div>
                        <span className={`text-lg font-bold tabular-nums ${isCompleted && awayTeam.winner !== true ? 'text-fs-muted-2' : ''}`}>
                          {dispScore(awayTeam.score) || '-'}
                        </span>
                      </div>
                    )}

                    <div className="border-t border-fs-line"></div>

                    {homeTeam && (
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {homeTeam.team?.logo && (
                            <img src={homeTeam.team.logo} alt="" className="w-8 h-8 object-contain" />
                          )}
                          <span className="font-semibold text-sm truncate">{homeTeam.team?.abbreviation}</span>
                          {homeTeam.winner === true && !isLive && (
                            <span className="text-[10px] font-bold text-fs-turf">W</span>
                          )}
                        </div>
                        <span className={`text-lg font-bold tabular-nums ${isCompleted && homeTeam.winner !== true ? 'text-fs-muted-2' : ''}`}>
                          {dispScore(homeTeam.score) || '-'}
                        </span>
                      </div>
                    )}
                  </div>

                  {isLive && (
                    <div className="mt-3 pt-3 border-t border-fs-line">
                      <LiveStatsBlock eventId={game.id} />
                    </div>
                  )}

                  {!isLive && !isCompleted && (
                    <div className="mt-3 pt-3 border-t border-fs-line">
                      <p className="text-xs text-fs-muted">
                        {new Date(game.date).toLocaleString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric',
                          hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
                        })} ET
                      </p>
                    </div>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="fs-panel p-6 text-center">
          <p className="text-fs-muted">
            {view === 'primetime' ? 'No primetime games this week.' : `No games found for Week ${week}.`}
          </p>
        </div>
      )}
    </div>
  )
}
