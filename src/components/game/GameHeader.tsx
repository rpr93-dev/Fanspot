import Link from 'next/link'
import { teams, sportPath } from '@/data/teams'
import { formatTipoff, type NormalizedGame, type SportKey } from '@/lib/models'
import { GameStatusBadge } from '@/components/scoreboard/GameStatusBadge'
import { TeamIdentity } from '@/components/scoreboard/TeamIdentity'

function teamHref(sport: SportKey, abbr: string): string | null {
  const t = teams.find(
    (x) => x.sport === sport && (x.abbreviation.toUpperCase() === abbr.toUpperCase()),
  )
  return t ? `/${sportPath[t.sport]}/${t.id}` : null
}

function Score({ value, small }: { value: string; small?: boolean }) {
  return (
    <span className={`fs-mono font-bold tabular-nums ${small ? 'text-2xl' : 'text-4xl sm:text-5xl'}`}>
      {value || '–'}
    </span>
  )
}

/**
 * Game Center header: away @ home with logos, records, state, clock,
 * venue, broadcast, and pre-game odds context.
 */
export function GameHeader({ game }: { game: NormalizedGame }) {
  const { away, home, status } = game
  const awayHref = teamHref(game.sport, away.abbr)
  const homeHref = teamHref(game.sport, home.abbr)
  const date = new Date(game.date)
  const dateStr = isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const side = (
    side: typeof away,
    href: string | null,
    align: 'left' | 'right',
  ) => (
    <div className={`flex-1 min-w-0 flex flex-col ${align === 'right' ? 'items-end text-right' : 'items-start'}`}>
      {href ? (
        <Link href={href} className="hover:opacity-90 transition-opacity">
          <TeamIdentity abbr={side.abbr} name={side.name} logo={side.logo} size="lg" />
        </Link>
      ) : (
        <TeamIdentity abbr={side.abbr} name={side.name} logo={side.logo} size="lg" />
      )}
      <p className="text-sm text-fs-muted mt-1 truncate max-w-full">{side.name}</p>
      {side.recordSummary && (
        <p className="fs-mono text-xs text-fs-muted-2 tabular-nums">{side.recordSummary}</p>
      )}
    </div>
  )

  return (
    <div className="fs-panel p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <span className="fs-meta truncate">
          {game.weekText ?? game.sport} · {dateStr}
          {status.phase === 'pre' && game.date ? ` · ${formatTipoff(game.date)}` : ''}
        </span>
        <GameStatusBadge status={status} />
      </div>

      <div className="flex items-start justify-between gap-3 sm:gap-6">
        {side(away, awayHref, 'left')}
        <div className="flex items-center gap-3 sm:gap-6 shrink-0 pt-1">
          <Score value={away.scoreDisplay} />
          <span className="fs-meta" aria-hidden="true">
            {status.phase === 'live' && status.periodLabel && status.clock
              ? `${status.periodLabel} ${status.clock}`
              : '@'}
          </span>
          <Score value={home.scoreDisplay} />
        </div>
        {side(home, homeHref, 'right')}
      </div>

      <div className="mt-4 pt-3 border-t border-fs-line flex flex-wrap gap-x-5 gap-y-1">
        {game.venueName && (
          <span className="text-xs text-fs-muted-2">
            {game.venueName}
            {game.venueCity ? ` · ${game.venueCity}` : ''}
          </span>
        )}
        {game.broadcast && <span className="text-xs text-fs-muted-2">📺 {game.broadcast}</span>}
        {status.phase === 'pre' && game.odds && (game.odds.spread != null || game.odds.total != null) && (
          <span className="fs-mono text-xs text-fs-muted-2 tabular-nums">
            {game.odds.spread != null ? `Spread ${game.odds.spread > 0 ? `+${game.odds.spread}` : game.odds.spread} ` : ''}
            {game.odds.total != null ? `O/U ${game.odds.total}` : ''}
          </span>
        )}
      </div>
    </div>
  )
}
