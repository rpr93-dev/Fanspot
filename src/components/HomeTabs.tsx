'use client'

import { useState } from 'react'
import Link from 'next/link'
import BiggestStories from './BiggestStories'

interface League {
  id: string
  name: string
  fullName: string
  color: string
}

export default function HomeTabs({ leagues }: { leagues: League[] }) {
  const [tab, setTab] = useState<'leagues' | 'stories'>('leagues')

  return (
    <div>
      <div className="flex justify-center mb-10">
        <div className="inline-flex gap-1 p-1 rounded-full border border-fs-line bg-fs-panel/60">
          {(['leagues', 'stories'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`fs-tab ${tab === t ? 'fs-tab-active' : ''}`}
            >
              {t === 'leagues' ? 'Leagues' : 'Biggest Stories'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'leagues' ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {leagues.map((league) => (
            <Link
              key={league.id}
              href={`/${league.id}`}
              className="league-card fs-panel group relative p-8 text-center transition-all duration-300 hover:-translate-y-1.5 hover:scale-[1.03] active:scale-[0.98]"
              style={{
                '--tint': league.color,
                '--tint-border': `${league.color}38`,
                '--glow-color': `${league.color}60`,
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
              } as React.CSSProperties}
            >
              <div className="w-20 h-20 mx-auto mb-5 flex items-center justify-center">
                <img
                  src={`https://a.espncdn.com/i/teamlogos/leagues/500/${league.id}.png`}
                  alt={league.name}
                  className="w-full h-full object-contain"
                  loading="lazy"
                />
              </div>
              <h2 className="fs-title text-xl text-white/90 mb-1">{league.name}</h2>
              <p className="fs-meta leading-relaxed">{league.fullName}</p>
            </Link>
          ))}
        </div>
      ) : (
        <BiggestStories />
      )}

      {tab === 'leagues' && (
        <p className="text-center mt-16 fs-meta">
          Select a league to browse teams and dashboards
        </p>
      )}
    </div>
  )
}
