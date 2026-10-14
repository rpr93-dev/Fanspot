'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useLivePoll } from '@/hooks/useLivePoll'
import { easternTimeParts, type StreamMatch } from '@/lib/streams'
import type { NormalizedGame } from '@/lib/models'
import { relevanceSort } from '@/lib/models'
import { ScoreCard } from '@/components/scoreboard/ScoreCard'
import { EmptyState, ErrorState } from '@/components/feedback'
import { StreamPlayer } from '@/components/streams/StreamPlayer'
import { multiviewHref } from '@/lib/multiview'
import { useRedzone } from '@/components/streams/RedzoneBoard'

const RED = '#E01B2E'

/**
 * Custom Game Hub for NFL RedZone. Unlike a normal game hub there is no single
 * matchup: the stream is the RedZone channel and the companion column lists
 * every live Sunday game, each linking to its own Game Center. When RedZone is
 * dark (not Sunday / no games / no listing) the page explains why and links
 * back to the NFL slate.
 */
export function RedzoneView({ teamColor }: { teamColor: string }) {
  const rz = useRedzone()
  const [games, setGames] = useState<NormalizedGame[] | null>(null)
  const [failed, setFailed] = useState(false)
  // ET calendar date so the board matches the day the games are actually played.
  const { dateKey } = easternTimeParts()

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/scoreboard/multi?date=${dateKey}&sports=NFL`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`board returned ${res.status}`)
      const json = await res.json()
      setGames(json?.leagues?.NFL ?? [])
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [dateKey])

  useEffect(() => {
    void load()
  }, [load])

  useLivePoll(
    load,
    () => {
      if (!games) return 30_000
      if (games.some((g) => g.status.phase === 'live')) return 30_000
      return 5 * 60_000
    },
    [load, games != null],
  )

  const live = relevanceSort((games ?? []).filter((g) => g.status.phase === 'live'), undefined)
  const upcoming = relevanceSort((games ?? []).filter((g) => g.status.phase === 'pre'), undefined).slice(0, 8)
  const finals = relevanceSort((games ?? []).filter((g) => g.status.phase === 'final'), undefined).slice(0, 8)

  const match: StreamMatch | null = rz?.match ?? null
  const showStream = rz?.live === true && match !== null

  return (
    <div className="min-h-screen fs-page" style={{ '--glow': `${RED}1c` } as React.CSSProperties}>
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10">
        <Link
          href="/nfl"
          className="hover-lift fs-meta hover:text-fs-text inline-block mb-6"
          style={{ '--card-color': teamColor } as React.CSSProperties}
        >
          &larr; NFL
        </Link>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-6">
          <h1 className="fs-title text-3xl sm:text-4xl">NFL RedZone</h1>
          {showStream && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold tracking-wider bg-fs-red/15 text-fs-red">
              <span className="w-1.5 h-1.5 rounded-full bg-fs-red animate-pulse" aria-hidden="true" />
              LIVE
            </span>
          )}
        </div>

        {/* Stream-dominant two-column hub: the RedZone feed stays mounted on
            the left; the live-game board fills the companion column. */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
          <div className="min-w-0 lg:sticky lg:top-20 space-y-4">
            {rz === null ? (
              <div className="fs-skeleton h-64" aria-hidden="true" />
            ) : showStream && match ? (
              <div className="fs-panel p-4 sm:p-5">
                <p className="fs-meta mb-3">
                  {match.title} · via Streamed (third-party — expect ads or popups)
                </p>
                <StreamPlayer key={match.id} match={match} />
                <Link
                  href={multiviewHref([{ sport: 'nfl', eventId: 'redzone' }])}
                  prefetch={false}
                  className="fs-meta hover:text-fs-text inline-block mt-3 underline-offset-2 hover:underline"
                >
                  ▦ Split screen — RedZone alongside another game →
                </Link>
              </div>
            ) : (
              <div className="fs-panel p-6 text-center">
                <p className="fs-title text-lg">RedZone is dark right now</p>
                <p className="text-sm text-fs-muted mt-2 max-w-md mx-auto">
                  NFL RedZone airs Sunday afternoons (~12:00–7:30 PM ET) while the day&apos;s games are
                  being played. It appears here automatically once Sunday games kick off.
                </p>
                <Link href="/nfl" className="fs-btn mt-4 inline-flex">
                  Browse the NFL slate →
                </Link>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-5">
            <section aria-label="Live games">
              <h2 className="fs-eyebrow mb-3" style={{ '--tint': RED } as React.CSSProperties}>
                Live now
              </h2>
              {failed ? (
                <ErrorState message="Couldn't load today's games right now." onRetry={() => void load()} />
              ) : games === null ? (
                <div className="fs-skeleton h-24" aria-hidden="true" />
              ) : live.length === 0 ? (
                <EmptyState title="No games live right now." hint="Sunday kickoffs land here." />
              ) : (
                <div className="space-y-3">
                  {live.map((g) => (
                    <ScoreCard key={`${g.sport}:${g.id}`} game={g} className="w-full" />
                  ))}
                </div>
              )}
            </section>

            {upcoming.length > 0 && (
              <section aria-label="Upcoming games">
                <h2 className="fs-eyebrow mb-3">Up today</h2>
                <div className="space-y-3">
                  {upcoming.map((g) => (
                    <ScoreCard key={`${g.sport}:${g.id}`} game={g} className="w-full" />
                  ))}
                </div>
              </section>
            )}

            {finals.length > 0 && (
              <section aria-label="Recent finals">
                <h2 className="fs-eyebrow mb-3">Recent finals</h2>
                <div className="space-y-3">
                  {finals.map((g) => (
                    <ScoreCard key={`${g.sport}:${g.id}`} game={g} className="w-full" />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
