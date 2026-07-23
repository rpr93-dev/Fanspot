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
      className="group hover-card rounded-xl p-5 animate-fade-in"
      style={{ backgroundColor: `${team.colors.primary}15`, border: `1px solid ${team.colors.primary}20`, '--card-color': team.colors.primary } as React.CSSProperties}
    >
      <div className="flex flex-col items-center text-center">
        <div className="w-14 h-14 mb-3 flex items-center justify-center">
          {logoFailed ? (
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: team.colors.primary }}>
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
        <h2 className="text-sm font-medium text-white/90 leading-tight">{team.name}</h2>
        <p className="text-xs text-gray-500 mt-1">{team.conference?.substring(0, 3)} &middot; {team.division}</p>
      </div>
    </Link>
  )
}