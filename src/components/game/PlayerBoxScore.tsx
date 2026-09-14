import Link from 'next/link'
import { playerPageHref, type SportKey } from '@/lib/models'
import { playerStatLabels } from '@/lib/roster-stats'
import { EmptyState, SkeletonRows } from '@/components/feedback'

export function getPeriodLabels(sport: SportKey | string): string[] {
  const key = sport.toUpperCase()
  if (key === 'NBA' || key === 'NFL') {
    return ['Q1', 'Q2', 'Q3', 'Q4', 'OT1', 'OT2', 'OT3', 'OT4', 'OT5', 'OT6', 'OT7', 'OT8']
  }
  if (key === 'NHL') return ['1st', '2nd', '3rd', 'OT', 'SO', '', '', '', '', '', '', '']
  if (key === 'MLB') {
    return ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th']
  }
  return ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']
}

function prettifyName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()
}

interface BoxTeam {
  abbreviation: string
  linescores?: number[]
  homeAway?: string
}

/** Period-by-period scoring lines. */
export function LinescoreTable({ sport, away, home }: { sport: SportKey; away: BoxTeam | null; home: BoxTeam | null }) {
  if (!away && !home) return null
  const maxPeriods = Math.max(away?.linescores?.length ?? 0, home?.linescores?.length ?? 0)
  if (maxPeriods === 0) return null
  const labels = getPeriodLabels(sport)
  const sum = (arr: number[] = []) => arr.reduce((a, b) => a + b, 0)

  const row = (team: BoxTeam | null, fallback: string) => (
    <div className="flex items-center justify-center gap-2 sm:gap-2.5">
      <span className="w-8 text-right font-semibold text-fs-muted">{team?.abbreviation ?? fallback}</span>
      {Array.from({ length: maxPeriods }, (_, i) => (
        <span key={i} className="flex flex-col items-center min-w-6">
          <span className="text-[9px] uppercase tracking-wider opacity-70">{labels[i] ?? ''}</span>
          <span className="font-mono">{team?.linescores?.[i] ?? '–'}</span>
        </span>
      ))}
      <span className="flex flex-col items-center min-w-6">
        <span className="text-[9px] uppercase tracking-wider opacity-70">T</span>
        <span className="font-mono font-semibold text-fs-text">{team ? sum(team.linescores) : '–'}</span>
      </span>
    </div>
  )

  return (
    <div className="mb-4 overflow-x-auto" data-testid="linescores">
      <div className="mx-auto flex w-fit min-w-full flex-col gap-1 text-[11px] tabular-nums text-fs-muted-2">
        {row(away, 'Away')}
        {row(home, 'Home')}
      </div>
    </div>
  )
}

interface Athlete {
  id: string
  displayName: string
  jersey?: string
  position?: string
  stats?: Record<string, string>
}

interface PlayerCategory {
  label: string
  statNames: string[]
  athletes: Athlete[]
}

interface PlayerTeam {
  teamAbbr: string
  categories: PlayerCategory[]
}

/**
 * Sport-specific player box scores. Desktop renders side-by-side tables;
 * mobile scrolls horizontally. Player names link to player pages.
 */
export function PlayerBoxScore({
  sport,
  playerStats,
  loading,
}: {
  sport: SportKey
  playerStats: PlayerTeam[] | null
  loading: boolean
}) {
  if (loading && !playerStats) return <SkeletonRows count={3} height="h-40" />
  const hasAny = (playerStats ?? []).some((t) => t.categories?.some((c) => c.athletes?.length > 0))
  if (!hasAny) {
    return <EmptyState title="Box score available once the game begins." />
  }

  return (
    <div className="grid md:grid-cols-2 gap-4 min-w-0 items-start">
      {(playerStats ?? []).map((team, ti) => {
        const athleteCount = team.categories.reduce((n, c) => n + (c.athletes?.length ?? 0), 0)
        return (
          <div key={team.teamAbbr || ti} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <p className="text-sm font-semibold tracking-wider uppercase">{team.teamAbbr}</p>
              <span className="fs-meta shrink-0">{athleteCount} players</span>
            </div>
            {team.categories.map((cat, ci) => (
              <div key={ci} className="mb-3 rounded-lg overflow-hidden border border-fs-line">
                <div className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-fs-muted-2 bg-white/[0.02]">
                  {cat.label}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-fs-muted-2">
                        <th scope="col" className="text-left px-2.5 py-1.5 font-medium">
                          Player
                        </th>
                        {cat.statNames.map((n, ni) => (
                          <th key={ni} scope="col" className="text-right px-2 py-1.5 font-medium tabular-nums">
                            {playerStatLabels[n] ?? prettifyName(n)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cat.athletes.map((a, i) => (
                        <tr key={a.id || `ath-${i}`} className="text-fs-text/75 border-t border-fs-line">
                          <td className="px-2.5 py-1.5 whitespace-nowrap">
                            <span className="font-mono text-fs-muted-2 mr-1.5">{a.jersey ?? ''}</span>
                            {a.id ? (
                              <Link
                                href={playerPageHref(sport, a.id)}
                                className="text-sm font-medium text-fs-text/90 hover:text-fs-text hover:underline underline-offset-2"
                              >
                                {a.displayName}
                              </Link>
                            ) : (
                              <span className="text-sm font-medium text-fs-text/90">{a.displayName}</span>
                            )}
                            {a.position ? <span className="text-fs-muted-2 ml-1 text-xs">{a.position}</span> : null}
                          </td>
                          {cat.statNames.map((n, ni) => (
                            <td key={ni} className="px-2 py-1.5 text-right font-mono tabular-nums text-[13px]">
                              {a.stats?.[n] ?? <span className="text-fs-muted-2">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
