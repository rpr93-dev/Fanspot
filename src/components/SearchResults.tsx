'use client'

import Link from 'next/link'
import type { SearchData } from '@/hooks/useSearch'
import { sportConfig } from '@/data/teams'
import { teamLogoCrest } from '@/lib/teamLogo'

function TeamRow({ team, onNavigate, id, active }: { team: SearchData['teams'][number]; onNavigate?: () => void; id?: string; active?: boolean }) {
  const color = sportConfig[team.sport]?.color ?? '#8a9990'
  return (
    <Link
      id={id}
      href={team.href}
      prefetch={false}
      onClick={onNavigate}
      role="option"
      aria-selected={active ?? false}
      className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${active ? 'bg-white/5' : 'hover:bg-white/5'}`}
    >
      <img
        aria-hidden="true"
        src={teamLogoCrest(team.sport, team.teamId, team.abbr)}
        alt=""
        className="w-9 h-9 object-contain shrink-0"
        loading="lazy"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-fs-text truncate">{team.name}</span>
        <span className="block fs-meta mt-0.5">
          {team.sport} · {team.conference} {team.division}
        </span>
      </span>
      <span
        className="fs-meta shrink-0 px-2 py-0.5 rounded-full border"
        style={{ borderColor: `${color}55`, color }}
      >
        TEAM
      </span>
    </Link>
  )
}

function PlayerRow({ player, onNavigate, id, active }: { player: SearchData['players'][number]; onNavigate?: () => void; id?: string; active?: boolean }) {
  return (
    <Link
      id={id}
      href={player.href}
      prefetch={false}
      onClick={onNavigate}
      role="option"
      aria-selected={active ?? false}
      className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${active ? 'bg-white/5' : 'hover:bg-white/5'}`}
    >
      <span className="w-9 h-9 rounded-full bg-fs-panel-2 border border-fs-line overflow-hidden shrink-0 flex items-center justify-center">
        {player.headshot ? (
          <img aria-hidden="true" src={player.headshot} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span className="fs-mono text-xs text-fs-muted-2">
            {player.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-fs-text truncate">{player.name}</span>
        <span className="block fs-meta mt-0.5 truncate">
          {player.teamAbbr ?? player.team ?? player.sport} · {player.sport}
        </span>
      </span>
      <span className="fs-meta shrink-0 px-2 py-0.5 rounded-full border border-fs-line-strong">
        PLAYER
      </span>
    </Link>
  )
}

export function SearchResults({
  teams,
  players,
  loading,
  error,
  activeIndex = -1,
  idPrefix = 'search-opt',
  wide = false,
  onNavigate,
}: SearchData & {
  loading: boolean
  error?: string | null
  activeIndex?: number
  idPrefix?: string
  /** Side-by-side Teams | Players columns on desktop (the standalone search page). */
  wide?: boolean
  onNavigate?: () => void
}) {
  if (loading && teams.length === 0 && players.length === 0) {
    return (
      <div className="p-3 space-y-2" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="fs-skeleton h-12" />
        ))}
      </div>
    )
  }
  if (error && teams.length === 0 && players.length === 0) {
    return <p role="alert" className="p-4 text-sm text-fs-red text-center">{error}</p>
  }
  if (teams.length === 0 && players.length === 0) {
    return <p className="p-4 text-sm text-fs-muted text-center">No teams or players found.</p>
  }
  const base = teams.length
  const twoCol = wide && teams.length > 0 && players.length > 0
  return (
    <div className={`p-1.5 ${wide ? 'max-h-[70vh]' : 'max-h-[60vh]'} overflow-y-auto`}>
      <div className={twoCol ? 'grid gap-4 md:grid-cols-2 items-start' : undefined}>
      {teams.length > 0 && (
        <div className={twoCol ? '' : 'mb-1'}>
          <p className="fs-meta px-2.5 pt-2 pb-1">Teams</p>
          {teams.map((t, i) => (
            <TeamRow
              key={`${t.sport}:${t.teamId}`}
              team={t}
              id={`${idPrefix}-${i}`}
              active={i === activeIndex}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
      {players.length > 0 && (
        <div>
          <p className="fs-meta px-2.5 pt-2 pb-1">Players</p>
          {players.map((p, i) => (
            <PlayerRow
              key={`${p.sport}:${p.playerId}`}
              player={p}
              id={`${idPrefix}-${base + i}`}
              active={base + i === activeIndex}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
      </div>
    </div>
  )
}
