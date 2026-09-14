import Link from 'next/link'
import { SPORT_SLUGS, formatTipoff, type NormalizedGame } from '@/lib/models'
import { GameStatusBadge } from './GameStatusBadge'
import { TeamIdentity } from './TeamIdentity'

function SideScore({ score, dimmed }: { score: string; dimmed: boolean }) {
  return (
    <span
      className={`text-lg font-bold tabular-nums fs-mono ${dimmed ? 'text-fs-muted-2' : 'text-fs-text'}`}
    >
      {score || '–'}
    </span>
  )
}

/**
 * One game in the scoreboard rail. Links to the Game Center.
 * Live games get a subtle red ring — visible, not obnoxious.
 */
export function ScoreCard({ game }: { game: NormalizedGame }) {
  const href = `/${SPORT_SLUGS[game.sport]}/game/${game.id}`
  const isLive = game.status.phase === 'live'
  const isFinal = game.status.phase === 'final'
  const awayDim = isFinal && game.away.winner === false
  const homeDim = isFinal && game.home.winner === false
  const label = `${game.away.abbr} at ${game.home.abbr}, ${game.status.shortDetail || game.status.phase}`

  return (
    <Link
      href={href}
      aria-label={label}
      className={`fs-panel block w-56 sm:w-64 shrink-0 snap-start p-3 hover-card ${
        isLive ? 'ring-1 ring-fs-red/40' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="fs-meta truncate min-w-0 flex-1">
          {game.sport} · {game.weekText ?? formatTipoff(game.date)}
        </span>
        <GameStatusBadge
          status={game.status}
          compactLabel={game.status.phase === 'pre' ? formatTipoff(game.date) : undefined}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <TeamIdentity
            abbr={game.away.abbr}
            name={game.away.name}
            logo={game.away.logo}
            size="sm"
            showRecord={game.status.phase === 'pre'}
            record={game.away.recordSummary}
          />
          <SideScore score={game.away.scoreDisplay} dimmed={awayDim} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <TeamIdentity
            abbr={game.home.abbr}
            name={game.home.name}
            logo={game.home.logo}
            size="sm"
            showRecord={game.status.phase === 'pre'}
            record={game.home.recordSummary}
          />
          <SideScore score={game.home.scoreDisplay} dimmed={homeDim} />
        </div>
      </div>

      {game.status.phase === 'pre' && (
        <p className="fs-meta mt-2 truncate">
          {formatTipoff(game.date)}
          {game.broadcast ? ` · ${game.broadcast}` : ''}
        </p>
      )}
      {isLive && game.broadcast && (
        <p className="fs-meta mt-2 truncate">{game.broadcast}</p>
      )}
    </Link>
  )
}
