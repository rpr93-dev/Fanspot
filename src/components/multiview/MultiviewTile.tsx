'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { GameStreamPanel } from '@/components/streams/GameStreamPanel'
import { StreamPlayer } from '@/components/streams/StreamPlayer'
import { useRedzone } from '@/components/streams/RedzoneBoard'
import { GameStatusBadge } from '@/components/scoreboard/GameStatusBadge'
import { TeamIdentity } from '@/components/scoreboard/TeamIdentity'
import { EmptyState, ErrorState } from '@/components/feedback'
import { useLivePoll } from '@/hooks/useLivePoll'
import {
  SPORT_SLUGS,
  formatTipoff,
  normalizeEvent,
  normalizeSportKey,
  type NormalizedGame,
} from '@/lib/models'
import { isRedzoneSlot, slotKey, type MultiviewSlot } from '@/lib/multiview'

/**
 * One split-screen tile: live score header + stream, both kept mounted so
 * switching layouts never reloads a playing feed. Pause unmounts just the
 * player (stops its audio) while the score header keeps polling.
 */
export function MultiviewTile({
  slot,
  autoplay,
  paused,
  spotlighted,
  canSpotlight,
  onTogglePause,
  onToggleSpotlight,
  onRemove,
}: {
  slot: MultiviewSlot
  autoplay: boolean
  paused: boolean
  spotlighted: boolean
  canSpotlight: boolean
  onTogglePause: () => void
  onToggleSpotlight: () => void
  onRemove: () => void
}) {
  if (isRedzoneSlot(slot)) {
    return (
      <RedzoneTile
        paused={paused}
        spotlighted={spotlighted}
        canSpotlight={canSpotlight}
        autoplay={autoplay}
        onTogglePause={onTogglePause}
        onToggleSpotlight={onToggleSpotlight}
        onRemove={onRemove}
      />
    )
  }
  return (
    <GameTile
      slot={slot}
      paused={paused}
      spotlighted={spotlighted}
      canSpotlight={canSpotlight}
      autoplay={autoplay}
      onTogglePause={onTogglePause}
      onToggleSpotlight={onToggleSpotlight}
      onRemove={onRemove}
    />
  )
}

function TileShell({
  label,
  hubHref,
  header,
  controls,
  children,
}: {
  label: string
  hubHref: string | null
  header: React.ReactNode
  controls: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <article aria-label={label} className="fs-panel min-w-0 overflow-hidden flex flex-col">
      <div className="p-3 sm:p-4 border-b border-fs-line space-y-2.5">
        {header}
        <div className="flex flex-wrap items-center gap-1.5">
          {hubHref && (
            <Link href={hubHref} prefetch={false} className="fs-meta hover:text-fs-text underline-offset-2 hover:underline">
              Open Game Center →
            </Link>
          )}
          <span className="flex-1" />
          {controls}
        </div>
      </div>
      <div className="p-3 sm:p-4">{children}</div>
    </article>
  )
}

function TileControls({
  paused,
  spotlighted,
  canSpotlight,
  onTogglePause,
  onToggleSpotlight,
  onRemove,
  label,
}: {
  paused: boolean
  spotlighted: boolean
  canSpotlight: boolean
  onTogglePause: () => void
  onToggleSpotlight: () => void
  onRemove: () => void
  label: string
}) {
  const btn = 'fs-meta px-2 py-1 rounded-md hover:text-fs-text hover:bg-white/5'
  return (
    <>
      {canSpotlight && (
        <button type="button" className={btn} aria-pressed={spotlighted} onClick={onToggleSpotlight} title={spotlighted ? 'Back to grid' : 'Spotlight this game'}>
          {spotlighted ? '◧ Grid' : '◧ Spotlight'}
        </button>
      )}
      <button type="button" className={btn} aria-pressed={paused} onClick={onTogglePause} title={paused ? 'Resume this stream' : 'Pause this stream (stops its audio)'}>
        {paused ? '▶ Resume' : '⏸ Pause'}
      </button>
      <button type="button" className={btn} onClick={onRemove} aria-label={`Remove ${label} from split screen`}>
        ✕ Remove
      </button>
    </>
  )
}

function GameTile({
  slot,
  autoplay,
  paused,
  spotlighted,
  canSpotlight,
  onTogglePause,
  onToggleSpotlight,
  onRemove,
}: {
  slot: MultiviewSlot
  autoplay: boolean
  paused: boolean
  spotlighted: boolean
  canSpotlight: boolean
  onTogglePause: () => void
  onToggleSpotlight: () => void
  onRemove: () => void
}) {
  const sportKey = normalizeSportKey(slot.sport)
  const [game, setGame] = useState<NormalizedGame | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/game?sport=${slot.sport.toUpperCase()}&eventId=${encodeURIComponent(slot.eventId)}`, {
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`Game API returned ${res.status}`)
    const json = await res.json()
    const normalized = sportKey ? normalizeEvent(sportKey, json?.game) : null
    if (!normalized) throw new Error('No game data returned')
    setGame(normalized)
    setFailed(false)
  }, [slot.sport, slot.eventId, sportKey])

  useEffect(() => {
    let cancelled = false
    setGame(null)
    setFailed(false)
    load().catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [load])

  useLivePoll(load, () => (game?.status.phase === 'live' ? 30_000 : null), [load, game?.status.phase])

  const label = game ? `${game.away.abbr} at ${game.home.abbr}` : `${slot.sport.toUpperCase()} ${slot.eventId}`
  const hubHref = sportKey ? `/${SPORT_SLUGS[sportKey]}/game/${slot.eventId}` : null
  const key = slotKey(slot)

  return (
    <TileShell
      label={label}
      hubHref={hubHref}
      header={
        failed ? null : !game ? (
          <div className="fs-skeleton h-10" aria-hidden="true" />
        ) : (
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span className="min-w-0 flex-1">
              <TeamIdentity abbr={game.away.abbr} name={game.away.name} logo={game.away.logo} size="sm" />
            </span>
            <span className="fs-mono text-sm font-bold tabular-nums shrink-0">
              {game.away.scoreDisplay || '–'} – {game.home.scoreDisplay || '–'}
            </span>
            <span className="min-w-0 flex-1 flex justify-end">
              <TeamIdentity abbr={game.home.abbr} name={game.home.name} logo={game.home.logo} size="sm" />
            </span>
            <GameStatusBadge status={game.status} compactLabel={game.status.phase === 'pre' ? formatTipoff(game.date) : undefined} />
          </div>
        )
      }
      controls={
        <TileControls
          paused={paused}
          spotlighted={spotlighted}
          canSpotlight={canSpotlight}
          onTogglePause={onTogglePause}
          onToggleSpotlight={onToggleSpotlight}
          onRemove={onRemove}
          label={label}
        />
      }
    >
      {failed ? (
        <ErrorState message={`Couldn't load ${label}.`} onRetry={() => void load().catch(() => setFailed(true))} />
      ) : !game ? (
        <div className="fs-skeleton h-40" aria-hidden="true" />
      ) : paused ? (
        <div className="rounded-lg border border-fs-line-strong bg-black/40 p-6 text-center">
          <p className="text-sm text-fs-muted">Stream paused — scores above keep updating.</p>
          <button type="button" className="fs-btn mt-3" onClick={onTogglePause}>
            ▶ Resume stream
          </button>
        </div>
      ) : (
        <GameStreamPanel
          key={`${key}|${autoplay ? 'auto' : 'manual'}`}
          sport={slot.sport}
          awayName={game.away.name}
          homeName={game.home.name}
          autoplay={autoplay}
        />
      )}
    </TileShell>
  )
}

function RedzoneTile({
  paused,
  spotlighted,
  canSpotlight,
  autoplay,
  onTogglePause,
  onToggleSpotlight,
  onRemove,
}: {
  paused: boolean
  spotlighted: boolean
  canSpotlight: boolean
  autoplay: boolean
  onTogglePause: () => void
  onToggleSpotlight: () => void
  onRemove: () => void
}) {
  const rz = useRedzone()
  const match = rz?.match ?? null
  const live = rz?.live === true && match !== null

  return (
    <TileShell
      label="NFL RedZone"
      hubHref="/nfl/redzone"
      header={
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden="true"
            className="shrink-0 rounded-md px-2 py-1 text-[10px] font-black tracking-wider text-white"
            style={{ backgroundColor: '#E01B2E' }}
          >
            REDZONE
          </span>
          <span className="font-semibold text-sm truncate">NFL RedZone · every Sunday game</span>
          <span className="flex-1" />
          {rz === null ? null : live ? (
            <GameStatusBadge status={{ phase: 'live', completed: false, detail: 'Live', shortDetail: 'LIVE', clock: null, period: null, periodLabel: 'LIVE' }} />
          ) : (
            <span className="fs-meta">Off air</span>
          )}
        </div>
      }
      controls={
        <TileControls
          paused={paused}
          spotlighted={spotlighted}
          canSpotlight={canSpotlight}
          onTogglePause={onTogglePause}
          onToggleSpotlight={onToggleSpotlight}
          onRemove={onRemove}
          label="NFL RedZone"
        />
      }
    >
      {rz === null ? (
        <div className="fs-skeleton h-40" aria-hidden="true" />
      ) : paused ? (
        <div className="rounded-lg border border-fs-line-strong bg-black/40 p-6 text-center">
          <p className="text-sm text-fs-muted">RedZone paused.</p>
          <button type="button" className="fs-btn mt-3" onClick={onTogglePause}>
            ▶ Resume stream
          </button>
        </div>
      ) : !live || !match ? (
        <EmptyState title="RedZone is dark right now." hint="It airs Sunday afternoons (~12:00–7:30 PM ET) while games are live — the tile lights up automatically." />
      ) : (
        <div className="fs-panel p-4 sm:p-5">
          <p className="fs-meta mb-3">
            {match.title} · via Streamed (third-party — expect ads or popups)
          </p>
          <StreamPlayer key={match.id} match={match} autoplay={autoplay} />
        </div>
      )}
    </TileShell>
  )
}
