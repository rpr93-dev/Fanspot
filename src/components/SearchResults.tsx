'use client'

import Link from 'next/link'
import type { SearchData } from '@/hooks/useSearch'
import { sportConfig } from '@/data/teams'

function TeamRow({ team, onNavigate }: { team: SearchData['teams'][number]; onNavigate?: () => void }) {
  const color = sportConfig[team.sport]?.color ?? '#8a9990'
  return (
    <Link
      href={team.href}
      onClick={onNavigate}
      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/5 transition-colors"
    >
      <img
        src={`https://a.espncdn.com/i/teamlogos/${team.sport.toLowerCase()}/500/${team.abbr.toLowerCase()}.png`}
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

function PlayerRow({ player, onNavigate }: { player: SearchData['players'][number]; onNavigate?: () => void }) {
  return (
    <Link
      href={player.href}
      onClick={onNavigate}
      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/5 transition-colors"
    >
      <span className="w-9 h-9 rounded-full bg-fs-panel-2 border border-fs-line overflow-hidden shrink-0 flex items-center justify-center">
        {player.headshot ? (
          <img src={player.headshot} alt="" className="w-full h-full object-cover" loading="lazy" />
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
  onNavigate,
}: SearchData & { loading: boolean; onNavigate?: () => void }) {
  if (loading && teams.length === 0 && players.length === 0) {
    return (
      <div className="p-3 space-y-2" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="fs-skeleton h-12" />
        ))}
      </div>
    )
  }
  if (teams.length === 0 && players.length === 0) {
    return <p className="p-4 text-sm text-fs-muted text-center">No teams or players found.</p>
  }
  return (
    <div className="p-1.5 max-h-[60vh] overflow-y-auto">
      {teams.length > 0 && (
        <div className="mb-1">
          <p className="fs-meta px-2.5 pt-2 pb-1">Teams</p>
          {teams.map((t) => (
            <TeamRow key={`${t.sport}:${t.teamId}`} team={t} onNavigate={onNavigate} />
          ))}
        </div>
      )}
      {players.length > 0 && (
        <div>
          <p className="fs-meta px-2.5 pt-2 pb-1">Players</p>
          {players.map((p) => (
            <PlayerRow key={`${p.sport}:${p.playerId}`} player={p} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}
