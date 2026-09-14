'use client'

import Link from 'next/link'
import { useState } from 'react'
import { type Team, sportPath } from '@/data/teams'
import { getEspnAbbr } from '@/lib/providers/espn'

function teamLogoUrl(team: Team): string {
  const path = sportPath[team.sport]
  if (!path) return ''
  const abbr = getEspnAbbr(team.id, team.abbreviation)
  return `https://a.espncdn.com/i/teamlogos/${path}/500/${abbr.toLowerCase()}.png`
}

export default function TeamCard({ team, sport }: { team: Team; sport: string }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const url = teamLogoUrl(team)

  return (
    <Link
      href={`/${sport}/${team.id}`}
      className="group hover-card fs-panel rounded-xl p-5 animate-fade-in"
      style={{ '--tint': team.colors.primary, '--tint-border': `${team.colors.primary}30`, '--card-color': team.colors.primary } as React.CSSProperties}
    >
      <div className="flex items-center gap-4 text-left">
        <div className="w-16 h-16 shrink-0 flex items-center justify-center">
          {logoFailed ? (
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: team.colors.primary }}>
              <span className="text-lg font-bold" style={{ color: team.colors.secondary }}>{team.abbreviation}</span>
            </div>
          ) : (
            <img
              src={url}
              alt={team.name}
              className="w-full h-full object-contain"
              loading="lazy"
              onError={() => setLogoFailed(true)}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="fs-title text-base text-white/90 leading-tight">{team.name}</h2>
          <p className="fs-meta mt-1.5 truncate">{team.conference} &middot; {team.division}</p>
        </div>
        <span className="fs-meta shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">&rarr;</span>
      </div>
    </Link>
  )
}