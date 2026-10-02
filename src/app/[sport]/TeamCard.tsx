'use client'

import Link from 'next/link'
import { useState } from 'react'
import { type Team } from '@/data/teams'
import { teamLogoUrl } from '@/lib/teamLogo'

/**
 * One club in the hub's team grid: big crest, team name set large, and a clear
 * conference · division pill. Team colour drives the hover ring and crest
 * backdrop so each card reads as that club.
 */
export default function TeamCard({ team, sport, index = 0 }: { team: Team; sport: string; index?: number }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const url = teamLogoUrl(team)
  const accent = team.colors.primary

  return (
    <Link
      href={`/${sport}/${team.id}`}
      className="group hover-card fs-panel relative rounded-xl p-4 sm:p-5 overflow-hidden animate-fade-in"
      style={
        {
          '--tint': accent,
          '--tint-border': `${accent}30`,
          '--card-color': accent,
          animationDelay: `${Math.min(index, 12) * 35}ms`,
        } as React.CSSProperties
      }
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 h-full w-1 opacity-70"
        style={{ background: `linear-gradient(180deg, ${accent}, ${team.colors.secondary})` }}
      />
      <div className="flex items-center gap-4 text-left pl-1">
        <span
          className="w-16 h-16 shrink-0 grid place-items-center rounded-xl border"
          style={{ backgroundColor: `${accent}14`, borderColor: `${accent}2e` }}
        >
          {logoFailed ? (
            <span className="fs-title text-lg" style={{ color: accent }}>
              {team.abbreviation}
            </span>
          ) : (
            <img
              src={url}
              alt=""
              className="w-11 h-11 object-contain"
              loading="lazy"
              onError={() => setLogoFailed(true)}
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="fs-title text-lg leading-tight truncate group-hover:text-white">{team.name}</h2>
          <p className="mt-1.5 inline-flex items-center gap-1.5 fs-mono text-[10px] uppercase tracking-[0.1em] text-fs-muted-2">
            <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `${accent}1f`, color: accent }}>
              {team.conference}
            </span>
            <span>{team.division}</span>
          </p>
        </div>
        <span
          className="fs-meta shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
          style={{ color: accent }}
        >
          &rarr;
        </span>
      </div>
    </Link>
  )
}
