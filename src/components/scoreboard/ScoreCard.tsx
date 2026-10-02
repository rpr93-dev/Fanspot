import { SPORT_SLUGS, formatTipoff, type NormalizedGame } from '@/lib/models'
import { sportTheme } from '@/lib/sportTheme'
import { GameCard, type GameCardPhase } from './GameCard'

/**
 * One game in a scoreboard rail or grid. Adapter over the shared GameCard so
 * every league (except F1) renders the same standard card. Links to the Game
 * Center; live games get a subtle red ring via the card.
 */
export function ScoreCard({ game, className = 'w-56 sm:w-64 shrink-0 snap-start' }: { game: NormalizedGame; className?: string }) {
  const href = `/${SPORT_SLUGS[game.sport]}/game/${game.id}`
  const isLive = game.status.phase === 'live'
  const liveLabel = game.status.periodLabel && game.status.clock
    ? `${game.status.periodLabel} · ${game.status.clock}`
    : game.status.shortDetail || undefined

  const footer =
    game.status.phase === 'pre' ? (
      <p className="fs-meta truncate">
        {formatTipoff(game.date)}
        {game.broadcast ? ` · ${game.broadcast}` : ''}
      </p>
    ) : isLive && game.broadcast ? (
      <p className="fs-meta truncate">{game.broadcast}</p>
    ) : null

  return (
    <GameCard
      href={href}
      meta={`${game.sport} · ${game.weekText ?? formatTipoff(game.date)}`}
      phase={game.status.phase as GameCardPhase}
      statusLabel={game.status.phase === 'pre' ? formatTipoff(game.date) : liveLabel}
      away={{
        abbr: game.away.abbr,
        name: game.away.name,
        logo: game.away.logo,
        score: game.away.scoreDisplay,
        winner: game.away.winner,
        record: game.away.recordSummary,
      }}
      home={{
        abbr: game.home.abbr,
        name: game.home.name,
        logo: game.home.logo,
        score: game.home.scoreDisplay,
        winner: game.home.winner,
        record: game.home.recordSummary,
      }}
      footer={footer}
      accent={sportTheme(game.sport).accent}
      className={className}
    />
  )
}
