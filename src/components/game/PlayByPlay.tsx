import type { NormalizedPlay } from '@/lib/plays'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback'

/**
 * Chronological play-by-play, newest first. Scoring plays and big moments
 * (TD, INT, HR, goal, ejection...) render distinctly.
 */
export function PlayByPlay({
  plays,
  loading,
  error,
  onRetry,
}: {
  plays: NormalizedPlay[] | null
  loading: boolean
  error: string | null
  onRetry?: () => void
}) {
  if (loading && !plays) return <SkeletonRows count={8} height="h-14" />
  if (error && !plays) return <ErrorState message={`Couldn't load plays: ${error}`} onRetry={onRetry} />
  if (!plays || plays.length === 0) {
    return <EmptyState title="Play-by-play unavailable for this game." hint="Not every game carries live play data" />
  }

  const ordered = [...plays].reverse()
  let lastPeriod: number | null | undefined = undefined

  return (
    <ol className="space-y-1.5" aria-label="Play by play, most recent first">
      {ordered.map((p) => {
        const showPeriod = p.period !== lastPeriod
        lastPeriod = p.period
        return (
          <li key={p.id}>
            {showPeriod && p.periodLabel && (
              <p className="fs-meta pt-3 pb-1" aria-hidden="true">
                {p.periodLabel}
              </p>
            )}
            <div
              className={`rounded-lg px-3 py-2.5 border ${
                p.scoring
                  ? 'border-fs-turf/40 bg-fs-turf/[0.07]'
                  : p.highlight
                    ? 'border-fs-gold/30 bg-fs-gold/[0.05]'
                    : 'border-fs-line bg-transparent'
              }`}
            >
              <div className="flex items-baseline gap-2.5">
                {(p.periodLabel || p.clock) && (
                  <span className="fs-mono text-[11px] text-fs-muted-2 tabular-nums shrink-0 w-20">
                    {[p.periodLabel, p.clock].filter(Boolean).join(' ')}
                  </span>
                )}
                {p.teamAbbr && (
                  <span className="fs-mono text-[11px] font-bold text-fs-muted shrink-0 w-9">{p.teamAbbr}</span>
                )}
                <p className={`text-sm leading-snug flex-1 ${p.scoring || p.highlight ? 'text-fs-text font-medium' : 'text-white/80'}`}>
                  {p.text}
                </p>
                {p.scoring && (
                  <span className="fs-meta !text-fs-turf shrink-0" aria-label="Scoring play">
                    PTS
                  </span>
                )}
              </div>
              {p.detail && <p className="fs-meta mt-1 ml-[7.25rem]">{p.detail}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
