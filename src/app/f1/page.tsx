import Link from 'next/link'
import type { Metadata } from 'next'
import { sportConfig } from '@/data/teams'
import { F1Hub } from '@/components/f1/F1Hub'
import { SportHero } from '@/components/SportHero'

export const metadata: Metadata = {
  title: 'Formula 1 - Fanspot',
  description: 'F1 calendar, championships, constructors, news, and live race timing with car positions.',
}

/** /f1 — league hub (static route wins over the generic [sport] page). */
export default function F1Page() {
  const config = sportConfig.F1
  return (
    <div className="min-h-screen fs-page" style={{ '--glow': `${config.color}22` } as React.CSSProperties}>
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10">
        <Link href="/" className="fs-meta hover:text-fs-text inline-block mb-6 transition-colors">&larr; All Leagues</Link>
        <SportHero
          sport="F1"
          jumps={[
            { id: 'calendar', label: 'Calendar' },
            { id: 'standings', label: 'Standings' },
            { id: 'constructors', label: 'Constructors' },
            { id: 'news', label: 'News' },
          ]}
        />
        <F1Hub teamColor={config.color} />
      </div>
    </div>
  )
}
