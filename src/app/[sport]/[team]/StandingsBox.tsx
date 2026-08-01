'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { getEspnAbbr } from '@/lib/sports-api'

interface StandingsEntry {
  abbr: string
  name: string
  logo: string
  record: string
  conference: string
  division: string
  teamId: string
}

interface DivisionGroup {
  name: string
  teams: StandingsEntry[]
}

interface ConferenceGroup {
  name: string
  divisions: DivisionGroup[]
}

interface StandingsBoxProps {
  standings: ConferenceGroup[]
  teamId: string
  teamAbbr: string
  teamConference: string
  teamColor: string
  sport: string
  loading: boolean
  standingsMessage?: string
}

export default function StandingsBox({ standings, teamId, teamAbbr, teamConference, teamColor, sport, loading, standingsMessage }: StandingsBoxProps) {
  const [showAll, setShowAll] = useState(false)
  const [compact, setCompact] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const filteredStandings = showAll
    ? standings
    : standings.filter((c) => c.name === teamConference)

  const hasMultipleConferences = standings.some((c) => c.name !== teamConference)

  useEffect(() => {
    setCompact(showAll)
  }, [showAll])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const check = () => {
      if (el.scrollHeight > el.clientHeight + 1) setCompact(true)
    }
    requestAnimationFrame(check)
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [filteredStandings])

  const c = compact

  return (
    <div className="fs-panel p-6 flex flex-col" style={{ '--tint': teamColor, '--tint-border': `${teamColor}20` } as React.CSSProperties}>
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h2 className="fs-eyebrow" style={{ '--tint': teamColor } as React.CSSProperties}>Standings</h2>
        {hasMultipleConferences && (
          <button onClick={() => setShowAll((v) => !v)}
            className={`fs-chip ${showAll ? 'fs-chip-active' : ''}`}>
            {showAll ? 'Filtered' : 'All'}
          </button>
        )}
      </div>
      {loading ? (
        <div className="animate-pulse space-y-3 flex-1">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="fs-skeleton h-8" style={{ backgroundColor: `${teamColor}14` }} />
          ))}
        </div>
      ) : standingsMessage ? (
        <p className="text-sm text-fs-muted animate-fade-in-up flex-1 flex items-center justify-center">{standingsMessage}</p>
      ) : filteredStandings.length === 0 ? (
        <p className="text-sm text-fs-muted animate-fade-in flex-1 flex items-center justify-center">Standings unavailable</p>
      ) : (
        <div ref={listRef} className="overflow-y-auto min-h-0" style={{ scrollbarWidth: 'thin' }}>
          <div className="animate-fade-in-up space-y-3" style={{ animationDelay: '100ms' }}>
            {filteredStandings.map((conf) => (
              <div key={conf.name}>
                <p className={`fs-meta mb-2 ${c ? 'text-[11px]' : ''}`}>{conf.name}</p>
                {conf.divisions.map((div) => (
                  <div key={div.name} className={c ? 'mb-1.5' : 'mb-2.5'}>
                    <p className={`mb-1 ml-1 text-fs-muted-2 ${c ? 'text-[11px]' : 'text-xs'}`}>{div.name}</p>
                    <div className="space-y-px">
                      {div.teams.map((entry, i) => {
                        const isMyTeam = entry.abbr === getEspnAbbr(teamId, teamAbbr)
                        return (
                          <Link key={entry.abbr} href={`/${sport}/${entry.teamId}`}
                            className={`hover-lift flex items-center gap-2 rounded-lg ${c ? 'px-2 py-0.5' : 'px-2.5 py-1'}`}
                            style={{
                              backgroundColor: isMyTeam ? `${teamColor}18` : 'transparent',
                              '--card-color': teamColor,
                            } as React.CSSProperties}>
                            <span className={`w-4 text-right text-fs-muted-2 font-mono ${c ? 'text-[11px]' : 'text-xs'}`}>{i + 1}</span>
                            <img src={entry.logo} alt="" className="w-3.5 h-3.5 object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            <span className={`flex-1 truncate ${isMyTeam ? 'text-fs-text' : 'text-fs-text/60'} ${c ? 'text-[11px] leading-[14px]' : 'text-xs'}`}>{entry.name.replace(/^(Los Angeles|Las Vegas|New York|New England|San Francisco|San Diego|Tampa Bay|Green Bay|Kansas City|Oklahoma City|Golden State|New Orleans|Salt Lake City|St\. Louis|Portland|Oklahoma )/, '')}</span>
                            {entry.record && <span className={`font-mono text-fs-muted shrink-0 ${c ? 'text-[11px]' : 'text-xs'}`}>{entry.record}</span>}
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
