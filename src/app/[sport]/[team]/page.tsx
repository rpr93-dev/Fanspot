'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { teams, sportConfig } from '@/data/teams'
import { useParams } from 'next/navigation'
import { getTeamSchedule, getTeamNews, getEspnAbbr } from '@/lib/sports-api'
import type { EspnEvent } from '@/lib/sports-api'

const sportPath: Record<string, string> = { NFL: 'nfl', NBA: 'nba', NHL: 'nhl', MLB: 'mlb' }

function getTeamLogoUrl(teamAbbr: string, sport: string): string {
  const path = sportPath[sport.toUpperCase()]
  if (!path) return ''
  return `https://a.espncdn.com/i/teamlogos/${path}/500/${teamAbbr.toLowerCase()}.png`
}

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

interface OddsTeamInfo {
  name: string
  abbr: string
  moneyline: number
  prob: number
  rawProb: number
  isFavorite: boolean
}

interface OddsInfo {
  our: OddsTeamInfo
  opponent: OddsTeamInfo
  sportsbook: string
  lastUpdated: string
  isHome: boolean
}

interface TeamDashboardData {
  upcoming: { date: string; opponent: string; opponentLogo: string; location: 'home' | 'away'; venue?: string; isPreseason?: boolean } | null
  lastFive: { date: string; opponent: string; opponentLogo: string; result: 'W' | 'L'; score: string; isPreseason?: boolean }[]
  oddsInfo: OddsInfo | null
  news: { title: string; source: string; date: string; snippet: string; url: string }[]
  standings: ConferenceGroup[]
  teamStanding: string
  standingsMessage?: string
}

function getGameDetail(event: EspnEvent): string {
  return event.competitions?.[0]?.status?.type?.shortDetail ?? new Date(event.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' })
}

function getShortDate(event: EspnEvent): string {
  return new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getOpponent(event: EspnEvent, teamAbbr: string, sport: string): { name: string; logo: string; location: 'home' | 'away' } {
  const competitors = event.competitions?.[0]?.competitors ?? []
  const opponent = competitors.find((c) => c.team.abbreviation !== teamAbbr)
  const home = competitors.find((c) => c.homeAway === 'home')
  const isHome = home?.team.abbreviation === teamAbbr
  const oppAbbr = opponent?.team.abbreviation ?? ''
  return {
    name: opponent?.team.displayName ?? 'Unknown',
    logo: opponent?.team.logo ?? (oppAbbr ? getTeamLogoUrl(oppAbbr, sport) : ''),
    location: isHome ? 'home' : ('away' as 'home' | 'away'),
  }
}

function getScore(event: EspnEvent, teamAbbr: string): string {
  const competitors = event.competitions?.[0]?.competitors ?? []
  const team = competitors.find((c) => c.team.abbreviation === teamAbbr)
  const opp = competitors.find((c) => c.team.abbreviation !== teamAbbr)
  if (!team?.score?.displayValue || !opp?.score?.displayValue) return ''
  return `${team.score.displayValue}-${opp.score.displayValue}`
}

function getResult(event: EspnEvent, teamAbbr: string): 'W' | 'L' {
  const competitors = event.competitions?.[0]?.competitors ?? []
  const team = competitors.find((c) => c.team.abbreviation === teamAbbr)
  return team?.winner ? 'W' : 'L'
}

export default function TeamDashboard() {
  const params = useParams()
  const sport = params.sport as string
  const teamId = params.team as string

  const [data, setData] = useState<TeamDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [logoFailed, setLogoFailed] = useState(false)
  const [showAllStandings, setShowAllStandings] = useState(false)

  const team = teams.find((t) => t.id === teamId && t.sport === sport.toUpperCase())
  const config = sportConfig[sport.toUpperCase()]

  useEffect(() => {
    if (!team) { setLoading(false); return }
    let cancelled = false
    const t = team
    const espnAbbr = getEspnAbbr(t.id, t.abbreviation)

    async function load() {
      try {
        const espnAbbrForApi = getEspnAbbr(t.id, t.abbreviation)
        const schedule = await getTeamSchedule(t.sport, t.id, t.abbreviation)

        // Pass the upcoming game's event ID and date to odds so it uses the same game
        let oddsUrl = `/api/odds?sport=${t.sport}&team=${espnAbbrForApi}`
        if (schedule.upcoming) {
          const gameDate = schedule.upcoming.date.slice(0, 10).replace(/-/g, '')
          oddsUrl += `&eventId=${encodeURIComponent(schedule.upcoming.id)}&date=${gameDate}`
        }

        const [news, standingsRes, oddsRes] = await Promise.all([
          getTeamNews(t.sport, t.id, t.name, t.abbreviation),
          fetch(`/api/standings?sport=${t.sport}&team=${espnAbbrForApi}`).then((r) => r.ok ? r.json() : null),
          fetch(oddsUrl).then((r) => r.ok ? r.json() : null),
        ])

        if (cancelled) return

        const lastFive = schedule.lastFive.map((e) => {
          const opp = getOpponent(e, espnAbbr, t.sport)
          return {
            date: getShortDate(e),
            opponent: opp.name,
            opponentLogo: opp.logo,
            result: getResult(e, espnAbbr),
            score: getScore(e, espnAbbr),
            isPreseason: e.seasonType?.type === 1 || e.season?.type === 1,
          }
        })

        let upcoming: TeamDashboardData['upcoming'] = null

        if (schedule.upcoming) {
          const opp = getOpponent(schedule.upcoming, espnAbbr, t.sport)
          const venue = schedule.upcoming.competitions?.[0]?.venue?.fullName
          upcoming = {
            date: getGameDetail(schedule.upcoming),
            opponent: opp.name,
            opponentLogo: opp.logo,
            location: opp.location,
            venue,
            isPreseason: schedule.upcoming.seasonType?.type === 1 || schedule.upcoming.season?.type === 1,
          }
        }

        const newsItems = news.map((a: any) => ({
          title: a.headline ?? a.title ?? '',
          source: a.source ?? 'ESPN',
          date: a.published
            ? new Date(a.published).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : a.date
              ? new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : '',
          snippet: a.description ?? a.snippet ?? '',
          url: a.links?.web?.href
            ? (a.links.web.href.startsWith('http') ? a.links.web.href : `https://www.espn.com${a.links.web.href}`)
            : a.url ?? '#',
        }))

        setData({
          upcoming,
          lastFive,
          oddsInfo: oddsRes?.odds ?? null,
          news: newsItems.length > 0 ? newsItems : getFallbackNews(t.name, t.sport),
          standings: standingsRes?.standings ?? [],
          teamStanding: standingsRes?.teamStanding ?? '',
          standingsMessage: standingsRes?.message ?? '',
        })
      } catch (err) {
        console.error('[dashboard] Failed to load team data:', err)
        if (!cancelled) setData(getFallbackData(t.name, t.sport))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [team])

  if (!team || !config) {
    return (
      <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0a0a0f, #1a1a2e)' }}>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h1 className="text-2xl text-gray-600 mb-4 font-light">Team not found</h1>
            <Link href={`/${sport}`} className="text-sm text-gray-600 hover:text-white transition-colors">&larr; Back to League</Link>
          </div>
        </div>
      </div>
    )
  }

  const logoUrl = getTeamLogoUrl(getEspnAbbr(team.id, team.abbreviation), team.sport)

  return (
    <div className="min-h-screen" style={{ background: `linear-gradient(135deg, #0a0a0f, ${team.colors.primary}08, #1a1a2e)` }}>
      <div className="px-6 py-10">
        <Link href={`/${sport}`} className="text-sm text-gray-500 hover:text-white transition-colors inline-block mb-8">&larr; {config.name}</Link>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <div className="rounded-xl p-6" style={{ backgroundColor: `${team.colors.primary}12`, border: `1px solid ${team.colors.primary}20` }}>
              <h2 className="text-xs font-medium text-gray-500 tracking-wider uppercase mb-4">Next Game</h2>
              {loading ? (
                <div className="animate-pulse space-y-3">
                  <div className="h-7 rounded w-3/4" style={{ backgroundColor: `${team.colors.primary}20` }} />
                  <div className="h-4 rounded w-1/2" style={{ backgroundColor: `${team.colors.primary}15` }} />
                </div>
              ) : data?.upcoming ? (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    {data.upcoming.opponentLogo && (
                      <img src={data.upcoming.opponentLogo} alt="" className="w-7 h-7 object-contain" />
                    )}
                    <p className="text-xl font-medium text-white/90">
                      {data.upcoming.location === 'home' ? 'vs' : '@'} {data.upcoming.opponent}
                    </p>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{data.upcoming.date}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{data.upcoming.location === 'home' ? 'Home' : 'Away'}{data.upcoming.venue ? ` · ${data.upcoming.venue}` : ''}</p>
                  {data.upcoming.isPreseason && <span className="inline-block mt-2 px-2 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-400 rounded">Preseason</span>}
                  {data.oddsInfo ? (
                    <div className="mt-5 pt-4 space-y-3" style={{ borderTop: `1px solid ${team.colors.primary}15` }}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">
                          <span className="text-white/90 font-medium">{data.oddsInfo.our.abbr}</span>
                          {data.oddsInfo.our.isFavorite
                            ? <span className="text-green-400 ml-1">(Favorite)</span>
                            : <span className="text-red-400 ml-1">(Underdog)</span>
                          }
                        </span>
                        <span className="font-mono text-white/80">{data.oddsInfo.our.moneyline > 0 ? '+' : ''}{data.oddsInfo.our.moneyline}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">
                          <span className="text-white/90 font-medium">{data.oddsInfo.opponent.abbr}</span>
                          {data.oddsInfo.opponent.isFavorite
                            ? <span className="text-green-400 ml-1">(Favorite)</span>
                            : <span className="text-red-400 ml-1">(Underdog)</span>
                          }
                        </span>
                        <span className="font-mono text-white/80">{data.oddsInfo.opponent.moneyline > 0 ? '+' : ''}{data.oddsInfo.opponent.moneyline}</span>
                      </div>
                      <div className="pt-2">
                        <p className="text-xs text-gray-500 mb-2">Implied Probability (vig-free)</p>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 rounded-full" style={{ backgroundColor: `${team.colors.primary}15` }}>
                            <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${data.oddsInfo.our.prob}%`, backgroundColor: team.colors.primary }} />
                          </div>
                          <span className="text-sm font-medium text-white/80 w-10 text-right">{data.oddsInfo.our.prob}%</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-600 pt-1">
                        <span>{data.oddsInfo.sportsbook}</span>
                        <span>Updated {new Date(data.oddsInfo.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${team.colors.primary}15` }}>
                      <p className="text-sm text-gray-600">Odds not yet available</p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-600">{sport === 'nfl' ? 'Season starts September' : sport === 'nba' || sport === 'nhl' ? 'Season starts October' : 'Season in progress'}</p>
              )}
            </div>

            <div className="rounded-xl p-6 flex flex-col items-center justify-center" style={{ backgroundColor: `${team.colors.primary}10`, border: `1px solid ${team.colors.primary}18` }}>
              <div className="w-28 h-28 flex items-center justify-center mb-4">
                {logoFailed ? (
                  <div className="w-28 h-28 rounded-full flex items-center justify-center" style={{ backgroundColor: team.colors.primary }}>
                    <span className="text-3xl font-bold" style={{ color: team.colors.secondary }}>{team.abbreviation}</span>
                  </div>
                ) : (
                  <img src={logoUrl} alt={team.name} className="w-full h-full object-contain" onError={() => setLogoFailed(true)} />
                )}
              </div>
              <h1 className="text-2xl font-light text-white/90 text-center">{team.name}</h1>
              <p className="text-xs text-gray-500 mt-1">{team.conference} &middot; {team.division}</p>
            </div>
          </div>

        <div className="mb-5">
          <div className="rounded-xl p-5" style={{ backgroundColor: `${team.colors.primary}08`, border: `1px solid ${team.colors.primary}15` }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-medium tracking-wider uppercase" style={{ color: `${team.colors.primary}cc` }}>Last 5 Games</h2>
              {data?.teamStanding && <span className="text-xs" style={{ color: `${team.colors.primary}99` }}>{data.teamStanding}</span>}
            </div>
            {loading ? (
              <div className="grid grid-cols-5 gap-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-24 rounded-lg animate-pulse" style={{ backgroundColor: `${team.colors.primary}15` }} />
                ))}
              </div>
            ) : data?.lastFive.length ? (
              <div className="grid grid-cols-5 gap-3">
                {data.lastFive.map((game, i) => (
                  <div key={i} className="rounded-lg p-3 flex flex-col items-center text-center transition-colors" style={{ backgroundColor: `${team.colors.primary}0a`, border: `1px solid ${team.colors.primary}10` }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${team.colors.primary}18` }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${team.colors.primary}0a` }}>
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium mb-1 ${
                      game.result === 'W' ? 'text-green-400' : 'text-red-400'
                    }`} style={{ backgroundColor: game.result === 'W' ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)' }}>
                      {game.result}
                    </span>
                    {game.opponentLogo && (
                      <img src={game.opponentLogo} alt="" className="w-6 h-6 object-contain mb-1" />
                    )}
                    <span className="text-xs text-white/80 truncate max-w-full">{game.opponent}</span>
                    <span className="text-xs mt-0.5" style={{ color: `${team.colors.primary}bb` }}>{game.score}</span>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px] text-gray-500">{game.date}</span>
                      {game.isPreseason && <span className="text-[10px] text-amber-400/70">Pre</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No recent games</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-xl p-6" style={{ backgroundColor: `${team.colors.primary}08`, border: `1px solid ${team.colors.primary}15` }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-medium tracking-wider uppercase" style={{ color: `${team.colors.primary}cc` }}>
                Standings
              </h2>
              {data?.standings.some((c) => c.name !== team?.conference) && (
                <button onClick={() => setShowAllStandings((v) => !v)}
                  className="text-xs px-2.5 py-1 rounded-full transition-colors"
                  style={{
                    backgroundColor: showAllStandings ? `${team?.colors.primary}25` : `${team.colors.primary}10`,
                    color: showAllStandings ? `${team.colors.primary}dd` : `${team.colors.primary}99`,
                    border: `1px solid ${team.colors.primary}20`,
                  }}>
                  {showAllStandings ? `Show ${team?.conference} Only` : 'All Conferences'}
                </button>
              )}
            </div>
            {loading ? (
              <div className="animate-pulse space-y-3">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="h-8 rounded-lg" style={{ backgroundColor: `${team.colors.primary}12` }} />
                ))}
              </div>
            ) : data?.standingsMessage ? (
              <p className="text-sm text-gray-500">{data.standingsMessage}</p>
            ) : data?.standings.length ? (
              <div className="space-y-4">
                {(showAllStandings ? data.standings : data.standings.filter((c) => c.name === team?.conference)).map((conf) => (
                  <div key={conf.name}>
                    <p className="text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: `${team.colors.primary}aa` }}>{conf.name}</p>
                    {conf.divisions.map((div) => (
                      <div key={div.name} className="mb-3">
                        <p className="text-xs mb-1 ml-1" style={{ color: `${team.colors.primary}77` }}>{div.name}</p>
                        <div className="space-y-0.5">
                          {div.teams.map((entry, i) => {
                            const isMyTeam = entry.abbr === getEspnAbbr(team.id, team.abbreviation)
                            return (
                              <div key={entry.abbr} className="flex items-center gap-2 rounded-lg px-2.5 py-1" style={{
                                backgroundColor: isMyTeam ? `${team.colors.primary}18` : 'transparent',
                              }}>
                                <span className="text-xs w-4 text-right" style={{ color: `${team.colors.primary}66` }}>{i + 1}</span>
                                <img src={entry.logo} alt="" className="w-4 h-4 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                <span className={`text-xs flex-1 truncate ${isMyTeam ? 'text-white/90' : 'text-white/60'}`}>{entry.name.replace(/^(Los Angeles|Las Vegas|New York|New England|San Francisco|San Diego|Tampa Bay|Green Bay|Kansas City|Oklahoma City|Golden State|New Orleans|Salt Lake City|St\. Louis|Portland|Oklahoma )/, '')}</span>
                                {entry.record && <span className="text-xs font-mono" style={{ color: `${team.colors.primary}99` }}>{entry.record}</span>}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Standings unavailable</p>
            )}
          </div>

          <div className="rounded-xl p-6" style={{ backgroundColor: `${team.colors.primary}08`, border: `1px solid ${team.colors.primary}15` }}>
            <h2 className="text-xs font-medium tracking-wider uppercase mb-4" style={{ color: `${team.colors.primary}cc` }}>Latest News</h2>
            {loading ? (
              <div className="animate-pulse space-y-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-4 rounded w-3/4" style={{ backgroundColor: `${team.colors.primary}15` }} />
                    <div className="h-3 rounded w-full" style={{ backgroundColor: `${team.colors.primary}10` }} />
                  </div>
                ))}
              </div>
            ) : data?.news.length ? (
              <div className="space-y-3">
                {data.news.map((item, i) => (
                  <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                     className="block rounded-lg p-3.5 transition-all" style={{ backgroundColor: `${team.colors.primary}0a`, border: `1px solid ${team.colors.primary}08` }}
                     onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${team.colors.primary}18`; e.currentTarget.style.borderColor = `${team.colors.primary}30` }}
                     onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${team.colors.primary}0a`; e.currentTarget.style.borderColor = `${team.colors.primary}08` }}>
                    <h3 className="text-sm font-medium text-white/80 leading-snug mb-1.5 line-clamp-2">{item.title}</h3>
                    <p className="text-xs mb-2 line-clamp-2" style={{ color: `${team.colors.primary}aa` }}>{item.snippet}</p>
                    <div className="flex items-center gap-2 text-xs">
                      <span style={{ color: `${team.colors.primary}88` }}>{item.source}</span>
                      <span style={{ color: `${team.colors.primary}55` }}>&middot;</span>
                      <span style={{ color: `${team.colors.primary}77` }}>{item.date}</span>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No news available</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function getFallbackNews(name: string, sport: string) {
  const espnUrl = `https://www.espn.com/${sport.toLowerCase()}/team/_/name/${name.split(' ').pop()?.toLowerCase() ?? ''}`
  return [
    { title: `${name} Latest News & Updates`, source: 'ESPN', date: 'Jul ' + new Date().getDate(), snippet: `Latest news, scores, and updates for ${name}.`, url: espnUrl },
    { title: `${name} Schedule & Results`, source: 'ESPN', date: 'Jul ' + (new Date().getDate() - 2), snippet: `View the full schedule and recent results for ${name}.`, url: espnUrl },
    { title: `${name} Roster & Transactions`, source: 'ESPN', date: 'Jul ' + (new Date().getDate() - 4), snippet: `Roster moves, injuries, and transactions for ${name}.`, url: espnUrl },
    { title: `${name} Standings & Playoff Race`, source: 'ESPN', date: 'Jul ' + (new Date().getDate() - 6), snippet: `Where ${name} stand in the ${sport} playoff race.`, url: `https://www.espn.com/${sport.toLowerCase()}/standings` },
  ]
}

function getFallbackData(name: string, sport: string): TeamDashboardData {
  return {
    upcoming: null,
    lastFive: [],
    oddsInfo: null,
    news: getFallbackNews(name, sport),
    standings: [],
    teamStanding: '',
  }
}
