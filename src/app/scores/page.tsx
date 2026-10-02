import type { Metadata } from 'next'
import Link from 'next/link'
import { SectionHeader } from '@/components/feedback'
import { SportMotif } from '@/components/SportMotif'
import { sportTheme } from '@/lib/sportTheme'
import type { SportKey } from '@/lib/models'

export const metadata: Metadata = {
  title: 'Scores - Fanspot',
  description: 'Live scores and schedules across the NFL, NBA, NHL, MLB, and Formula 1.',
}

const hubs: { href: string; sport: SportKey; label: string; hint: string }[] = [
  { href: '/nfl', sport: 'NFL', label: 'NFL Hub', hint: 'Scores · Schedule · Standings · Leaders' },
  { href: '/nba', sport: 'NBA', label: 'NBA Hub', hint: 'Scores · Schedule · Standings · Leaders' },
  { href: '/nhl', sport: 'NHL', label: 'NHL Hub', hint: 'Scores · Schedule · Standings · Leaders' },
  { href: '/mlb', sport: 'MLB', label: 'MLB Hub', hint: 'Scores · Schedule · Standings · Leaders' },
  { href: '/f1', sport: 'F1', label: 'F1 Hub', hint: 'Calendar · Live timing · Standings · Teams' },
]

/**
 * Scores destination. The global strip above is the full cross-league board
 * (Yesterday | Today | Tomorrow); this page adds league hub shortcuts.
 */
export default function ScoresPage() {
  return (
    <div className="min-h-screen fs-page">
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-8">
        <SectionHeader
          as="h1"
          eyebrow="All leagues"
          title="Scores"
          action={<p className="fs-meta hidden sm:block">Board above · updated live</p>}
        />
        <p className="text-sm text-fs-muted mb-6 max-w-2xl">
          The scoreboard strip above carries every league for the selected date — navigate
          Yesterday | Today | Tomorrow or pick any date. Tap a game to open its Game Center.
          For standings, schedules, and leaders, head to a league hub:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {hubs.map((h) => {
            const theme = sportTheme(h.sport)
            return (
              <Link
                key={h.href}
                href={h.href}
                className="fs-panel relative block p-5 hover-card overflow-hidden"
                style={{
                  '--tint': theme.accent,
                  '--tint-border': `${theme.accent}38`,
                  '--card-color': theme.accent,
                } as React.CSSProperties}
              >
                <SportMotif
                  motif={theme.motif}
                  color={theme.accent}
                  className="pointer-events-none absolute -right-4 -bottom-6 h-[150%] w-3/4 opacity-[0.14]"
                />
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-0 h-full w-1"
                  style={{ background: `linear-gradient(180deg, ${theme.accent}, ${theme.accent2})` }}
                />
                <h2 className="fs-title text-lg relative pl-1">{h.label}</h2>
                <p className="fs-meta mt-2 leading-relaxed relative pl-1">{h.hint}</p>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
