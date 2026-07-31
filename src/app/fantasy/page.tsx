'use client'

import Link from 'next/link'
import { isFantasySportLive } from '@/lib/providers/fantasy-constants'

const sports = [
  { slug: 'nfl', name: 'NFL', gradient: 'from-red-600/20 to-blue-600/20' },
  { slug: 'nba', name: 'NBA', gradient: 'from-orange-600/20 to-blue-600/20' },
  { slug: 'mlb', name: 'MLB', gradient: 'from-red-600/20 to-blue-600/20' },
  { slug: 'nhl', name: 'NHL', gradient: 'from-gray-600/20 to-blue-600/20' },
]

export default function FantasyPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white px-4 sm:px-6 py-8">
      <h1 className="text-3xl font-bold mb-2">Fantasy Steals</h1>
      <p className="text-gray-400 mb-8">
        Find value picks across your fantasy drafts using projection vs ADP analysis.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {sports.map((s) => {
          const live = isFantasySportLive(s.slug)
          if (!live) {
            return (
              <div
                key={s.slug}
                className="rounded-xl bg-gray-900/40 p-6 border border-white/5 opacity-50 cursor-not-allowed"
              >
                <h2 className="text-2xl font-bold">{s.name}</h2>
                <p className="text-sm text-gray-500 mt-1">Coming soon</p>
              </div>
            )
          }
          return (
            <Link
              key={s.slug}
              href={`/fantasy/${s.slug}`}
              className={`rounded-xl bg-gradient-to-br ${s.gradient} p-6 border border-white/10 hover:border-white/30 transition-all hover:scale-[1.02]`}
            >
              <h2 className="text-2xl font-bold">{s.name}</h2>
              <p className="text-sm text-gray-400 mt-1">View steals</p>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
