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

// Playoff slots by conference (non-MLB: ranked across divisions; MLB: top per division)
const PLAYOFF_SLOTS: Record<string, number> = {
  NFL: 7,
  NBA: 6,
  NHL: 8,
  MLB: 3,
}

const CITY_PREFIX =
  /^(Los Angeles|Las Vegas|New York|New England|San Francisco|San Diego|Tampa Bay|Green Bay|Kansas City|Oklahoma City|Golden State|New Orleans|Salt Lake City|St\. Louis|Portland|Oklahoma )/

function parseRecord(record: string): { w: number; l: number; pct: number } {
  const parts = record.split('-')
  const w = parseInt(parts[0], 10) || 0
  const l = parseInt(parts[1], 10) || 0
  const games = w + l
  return { w, l, pct: games > 0 ? w / games : 0 }
}

function formatPct(record: string): string {
  const { pct } = parseRecord(record)
  return pct ? pct.toFixed(3).replace(/^0/, '') : '—'
}

function gamesBehind(record: string, leaderRecord: string): string {
  const team = parseRecord(record)
  const leader = parseRecord(leaderRecord)
  const gb = (leader.w - team.w + (team.l - leader.l)) / 2
  if (gb <= 0) return '—'
  return Number.isInteger(gb) ? String(gb) : gb.toFixed(1)
}

export default function StandingsBox({
  standings,
  teamId,
  teamAbbr,
  teamConference,
  teamColor,
  sport,
  loading,
  standingsMessage,
}: StandingsBoxProps) {
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

  return (
    <div
      className="fs-panel p-5 sm:p-6 flex flex-col"
      style={{ '--tint': teamColor, '--tint-border': `${teamColor}20` } as React.CSSProperties}
    >
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h2 className="fs-eyebrow" style={{ '--tint': teamColor } as React.CSSProperties}>
          Standings
        </h2>
        {hasMultipleConferences && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className={`fs-chip ${showAll ? 'fs-chip-active' : ''}`}
          >
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
        <p className="text-sm text-fs-muted animate-fade-in-up flex-1 flex items-center justify-center">
          {standingsMessage}
        </p>
      ) : filteredStandings.length === 0 ? (
        <p className="text-sm text-fs-muted animate-fade-in flex-1 flex items-center justify-center">
          Standings unavailable
        </p>
      ) : (
        <div
          ref={listRef}
          className="overflow-y-auto min-h-0 pr-1 -mr-1"
          style={{ scrollbarWidth: 'thin' }}
        >
          <div className="animate-fade-in-up space-y-5" style={{ animationDelay: '100ms' }}>
            {filteredStandings.map((conf) => (
              <div key={conf.name}>
                <p className="fs-meta mb-3 text-[11px]">{conf.name}</p>
                {conf.divisions.map((div) => {
                  const leaderRecord = div.teams[0]?.record ?? ''
                  return (
                    <div key={div.name} className={compact ? 'mb-2' : 'mb-4'}>
                      <p className="mb-1.5 px-1 text-[10px] uppercase tracking-[0.16em] text-fs-muted-2">
                        {div.name}
                      </p>

                      {/* column header */}
                      <div
                        className="flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wider fs-mono"
                        style={{ color: `${teamColor}90` }}
                      >
                        <span className="w-5 text-center shrink-0">#</span>
                        <span className="w-4 shrink-0" />
                        <span className="flex-1">Team</span>
                        <span className="w-11 text-right shrink-0">W-L</span>
                        {!compact && (
                          <span className="w-10 text-right shrink-0">PCT</span>
                        )}
                        {!compact && (
                          <span className="w-8 text-right shrink-0">GB</span>
                        )}
                      </div>

                      <div className="space-y-px">
                        {div.teams.map((entry, i) => {
                          const isMyTeam = entry.abbr === getEspnAbbr(teamId, teamAbbr)
                          const playoff = PLAYOFF_SLOTS[sport.toUpperCase()] != null && i < PLAYOFF_SLOTS[sport.toUpperCase()]!
                          return (
                            <Link
                              key={entry.abbr}
                              href={`/${sport}/${entry.teamId}`}
                              className={`hover-lift group flex items-center gap-1 rounded-md px-2 ${
                                compact ? 'py-0.5' : 'py-1'
                              } ${isMyTeam ? 'shadow-sm' : ''}`}
                              style={{
                                backgroundColor: isMyTeam ? `${teamColor}16` : 'transparent',
                                border: `1px solid ${isMyTeam ? `${teamColor}30` : 'transparent'}`,
                                '--card-color': teamColor,
                              } as React.CSSProperties}
                            >
                              {/* rank */}
                              <span
                                className={`w-5 text-center shrink-0 text-[11px] fs-mono ${
                                  isMyTeam ? 'text-fs-text font-semibold' : 'text-fs-muted-2'
                                }`}
                              >
                                {i + 1}
                              </span>

                              {/* playoff dot */}
                              <span className="w-4 flex justify-center shrink-0">
                                {playoff ? (
                                  <span
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{ backgroundColor: `${teamColor}80` }}
                                    title="Playoff position"
                                  />
                                ) : (
                                  <span className="h-1.5 w-1.5" />
                                )}
                              </span>

                              {/* logo */}
                              <img
                                src={entry.logo}
                                alt=""
                                className="w-3.5 h-3.5 object-contain shrink-0"
                                onError={(e) => {
                                  ;(e.target as HTMLImageElement).style.display = 'none'
                                }}
                              />

                              {/* name */}
                              <span
                                className={`flex-1 truncate text-xs ${
                                  isMyTeam ? 'text-fs-text font-semibold' : 'text-fs-text/70'
                                }`}
                              >
                                {entry.name.replace(CITY_PREFIX, '')}
                              </span>

                              {/* record */}
                              <span
                                className={`w-11 text-right shrink-0 text-xs fs-mono tabular-nums ${
                                  isMyTeam ? 'text-fs-text font-semibold' : 'text-fs-muted'
                                }`}
                              >
                                {entry.record || '—'}
                              </span>

                              {!compact && (
                                <span
                                  className={`w-10 text-right shrink-0 text-xs fs-mono tabular-nums ${
                                    isMyTeam ? 'text-fs-text' : 'text-fs-muted-2'
                                  }`}
                                >
                                  {entry.record ? formatPct(entry.record) : '—'}
                                </span>
                              )}
                              {!compact && (
                                <span
                                  className={`w-8 text-right shrink-0 text-[11px] fs-mono tabular-nums ${
                                    isMyTeam ? 'text-fs-text' : 'text-fs-muted-2'
                                  }`}
                                >
                                  {entry.record ? gamesBehind(entry.record, leaderRecord) : '—'}
                                </span>
                              )}
                            </Link>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}

            {/* legend */}
            <div className="flex items-center gap-3 px-1 pt-1 text-[10px] text-fs-muted-2 fs-mono uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: `${teamColor}80` }}
                />
                playoff
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-px w-3 bg-current opacity-40" />
                GB · games behind
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
