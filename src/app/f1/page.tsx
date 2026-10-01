import Link from 'next/link'
import type { Metadata } from 'next'
import { sportConfig } from '@/data/teams'
import { F1Hub } from '@/components/f1/F1Hub'

export const metadata: Metadata = {
  title: 'Formula 1 - Fanspot',
  description: 'F1 calendar, championships, constructors, and live race timing with car positions.',
}

/** /f1 — league hub (static route wins over the generic [sport] page). */
export default function F1Page() {
  const config = sportConfig.F1
  return (
    <div className="min-h-screen fs-page" style={{ '--glow': `${config.color}22` } as React.CSSProperties}>
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10">
        <Link href="/" className="fs-meta hover:text-fs-text inline-block mb-8 transition-colors">&larr; All Leagues</Link>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-10">
          <div>
            <p className="fs-eyebrow mb-2" style={{ '--tint': config.color } as React.CSSProperties}>League Hub</p>
            <h1 className="fs-title text-5xl sm:text-6xl mb-3">{config.name}</h1>
          </div>
          <p className="fs-meta shrink-0">11 constructors · 22 drivers</p>
        </div>
        <F1Hub teamColor={config.color} />
      </div>
    </div>
  )
}
