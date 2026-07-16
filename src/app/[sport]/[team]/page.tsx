'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
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
  lastFive: { date: string; opponent: string; opponentLogo: string; result: 'W' | 'L'; score: string; eventId: string; isPreseason?: boolean }[]
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
  const [showRoster, setShowRoster] = useState(false)
  const [rosterData, setRosterData] = useState<any[] | null>(null)
  const [rosterLoading, setRosterLoading] = useState(false)
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  const [boxScoreData, setBoxScoreData] = useState<any>(null)
  const [boxScoreLoading, setBoxScoreLoading] = useState(false)
  const upcomingGameRef = useRef<{ id: string; date: string } | null>(null)

  const team = teams.find((t) => t.id === teamId && t.sport === sport.toUpperCase())
  const config = sportConfig[sport.toUpperCase()]

  useEffect(() => {
    if (!team) { setLoading(false); return }
    let cancelled = false
    const t = team

    async function load() {
      try {
        const espnAbbrForApi = getEspnAbbr(t.id, t.abbreviation)

        // Fire schedule, news, and standings in parallel immediately
        const schedulePromise = getTeamSchedule(t.sport, t.id, t.abbreviation)
        const newsPromise = getTeamNews(t.sport, t.id, t.name, t.abbreviation)
        const standingsPromise = fetch(`/api/standings?sport=${t.sport}&team=${espnAbbrForApi}`)
          .then((r) => r.ok ? r.json() : null)

        // Await schedule first so we can build the odds URL with the event ID
        const schedule = await schedulePromise

        const schedForState = processScheduleForState(schedule, espnAbbrForApi, t.sport)
        upcomingGameRef.current = schedForState.upcomingEventId
          ? { id: schedForState.upcomingEventId, date: schedForState.upcomingDate! }
          : null

        let oddsUrl = `/api/odds?sport=${t.sport}&team=${espnAbbrForApi}`
        if (schedForState.upcomingEventId && schedForState.upcomingDate) {
          oddsUrl += `&eventId=${encodeURIComponent(schedForState.upcomingEventId)}&date=${schedForState.upcomingDate}`
        }

        // Await remaining fetches in parallel with odds (already in-flight)
        const [news, standingsRes, oddsRes] = await Promise.all([
          newsPromise,
          standingsPromise,
          fetch(oddsUrl).then((r) => r.ok ? r.json() : null),
        ])

        if (cancelled) return

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
          upcoming: schedForState.upcoming,
          lastFive: schedForState.lastFive,
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
  }, [team?.id])

  useEffect(() => {
    if (!showRoster || rosterData || rosterLoading || !team) return
    setRosterLoading(true)
    const abbr = getEspnAbbr(team.id, team.abbreviation)
    fetch(`/api/roster?sport=${team.sport}&team=${abbr}`)
      .then((r) => r.ok ? r.json() : null)
      .then((res) => {
        setRosterData(res?.athletes ?? null)
        setRosterLoading(false)
      })
      .catch(() => setRosterLoading(false))
  }, [showRoster, team?.id])

  // Odds poll every 30s
  useEffect(() => {
    if (!team) return
    const abbr = getEspnAbbr(team.id, team.abbreviation)
    const id = setInterval(async () => {
      try {
        let url = `/api/odds?sport=${team.sport}&team=${abbr}`
        const ug = upcomingGameRef.current
        if (ug) url += `&eventId=${encodeURIComponent(ug.id)}&date=${ug.date}`
        const res = await fetch(url)
        if (res.ok) {
          const json = await res.json()
          setData(p => p ? { ...p, oddsInfo: json.odds ?? null } : p)
        }
      } catch { /* silent */ }
    }, 30000)
    return () => clearInterval(id)
  }, [team?.id])

  // News poll every 120s
  useEffect(() => {
    if (!team) return
    const id = setInterval(async () => {
      try {
        const raw = await getTeamNews(team.sport, team.id, team.name, team.abbreviation)
        const items = raw.map((a: any) => ({
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
        setData(p => p ? { ...p, news: items.length > 0 ? items : getFallbackNews(team.name, team.sport) } : p)
      } catch { /* silent */ }
    }, 120000)
    return () => clearInterval(id)
  }, [team?.id])

  // Standings poll every 120s
  useEffect(() => {
    if (!team) return
    const abbr = getEspnAbbr(team.id, team.abbreviation)
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/standings?sport=${team.sport}&team=${abbr}`)
        if (res.ok) {
          const json = await res.json()
          setData(p => p ? { ...p, standings: json.standings ?? [], teamStanding: json.teamStanding ?? '', standingsMessage: json.message ?? '' } : p)
        }
      } catch { /* silent */ }
    }, 120000)
    return () => clearInterval(id)
  }, [team?.id])

  // Schedule poll every 300s
  useEffect(() => {
    if (!team) return
    const id = setInterval(async () => {
      try {
        const schedule = await getTeamSchedule(team.sport, team.id, team.abbreviation)
        const abbr = getEspnAbbr(team.id, team.abbreviation)
        const result = processScheduleForState(schedule, abbr, team.sport)
        upcomingGameRef.current = result.upcomingEventId
          ? { id: result.upcomingEventId, date: result.upcomingDate! }
          : null
        setData(p => p ? { ...p, upcoming: result.upcoming, lastFive: result.lastFive } : p)
      } catch { /* silent */ }
    }, 300000)
    return () => clearInterval(id)
  }, [team?.id])

  // Box score fetch on game click
  useEffect(() => {
    if (!selectedGameId || !team) return
    setBoxScoreLoading(true)
    setBoxScoreData(null)
    const abbr = getEspnAbbr(team.id, team.abbreviation)
    fetch(`/api/box-score?sport=${team.sport}&eventId=${selectedGameId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((res) => {
        setBoxScoreData(res?.boxScore ?? null)
        setBoxScoreLoading(false)
      })
      .catch(() => setBoxScoreLoading(false))
  }, [selectedGameId, team?.id])

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
                <div className="animate-fade-in-up">
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
                </div>
              ) : (
                <p className="text-sm text-gray-600 animate-fade-in">{sport === 'nfl' ? 'Season starts September' : sport === 'nba' || sport === 'nhl' ? 'Season starts October' : 'Season in progress'}</p>
              )}
            </div>

            <div className="rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 hover:scale-[1.02]" style={{ backgroundColor: `${team.colors.primary}10`, border: `1px solid ${team.colors.primary}18` }}
              onClick={() => setShowRoster((v) => !v)}>
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

        {showRoster ? (
          <RosterPanel
            team={team}
            roster={rosterData}
            loading={rosterLoading}
            onBack={() => setShowRoster(false)}
          />
        ) : selectedGameId ? (
          <>
            <div className="mb-5">
              <div className="rounded-xl p-4" style={{ backgroundColor: `${team.colors.primary}08`, border: `1px solid ${team.colors.primary}15` }}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-medium tracking-wider uppercase text-gray-400">Last 5 Games</h2>
                  {data?.teamStanding && <span className="text-xs text-gray-500">{data.teamStanding}</span>}
                </div>
                {data?.lastFive.length ? (
                  <div className="grid grid-cols-5 gap-2">
                    {data.lastFive.map((game, i) => (
                      <div key={i} className="rounded-lg p-2 flex flex-col items-center text-center transition-all cursor-pointer" style={{ backgroundColor: `${team.colors.primary}0a`, border: `1px solid ${game.eventId === selectedGameId ? team.colors.primary : 'transparent'}` }}
                        onClick={() => setSelectedGameId(game.eventId === selectedGameId ? null : game.eventId)}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${team.colors.primary}18` }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${team.colors.primary}0a` }}>
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-medium mb-0.5 ${
                          game.result === 'W' ? 'text-green-400' : 'text-red-400'
                        }`} style={{ backgroundColor: game.result === 'W' ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)' }}>
                          {game.result}
                        </span>
                        {game.opponentLogo && (
                          <img src={game.opponentLogo} alt="" className="w-5 h-5 object-contain mb-0.5" />
                        )}
                        <span className="text-[11px] text-white/80 truncate max-w-full">{game.opponent}</span>
                        <span className="text-[11px] text-gray-400">{game.score}</span>
                        {game.isPreseason && <span className="text-[9px] text-amber-400/70">Pre</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No recent games</p>
                )}
              </div>
            </div>
            <BoxScorePanel
              data={boxScoreData}
              loading={boxScoreLoading}
              teamAbbr={getEspnAbbr(team.id, team.abbreviation)}
              teamColor={team.colors.primary}
              sport={team.sport}
              onBack={() => { setSelectedGameId(null); setBoxScoreData(null) }}
            />
          </>
        ) : (
          <>
            <div className="mb-5">
              <div className="rounded-xl p-5" style={{ backgroundColor: `${team.colors.primary}08`, border: `1px solid ${team.colors.primary}15` }}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-medium tracking-wider uppercase text-gray-400">Last 5 Games</h2>
                  {data?.teamStanding && <span className="text-xs text-gray-500">{data.teamStanding}</span>}
                </div>
                {loading ? (
                  <div className="grid grid-cols-5 gap-3">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-24 rounded-lg animate-pulse" style={{ backgroundColor: `${team.colors.primary}15` }} />
                    ))}
                  </div>
                ) : data?.lastFive.length ? (
                  <div className="grid grid-cols-5 gap-3 animate-fade-in-up" style={{ animationDelay: '50ms' }}>
                    {data.lastFive.map((game, i) => (
                      <div key={i} className="rounded-lg p-3 flex flex-col items-center text-center transition-all cursor-pointer" style={{ backgroundColor: `${team.colors.primary}0a`, border: `1px solid ${game.eventId === selectedGameId ? team.colors.primary : team.colors.primary}10` }}
                        onClick={() => setSelectedGameId(game.eventId === selectedGameId ? null : game.eventId)}
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
                        <span className="text-xs mt-0.5 text-gray-400">{game.score}</span>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[10px] text-gray-500">{game.date}</span>
                          {game.isPreseason && <span className="text-[10px] text-amber-400/70">Pre</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 animate-fade-in">No recent games</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="rounded-xl p-6" style={{ backgroundColor: `${team.colors.primary}08`, border: `1px solid ${team.colors.primary}15` }}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-medium tracking-wider uppercase text-gray-400">
                    Standings
                  </h2>
                  {data?.standings.some((c) => c.name !== team?.conference) && (
                    <button onClick={() => setShowAllStandings((v) => !v)}
                      className="text-xs px-2.5 py-1 rounded-full transition-colors text-gray-400"
                      style={{
                        backgroundColor: showAllStandings ? `${team?.colors.primary}25` : `${team.colors.primary}10`,
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
                  <p className="text-sm text-gray-500 animate-fade-in-up">{data.standingsMessage}</p>
                ) : data?.standings.length ? (
                  <div className="space-y-4 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
                    {(showAllStandings ? data.standings : data.standings.filter((c) => c.name === team?.conference)).map((conf) => (
                      <div key={conf.name}>
                        <p className="text-xs font-medium mb-2 uppercase tracking-wider text-gray-400">{conf.name}</p>
                        {conf.divisions.map((div) => (
                          <div key={div.name} className="mb-3">
                            <p className="text-xs mb-1 ml-1 text-gray-500">{div.name}</p>
                            <div className="space-y-0.5">
                              {div.teams.map((entry, i) => {
                                const isMyTeam = entry.abbr === getEspnAbbr(team.id, team.abbreviation)
                                return (
                                  <div key={entry.abbr} className="flex items-center gap-2 rounded-lg px-2.5 py-1" style={{
                                    backgroundColor: isMyTeam ? `${team.colors.primary}18` : 'transparent',
                                  }}>
                                    <span className="text-xs w-4 text-right text-gray-600">{i + 1}</span>
                                    <img src={entry.logo} alt="" className="w-4 h-4 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                                    <span className={`text-xs flex-1 truncate ${isMyTeam ? 'text-white/90' : 'text-white/60'}`}>{entry.name.replace(/^(Los Angeles|Las Vegas|New York|New England|San Francisco|San Diego|Tampa Bay|Green Bay|Kansas City|Oklahoma City|Golden State|New Orleans|Salt Lake City|St\. Louis|Portland|Oklahoma )/, '')}</span>
                                    {entry.record && <span className="text-xs font-mono text-gray-400">{entry.record}</span>}
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
                  <p className="text-sm text-gray-500 animate-fade-in">Standings unavailable</p>
                )}
              </div>

              <div className="rounded-xl p-6" style={{ backgroundColor: `${team.colors.primary}08`, border: `1px solid ${team.colors.primary}15` }}>
                <h2 className="text-xs font-medium tracking-wider uppercase mb-4 text-gray-400">Latest News</h2>
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
                  <div className="space-y-3 animate-fade-in-up" style={{ animationDelay: '150ms' }}>
                    {data.news.map((item, i) => (
                      <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                         className="block rounded-lg p-3.5 transition-all" style={{ backgroundColor: `${team.colors.primary}0a`, border: `1px solid ${team.colors.primary}08` }}
                         onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${team.colors.primary}18`; e.currentTarget.style.borderColor = `${team.colors.primary}30` }}
                         onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${team.colors.primary}0a`; e.currentTarget.style.borderColor = `${team.colors.primary}08` }}>
                        <h3 className="text-sm font-medium text-white/80 leading-snug mb-1.5 line-clamp-2">{item.title}</h3>
                        <p className="text-xs mb-2 line-clamp-2 text-gray-400">{item.snippet}</p>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>{item.source}</span>
                          <span className="text-gray-600">&middot;</span>
                          <span>{item.date}</span>
                        </div>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 animate-fade-in">No news available</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const periodLabels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']

const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)

const teamStatKeys: Record<string, string[]> = {
  NFL: ['totalFirstDowns', 'totalYards', 'passingYards', 'rushingYards', 'turnovers'],
  NBA: ['fieldGoalPct', 'threePointPct', 'freeThrowPct', 'totalRebounds', 'assists', 'steals', 'blocks', 'turnovers'],
  NHL: ['shotsOnGoal', 'faceoffWinPct', 'powerPlayPct', 'penaltyMinutes', 'blockedShots', 'hits'],
  MLB: ['runs', 'hits', 'errors', 'homeRuns', 'walks', 'strikeouts'],
}

const teamStatLabels: Record<string, string> = {
  totalFirstDowns: '1st Downs', totalYards: 'Total Yards', passingYards: 'Pass', rushingYards: 'Rush',
  turnovers: 'TO', fieldGoalPct: 'FG%', threePointPct: '3P%', freeThrowPct: 'FT%',
  totalRebounds: 'REB', assists: 'AST', steals: 'STL', blocks: 'BLK',
  shotsOnGoal: 'SOG', faceoffWinPct: 'FO%', powerPlayPct: 'PP%', penaltyMinutes: 'PIM',
  blockedShots: 'Blk', hits: 'Hits', runs: 'R', errors: 'E', homeRuns: 'HR', walks: 'BB',
  strikeouts: 'K',
}

function BoxScorePanel({ data, loading, teamAbbr, teamColor, sport, onBack }: { data: any; loading: boolean; teamAbbr: string; teamColor: string; sport: string; onBack: () => void }) {
  const [showTeamStats, setShowTeamStats] = useState(false)

  const ourIdx = data?.teams?.findIndex((t: any) => t.abbreviation === teamAbbr) ?? -1
  const oppIdx = ourIdx === 0 ? 1 : 0
  const ourTeam = ourIdx >= 0 ? data?.teams?.[ourIdx] : null
  const oppTeam = oppIdx >= 0 ? data?.teams?.[oppIdx] : null
  const maxPeriods = Math.max(ourTeam?.linescores?.length ?? 0, oppTeam?.linescores?.length ?? 0)

  const sortedPlayerStats = useMemo(() =>
    [...(data?.playerStats ?? [])].sort((a, b) => {
      if (a.teamAbbr === teamAbbr) return -1
      if (b.teamAbbr === teamAbbr) return 1
      return 0
    }),
    [data?.playerStats, teamAbbr],
  )

  const hasAnyPlayerStats = sortedPlayerStats.some((t: any) => t.athletes?.length > 0)

  return (
    <div className="animate-fade-in-up mt-5 pt-4" style={{ borderTop: `1px solid ${teamColor}15` }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium tracking-wider uppercase text-gray-400">Box Score</h3>
        <div className="flex items-center gap-2">
          {hasAnyPlayerStats && (
            <button onClick={() => setShowTeamStats((v) => !v)}
              className="text-xs px-2.5 py-1 rounded-full transition-colors text-gray-400 hover:text-white"
              style={{ backgroundColor: `${teamColor}15`, border: `1px solid ${teamColor}25` }}>
              {showTeamStats ? 'Player Stats' : 'Team Stats'}
            </button>
          )}
          <button onClick={onBack}
            className="text-xs px-2.5 py-1 rounded-full transition-colors text-gray-400 hover:text-white"
            style={{ backgroundColor: `${teamColor}15`, border: `1px solid ${teamColor}25` }}>
            &larr; Back
          </button>
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-24 rounded-lg" style={{ backgroundColor: `${teamColor}10` }} />
        </div>
      ) : !data?.teams?.length ? (
        <p className="text-sm text-gray-500">Box score unavailable</p>
      ) : (
        <div className="space-y-4">
          {/* Period scores table */}
          {maxPeriods > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500">
                    <th className="text-left pr-3 pb-1 font-medium" />
                    {Array.from({ length: maxPeriods }, (_, i) => (
                      <th key={i} className="text-center px-2 pb-1 font-medium">{periodLabels[i]}</th>
                    ))}
                    <th className="text-center pl-3 pb-1 font-medium text-white/60">T</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="text-white/80">
                    <td className="pr-3 py-1 font-medium truncate max-w-24">{ourTeam?.displayName ?? 'Home'}</td>
                    {Array.from({ length: maxPeriods }, (_, i) => (
                      <td key={i} className="text-center px-2 py-1 font-mono">{ourTeam?.linescores?.[i] ?? '-'}</td>
                    ))}
                    <td className="text-center pl-3 py-1 font-mono text-white font-medium">{ourTeam ? sum(ourTeam.linescores) : '-'}</td>
                  </tr>
                  <tr className="text-white/80">
                    <td className="pr-3 py-1 font-medium truncate max-w-24">{oppTeam?.displayName ?? 'Away'}</td>
                    {Array.from({ length: maxPeriods }, (_, i) => (
                      <td key={i} className="text-center px-2 py-1 font-mono">{oppTeam?.linescores?.[i] ?? '-'}</td>
                    ))}
                    <td className="text-center pl-3 py-1 font-mono text-white font-medium">{oppTeam ? sum(oppTeam.linescores) : '-'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Player stats (default view) */}
          {!showTeamStats && hasAnyPlayerStats && (
            <div className="space-y-5">
              {sortedPlayerStats.map((team: any, ti: number) => {
                const isOurTeam = team.teamAbbr === teamAbbr
                const names = team.statNames ?? []
                return (
                  <div key={team.teamAbbr || ti}>
                    <p className="text-xs font-medium mb-2 text-white/70">{isOurTeam ? team.teamAbbr : `${team.teamAbbr} (Opp)`}</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-600">
                            <th className="text-left pr-2 py-0.5 font-medium">#</th>
                            <th className="text-left pr-3 py-0.5 font-medium">Player</th>
                            {names.map((n: string, ni: number) => (
                              <th key={`${n}-${ni}`} className="text-center px-1.5 py-0.5 font-medium text-gray-500">{n.replace(/([A-Z])/g, ' $1').trim().toUpperCase()}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {team.athletes.map((a: any, ai: number) => (
                            <tr key={a.id || ai} className="text-white/70">
                              <td className="pr-2 py-0.5 font-mono text-gray-500 text-right">{a.jersey ?? ''}</td>
                              <td className="pr-3 py-0.5 truncate max-w-28">{a.displayName}{a.position ? ` (${a.position})` : ''}</td>
                              {names.map((n: string, ni: number) => (
                                <td key={`${n}-${ni}`} className="text-center px-1.5 py-0.5 font-mono">{a.stats?.[n] ?? '-'}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Team stats (toggle view) */}
          {showTeamStats && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500">
                    <th className="text-left pr-3 pb-1 font-medium">Stat</th>
                    <th className="text-center px-2 pb-1 font-medium">{ourTeam?.abbreviation ?? 'Home'}</th>
                    <th className="text-center pl-3 pb-1 font-medium">{oppTeam?.abbreviation ?? 'Away'}</th>
                  </tr>
                </thead>
                <tbody>
                  {(ourTeam?.statistics ?? []).filter(
                    (s: any) => Object.keys(teamStatKeys).some((k) => teamStatKeys[k].includes(s.name))
                  ).map((stat: any, i: number) => {
                    const oppStat = oppTeam?.statistics?.find((s: any) => s.name === stat.name)
                    return (
                      <tr key={stat.name ?? i} className="text-white/70">
                        <td className="pr-3 py-1 text-gray-400">{teamStatLabels[stat.name] ?? stat.name}</td>
                        <td className="text-center px-2 py-1 font-mono">{stat.displayValue ?? '-'}</td>
                        <td className="text-center pl-3 py-1 font-mono">{oppStat?.displayValue ?? '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!hasAnyPlayerStats && !showTeamStats && (
            <p className="text-sm text-gray-500">Player stats not yet available</p>
          )}

          {data?.status && (
            <p className="text-[10px] text-gray-600">{data.status.shortDetail ?? data.status.description}</p>
          )}
        </div>
      )}
    </div>
  )
}

function processScheduleForState(schedule: { upcoming: EspnEvent | null; lastFive: EspnEvent[] }, espnAbbr: string, sport: string) {
  const lastFive = schedule.lastFive.map((e) => {
    const opp = getOpponent(e, espnAbbr, sport)
    return {
      date: getShortDate(e),
      opponent: opp.name,
      opponentLogo: opp.logo,
      result: getResult(e, espnAbbr),
      score: getScore(e, espnAbbr),
      eventId: e.id,
      isPreseason: e.seasonType?.type === 1 || e.season?.type === 1,
    }
  })

  let upcoming: TeamDashboardData['upcoming'] = null
  let upcomingEventId: string | null = null
  let upcomingDate: string | null = null

  if (schedule.upcoming) {
    const opp = getOpponent(schedule.upcoming, espnAbbr, sport)
    const venue = schedule.upcoming.competitions?.[0]?.venue?.fullName
    upcoming = {
      date: getGameDetail(schedule.upcoming),
      opponent: opp.name,
      opponentLogo: opp.logo,
      location: opp.location,
      venue,
      isPreseason: schedule.upcoming.seasonType?.type === 1 || schedule.upcoming.season?.type === 1,
    }
    upcomingEventId = schedule.upcoming.id
    upcomingDate = schedule.upcoming.date.slice(0, 10).replace(/-/g, '')
  }

  return { lastFive, upcoming, upcomingEventId, upcomingDate }
}

function checkRookie(athlete: any): boolean {
  const exp = athlete?.experience
  if (!exp) return true
  if (typeof exp.years === 'number' && exp.years <= 0) return true
  if (String(exp.displayValue ?? '').toUpperCase() === 'R') return true
  if (String(exp.abbreviation ?? '').toUpperCase() === 'R') return true
  return false
}

const sportPositionOrder: Record<string, string[]> = {
  NFL: ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'NT', 'OLB', 'MLB', 'ILB', 'LB', 'CB', 'S', 'SS', 'FS', 'K', 'P', 'LS'],
  NBA: ['PG', 'SG', 'SF', 'PF', 'C'],
  NHL: ['G', 'D', 'LW', 'C', 'RW'],
  MLB: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'IF', 'OF'],
}

function RosterPanel({ team, roster, loading, onBack }: { team: any; roster: any[] | null; loading: boolean; onBack: () => void }) {
  const order = sportPositionOrder[team.sport] ?? []
  const posRank: Record<string, number> = {}
  order.forEach((p, i) => { posRank[p] = i })

  const groups: Record<string, any[]> = {}
  if (roster) {
    for (const a of roster) {
      const abbr = a.position?.abbreviation ?? 'POS'
      if (!groups[abbr]) groups[abbr] = []
      groups[abbr].push(a)
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => {
        const aNum = parseInt(a.jersey) || 0
        const bNum = parseInt(b.jersey) || 0
        return aNum - bNum
      })
    }
  }

  const sortedPositions = Object.keys(groups).sort((a, b) => (posRank[a] ?? 999) - (posRank[b] ?? 999))

  return (
    <div className="animate-fade-in-up">
      <div className="rounded-xl p-6" style={{ backgroundColor: `${team.colors.primary}08`, border: `1px solid ${team.colors.primary}15` }}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xs font-medium tracking-wider uppercase text-gray-400">Roster</h2>
          <button onClick={onBack}
            className="text-xs px-3 py-1.5 rounded-full transition-colors text-gray-400 hover:text-white"
            style={{ backgroundColor: `${team.colors.primary}15`, border: `1px solid ${team.colors.primary}25` }}>
            &larr; Dashboard
          </button>
        </div>

        {loading ? (
          <div className="animate-pulse space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 w-16 rounded" style={{ backgroundColor: `${team.colors.primary}20` }} />
                {[...Array(3)].map((_, j) => (
                  <div key={j} className="h-7 rounded-lg" style={{ backgroundColor: `${team.colors.primary}10` }} />
                ))}
              </div>
            ))}
          </div>
        ) : !roster || sortedPositions.length === 0 ? (
          <p className="text-sm text-gray-500">Roster unavailable</p>
        ) : (
          <div className="space-y-5">
            {sortedPositions.map((abbr, pi) => {
              const posName = groups[abbr][0]?.position?.name ?? abbr
              return (
                <div key={abbr || `pos-${pi}`}>
                  <p className="text-xs font-medium mb-2 tracking-wider text-gray-400">{posName} <span className="text-gray-600">({abbr})</span></p>
                  <div className="space-y-0.5">
                    {groups[abbr].map((athlete: any, ai) => {
                      const rookie = checkRookie(athlete)
                      return (
                        <div key={athlete.id ?? `athlete-${pi}-${ai}`} className="flex items-center gap-3 rounded-lg px-3 py-1.5" style={{ backgroundColor: rookie ? `${team.colors.primary}12` : 'transparent' }}>
                          <span className="text-xs w-6 text-right font-mono text-gray-500">{athlete.jersey}</span>
                          <span className="text-sm flex-1 truncate text-white/80">{athlete.fullName ?? `${athlete.firstName ?? ''} ${athlete.lastName ?? ''}`}</span>
                          {athlete.college?.name && (
                            <span className="text-[10px] text-gray-600 hidden md:inline truncate max-w-24">{athlete.college.name}</span>
                          )}
                          <span className="text-xs text-gray-500">{athlete.experience?.displayValue ?? ''}</span>
                          {rookie && (
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold" style={{ backgroundColor: `${team.colors.primary}40`, color: team.colors.secondary }}>R</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
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
