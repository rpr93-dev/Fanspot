'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { dispScore, isFinalGame, isLiveGame, isPrimetime } from '@/lib/scheduleWeek'
import { GameCard, type GameCardPhase } from '@/components/scoreboard/GameCard'

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

      {error && events && (
        <div role="status" className="fs-panel px-4 py-2.5 mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-fs-gold">
          <span>Couldn&rsquo;t refresh — showing the last updated schedule.</span>
          <button type="button" className="fs-btn" onClick={() => void load()}>Retry</button>
        </div>
      )}

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
            const phase: GameCardPhase = isCompleted ? 'final' : isLive ? 'live' : 'pre'
            const kickoff = new Date(game.date).toLocaleString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'America/New_York',
            })

            return (
              <GameCard
                key={game.id}
                href={`/nfl/game/${game.id}`}
                accent="#013369"
                meta={
                  game.week?.text ??
                  (typeof game.week?.number === 'number' ? `Week ${game.week.number}` : 'Game')
                }
                phase={phase}
                statusLabel={phase === 'live' ? detail : status?.shortDetail}
                away={{
                  abbr: awayTeam?.team?.abbreviation ?? '',
                  logo: awayTeam?.team?.logo ?? null,
                  score: dispScore(awayTeam?.score),
                  winner: awayTeam?.winner ?? null,
                }}
                home={{
                  abbr: homeTeam?.team?.abbreviation ?? '',
                  logo: homeTeam?.team?.logo ?? null,
                  score: dispScore(homeTeam?.score),
                  winner: homeTeam?.winner ?? null,
                }}
                liveStatsEventId={isLive ? game.id : null}
                footer={phase === 'pre' ? <p className="text-xs text-fs-muted">{kickoff} ET</p> : null}
              />
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
