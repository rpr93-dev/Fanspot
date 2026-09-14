import type { Metadata } from 'next'
import Link from 'next/link'
import { SectionHeader } from '@/components/feedback'

export const metadata: Metadata = {
  title: 'Scores - Fanspot',
  description: 'Live scores and schedules across the NFL, NBA, NHL, and MLB.',
}

const hubs = [
  { href: '/nfl', label: 'NFL Hub', hint: 'Scores · Schedule · Standings · Leaders' },
  { href: '/nba', label: 'NBA Hub', hint: 'Scores · Schedule · Standings · Leaders' },
  { href: '/nhl', label: 'NHL Hub', hint: 'Scores · Schedule · Standings · Leaders' },
  { href: '/mlb', label: 'MLB Hub', hint: 'Scores · Schedule · Standings · Leaders' },
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
          eyebrow="All leagues"
          title="Scores"
          action={<p className="fs-meta hidden sm:block">Board above · updated live</p>}
        />
        <p className="text-sm text-fs-muted mb-6 max-w-2xl">
          The scoreboard strip above carries every league for the selected date — navigate
          Yesterday | Today | Tomorrow or pick any date. Tap a game to open its Game Center.
          For standings, schedules, and leaders, head to a league hub:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {hubs.map((h) => (
            <Link key={h.href} href={h.href} className="fs-panel block p-5 hover-card">
              <h2 className="fs-title text-lg">{h.label}</h2>
              <p className="fs-meta mt-2 leading-relaxed">{h.hint}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
