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
  upcoming: { date: string; opponent: string; opponentLogo: string; location: 'home' | 'away'; venue?: string; isPreseason?: boolean; isLive?: boolean; eventId?: string; homeScore?: string; awayScore?: string; homeAbbr?: string; awayAbbr?: string; statusDetail?: string; seasonTypeName?: string } | null
  lastFive: { date: string; opponent: string; opponentLogo: string; result: 'W' | 'L'; score: string; eventId: string; isPreseason?: boolean; seasonTypeName?: string }[]
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
  const [liveBoxScore, setLiveBoxScore] = useState<any>(null)
  const [isLiveGame, setIsLiveGame] = useState(false)
  const liveGameIdRef = useRef<string | null>(null)
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
        const live = schedForState.upcoming?.isLive
        setIsLiveGame(!!live)
        liveGameIdRef.current = live ? (schedForState.upcomingEventId ?? null) : null
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

  // Odds poll every 30s (uses upcoming or live game ID)
  useEffect(() => {
    if (!team) return
    const abbr = getEspnAbbr(team.id, team.abbreviation)
    const id = setInterval(async () => {
      try {
        let url = `/api/odds?sport=${team.sport}&team=${abbr}`
        const ug = upcomingGameRef.current
        const lg = liveGameIdRef.current
        const gameId = lg || ug?.id
        const gameDate = ug?.date
        if (gameId && gameDate) url += `&eventId=${encodeURIComponent(gameId)}&date=${gameDate}`
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
        const live = result.upcoming?.isLive
        setIsLiveGame(!!live)
        liveGameIdRef.current = live ? (result.upcomingEventId ?? null) : null
      } catch { /* silent */ }
    }, 300000)
    return () => clearInterval(id)
  }, [team?.id])

  // Live box score poll every 15s when a game is in progress
  useEffect(() => {
    if (!team || !isLiveGame || !liveGameIdRef.current) return
    const eventId = liveGameIdRef.current
    const t = team

    async function fetchLiveBoxScore() {
      try {
        const res = await fetch(`/api/box-score?sport=${t.sport}&eventId=${eventId}`)
        if (res.ok) {
          const json = await res.json()
          if (json?.boxScore) {
            setLiveBoxScore(json.boxScore)
            // Update the upcoming game score display from live box score
            const teams = json.boxScore.teams
            const bsStatus = json.boxScore?.status
            if (teams?.length >= 2) {
              setData(p => {
                if (!p?.upcoming?.isLive) return p
                const home = teams.find((t: any) => t.homeAway === 'home')
                const away = teams.find((t: any) => t.homeAway === 'away')
                const statusDetail = bsStatus?.description ?? bsStatus?.shortDetail ?? p.upcoming.statusDetail
                return {
                  ...p,
                  upcoming: {
                    ...p.upcoming,
                    homeScore: home?.score?.displayValue ?? p.upcoming.homeScore,
                    awayScore: away?.score?.displayValue ?? p.upcoming.awayScore,
                    homeAbbr: home?.abbreviation ?? p.upcoming.homeAbbr,
                    awayAbbr: away?.abbreviation ?? p.upcoming.awayAbbr,
                    statusDetail,
                  },
                }
              })
            }
            // If user is viewing this game's box score, update it live too
            setBoxScoreData((prev: any) => prev ? json.boxScore : prev)
          }
        }
      } catch { /* silent */ }
    }

    fetchLiveBoxScore()
    const id = setInterval(fetchLiveBoxScore, 15000)
    return () => { clearInterval(id); setLiveBoxScore(null) }
  }, [team?.id, isLiveGame])

  // Box score fetch on game click
  useEffect(() => {
    if (!selectedGameId || !team) return
    setBoxScoreLoading(true)
    setBoxScoreData(null)
    const abbr = getEspnAbbr(team.id, team.abbreviation)
    fetch(`/api/box-score?sport=${team.sport}&eventId=${selectedGameId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((res) => {
        if (res?.boxScore?._debug) {
          console.log('[BoxScore] Debug info', res.boxScore._debug)
        }
        if (res?.boxScore?.playerStats) {
          // Log first category's stat names vs first athlete's stats keys for comparison
          const firstTeam = res.boxScore.playerStats[0]
          const firstCat = firstTeam?.categories?.[0]
          if (firstCat) {
            console.log('[BoxScore KEYCHECK] statNames:', JSON.stringify(firstCat.statNames))
            const firstAth = firstCat.athletes?.[0]
            if (firstAth) {
              console.log('[BoxScore KEYCHECK] athlete stats keys:', JSON.stringify(Object.keys(firstAth.stats ?? {})))
              console.log('[BoxScore KEYCHECK] athlete stats:', JSON.stringify(firstAth.stats))
              // Check for key overlap
              const statNameSet = new Set(firstCat.statNames ?? [])
              const athleteKeys = Object.keys(firstAth.stats ?? {})
              const overlap = athleteKeys.filter(k => statNameSet.has(k))
              console.log('[BoxScore KEYCHECK] overlapping keys:', JSON.stringify(overlap))
              if (overlap.length === 0 && athleteKeys.length > 0 && firstCat.statNames.length > 0) {
                console.warn('[BoxScore KEYCHECK] ZERO KEY OVERLAP — stat names and stats keys are disjoint sets')
              }
            }
          }
          for (const team of res.boxScore.playerStats) {
            for (const cat of (team.categories ?? [])) {
              if (cat.athletes?.length > 0 && cat.statNames?.length === 0) {
                console.warn('[BoxScore] Category has athletes but no statNames', team.teamAbbr, cat.label, cat.athletes[0])
              }
              for (const a of (cat.athletes ?? [])) {
                if (Object.keys(a.stats ?? {}).length === 0) {
                  console.warn('[BoxScore] Athlete has no stats', team.teamAbbr, cat.label, a.displayName, a)
                }
              }
            }
          }
        }
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
      <div className="px-4 sm:px-6 py-6 sm:py-10">
        <Link href={`/${sport}`} className="text-sm text-gray-500 hover:text-white transition-colors inline-block mb-8">&larr; {config.name}</Link>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <div className={`rounded-xl p-5 sm:p-6 ${data?.upcoming?.isLive ? 'cursor-pointer transition-all duration-300 group' : ''}`}
              style={{ backgroundColor: `${team.colors.primary}12`, border: `1px solid ${team.colors.primary}20` }}
              onClick={() => { if (data?.upcoming?.isLive && data.upcoming.eventId) { setSelectedGameId(data.upcoming.eventId) } }}
              onMouseEnter={(e) => { if (data?.upcoming?.isLive) { e.currentTarget.style.boxShadow = `0 0 20px -6px ${team.colors.primary}50`; e.currentTarget.style.borderColor = `${team.colors.primary}40` } }}
              onMouseLeave={(e) => { if (data?.upcoming?.isLive) { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = `${team.colors.primary}20` } }}>
              <h2 className="text-xs font-medium text-gray-500 tracking-wider uppercase mb-4">{data?.upcoming?.isLive ? 'Live' : 'Next Game'}</h2>
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
                  {data.upcoming.isLive ? (
                    <div className="mt-1">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider bg-red-500/20 text-red-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                          LIVE
                        </span>
                        <span className="text-xs sm:text-sm text-gray-400">{data.upcoming.statusDetail ?? 'Starting soon'}</span>
                        <span className="text-[10px] text-gray-600 ml-auto animate-pulse hidden sm:inline">auto-refreshing</span>
                      </div>
                      {data.upcoming.awayScore != null && data.upcoming.homeScore != null ? (
                        <div className="flex items-center gap-5 mt-1">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-medium text-gray-500 w-8 text-right">{data.upcoming.awayAbbr ?? 'Away'}</span>
                            <span className="text-2xl font-bold font-mono text-white/90 min-w-[3ch] text-right tabular-nums">{data.upcoming.awayScore}</span>
                          </div>
                          <span className="text-lg text-gray-600">-</span>
                          <div className="flex items-center gap-3">
                            <span className="text-2xl font-bold font-mono text-white/90 min-w-[3ch] text-right tabular-nums">{data.upcoming.homeScore}</span>
                            <span className="text-xs font-medium text-gray-500 w-8 text-left">{data.upcoming.homeAbbr ?? 'Home'}</span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-600 mt-1 animate-pulse">Score data loading...</p>
                      )}
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-gray-500 mt-1">{data.upcoming.date}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{data.upcoming.location === 'home' ? 'Home' : 'Away'}{data.upcoming.venue ? ` · ${data.upcoming.venue}` : ''}</p>
                    </>
                  )}
                  {data.upcoming.seasonTypeName && <span className="inline-block mt-2 px-2 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-400 rounded">{data.upcoming.seasonTypeName}</span>}
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

            <div className="rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 hover:scale-[1.02] group" style={{ backgroundColor: `${team.colors.primary}10`, border: `1px solid ${team.colors.primary}18` }}
              onClick={() => setShowRoster((v) => !v)}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 0 24px -6px ${team.colors.primary}50`; e.currentTarget.style.borderColor = `${team.colors.primary}40` }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = `${team.colors.primary}18` }}>
              <div className="w-28 h-28 flex items-center justify-center mb-4 relative">
                {logoFailed ? (
                  <div className="w-28 h-28 rounded-full flex items-center justify-center" style={{ backgroundColor: team.colors.primary }}>
                    <span className="text-3xl font-bold" style={{ color: team.colors.secondary }}>{team.abbreviation}</span>
                  </div>
                ) : (
                  <img src={logoUrl} alt={team.name} className="w-full h-full object-contain" onError={() => setLogoFailed(true)} />
                )}
                <div className="absolute -bottom-1 right-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="w-1 h-1 rounded-full" style={{ backgroundColor: team.colors.primary }} />
                  <div className="w-1 h-1 rounded-full" style={{ backgroundColor: team.colors.primary }} />
                  <div className="w-1 h-1 rounded-full" style={{ backgroundColor: team.colors.primary }} />
                </div>
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
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {data.lastFive.map((game, i) => (
                      <div key={i} className="rounded-lg p-2 flex flex-col items-center text-center transition-all duration-200 cursor-pointer group" style={{ backgroundColor: `${team.colors.primary}0a`, border: `1px solid ${game.eventId === selectedGameId ? team.colors.primary : 'transparent'}` }}
                        onClick={() => setSelectedGameId(game.eventId === selectedGameId ? null : game.eventId)}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${team.colors.primary}18`; e.currentTarget.style.boxShadow = `0 4px 16px -6px ${team.colors.primary}40`; e.currentTarget.style.transform = 'translateY(-2px)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${team.colors.primary}0a`; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)' }}>
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
                        {!game.isPreseason && game.seasonTypeName && <span className="text-[9px] text-amber-400/70">{game.seasonTypeName === 'Preseason' ? 'Pre' : game.seasonTypeName}</span>}
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
              isLive={isLiveGame}
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
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-24 rounded-lg animate-pulse" style={{ backgroundColor: `${team.colors.primary}15` }} />
                    ))}
                  </div>
                ) : data?.lastFive.length ? (
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3 animate-fade-in-up" style={{ animationDelay: '50ms' }}>
                    {data.lastFive.map((game, i) => (
                      <div key={i} className="rounded-lg p-3 flex flex-col items-center text-center transition-all duration-200 cursor-pointer group" style={{ backgroundColor: `${team.colors.primary}0a`, border: `1px solid ${game.eventId === selectedGameId ? team.colors.primary : team.colors.primary}10` }}
                        onClick={() => setSelectedGameId(game.eventId === selectedGameId ? null : game.eventId)}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${team.colors.primary}18`; e.currentTarget.style.boxShadow = `0 4px 16px -6px ${team.colors.primary}40`; e.currentTarget.style.transform = 'translateY(-2px)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${team.colors.primary}0a`; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)' }}>
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
                          {!game.isPreseason && game.seasonTypeName && <span className="text-[10px] text-amber-400/70">{game.seasonTypeName === 'Preseason' ? 'Pre' : game.seasonTypeName}</span>}
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

function getPeriodLabels(sport: string): string[] {
  const sportKey = sport.toUpperCase()
  if (sportKey === 'NBA' || sportKey === 'NFL') {
    return ['Q1', 'Q2', 'Q3', 'Q4', 'OT1', 'OT2', 'OT3', 'OT4', 'OT5', 'OT6', 'OT7', 'OT8']
  }
  if (sportKey === 'NHL') {
    return ['1st', '2nd', '3rd', 'OT', 'SO', '', '', '', '', '', '', '']
  }
  if (sportKey === 'MLB') {
    return ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th']
  }
  return ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']
}

const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)

const teamStatLabels: Record<string, string> = {
  totalFirstDowns: '1st Downs', firstDownRushing: 'Rush 1st', firstDownPassing: 'Pass 1st', firstDownPenalty: 'Penalty 1st',
  totalYards: 'Total Yards', passingYards: 'Pass Yds', rushingYards: 'Rush Yds', netPassingYards: 'Net Pass', grossPassingYards: 'Gross Pass',
  turnovers: 'TO', interceptionsThrown: 'INT', lostFumbles: 'Fum Lost', forcedFumbles: 'FF', fumblesRecovered: 'Fum Rec',
  tackles: 'Tackles', sacks: 'Sacks', interceptions: 'INT', safeties: 'Safeties',
  thirdDownEfficiency: '3rd Down', fourthDownEfficiency: '4th Down', redZoneEfficiency: 'Red Zone',
  penalties: 'Penalties', penaltyYards: 'Pen Yds', possessionTime: 'Possession',
  fieldGoalPct: 'FG%', threePointPct: '3P%', freeThrowPct: 'FT%',
  totalRebounds: 'REB', offensiveRebounds: 'OREB', defensiveRebounds: 'DREB',
  assists: 'AST', assistTurnoverRatio: 'A/TO', steals: 'STL', blocks: 'BLK', personalFouls: 'PF',
  points: 'PTS', fastBreakPoints: 'FB Pts', pointsInPaint: 'Paint Pts', secondChancePoints: '2nd Chance',
  fieldGoalsMade: 'FGM', fieldGoalsAttempted: 'FGA', threePointFieldGoalsMade: '3PM', threePointFieldGoalsAttempted: '3PA',
  freeThrowsMade: 'FTM', freeThrowsAttempted: 'FTA',
  shotsOnGoal: 'SOG', faceoffWinPct: 'FO%', powerPlayPct: 'PP%', penaltyMinutes: 'PIM',
  blockedShots: 'Blk', hits: 'Hits', giveaways: 'GA', takeaways: 'TK',
  powerPlayGoals: 'PPG', powerPlayOpportunities: 'PPO', shortHandedGoals: 'SHG',
  penaltyKillPct: 'PK%', shots: 'Shots',
  atBats: 'AB', runs: 'R', runsBattedIn: 'RBI', homeRuns: 'HR',
  walks: 'BB', strikeouts: 'K', battingAvg: 'AVG', onBasePct: 'OBP', sluggingPct: 'SLG', ops: 'OPS',
  stolenBases: 'SB', caughtStealing: 'CS', errors: 'E', putOuts: 'PO', doublePlays: 'DP',
  fieldingPct: 'FLD%', inningsPitched: 'IP', earnedRuns: 'ER', era: 'ERA', whip: 'WHIP',
  pitchesThrown: 'Pitches', strikesThrown: 'Strikes',
}

const playerStatLabels: Record<string, string> = {
  G: 'Goals', A: 'Assists', PTS: 'Points', P: 'Points',
  SOG: 'SOG', S: 'Shots', TOI: 'TOI',
  PPTOI: 'PP TOI', SHTOI: 'SH TOI', ESTOI: 'EV TOI', EVTOI: 'EV TOI',
  BS: 'Blk Shots', BLK: 'Blocks', HT: 'Hits', HIT: 'Hits',
  TK: 'Takeaways', GV: 'Giveaways',
  FW: 'FOW', FL: 'FOL',
  SHFT: 'Shifts', SM: 'Missed', PN: 'Penalties', PIM: 'PIM',
  YTDG: 'GP',
  GA: 'GA', SA: 'SA', SV: 'Saves',
  SOS: 'SO Saves', SOSA: 'SO Att', ESSV: 'EV Saves', PPSV: 'PP Saves', SHSV: 'SH Saves',
  'H-AB': 'H/AB',
  MIN: 'Minutes', FG: 'FG', '3PT': '3PT', FT: 'FT',
  REB: 'Rebounds', AST: 'Assists', TO: 'Turnovers', STL: 'Steals',
  OREB: 'Off Reb', DREB: 'Def Reb', PF: 'Fouls',
}

function prettifyName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()
}

function BoxScorePanel({ data, loading, teamAbbr, teamColor, sport, isLive, onBack }: { data: any; loading: boolean; teamAbbr: string; teamColor: string; sport: string; isLive?: boolean; onBack: () => void }) {
  const [showPlayerStats, setShowPlayerStats] = useState(false)

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

  const hasAnyPlayerStats = sortedPlayerStats.some((t: any) => t.categories?.some((c: any) => c.athletes?.length > 0))

  const allStats = useMemo(() => {
    if (!ourTeam?.statistics?.length && !oppTeam?.statistics?.length) return []
    const names = new Set<string>()
    const rows: { name: string; our: string; opp: string }[] = []
    for (const s of ourTeam?.statistics ?? []) {
      if (!names.has(s.name)) {
        names.add(s.name)
        const opp = oppTeam?.statistics?.find((x: any) => x.name === s.name)
        rows.push({ name: s.name, our: s.displayValue ?? '-', opp: opp?.displayValue ?? '-' })
      }
    }
    for (const s of oppTeam?.statistics ?? []) {
      if (!names.has(s.name)) {
        names.add(s.name)
        rows.push({ name: s.name, our: '-', opp: s.displayValue ?? '-' })
      }
    }
    return rows
  }, [ourTeam, oppTeam])

  return (
    <div className="animate-fade-in-up mt-4 pt-3" style={{ borderTop: `1px solid ${teamColor}15` }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium tracking-wider uppercase text-gray-400">Box Score</h3>
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="inline-flex items-center gap-1.5 text-[10px] text-red-400 font-medium mr-1">
              <span className="relative flex w-2 h-2">
                <span className="absolute w-full h-full rounded-full bg-red-400 animate-ping opacity-75" />
                <span className="relative w-2 h-2 rounded-full bg-red-500" />
              </span>
              LIVE · updating
            </span>
          )}
          <button onClick={() => setShowPlayerStats((v) => !v)}
            className="text-xs px-2 py-1 rounded transition-colors text-gray-400 hover:text-white"
            style={{ backgroundColor: `${teamColor}15`, border: `1px solid ${teamColor}25` }}>
            {showPlayerStats ? 'Team Stats' : 'Player Stats'}
          </button>
          <button onClick={onBack}
            className="text-xs px-2 py-1 rounded transition-colors text-gray-400 hover:text-white"
            style={{ backgroundColor: `${teamColor}15`, border: `1px solid ${teamColor}25` }}>
            &larr; Back
          </button>
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse"><div className="h-20 rounded-lg" style={{ backgroundColor: `${teamColor}10` }} /></div>
      ) : !data?.teams?.length ? (
        <p className="text-sm text-gray-500">Box score unavailable</p>
      ) : (
        <>
          {/* Period scores — always visible */}
          {maxPeriods > 0 && (
            <div className="overflow-x-auto mb-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-600">
                    <th className="text-left pr-3 pb-1 font-medium tracking-wider text-[10px]" />
                    {Array.from({ length: maxPeriods }, (_, i) => (
                      <th key={i} className="text-center px-1.5 pb-1 font-medium text-[10px] tracking-wider">{getPeriodLabels(sport)[i]}</th>
                    ))}
                    <th className="text-center pl-2 pb-1 font-medium text-white/60 text-[10px] tracking-wider">T</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="text-white/85" style={{ borderBottom: `1px solid ${teamColor}10` }}>
                    <td className="pr-3 py-1 font-medium text-xs">{ourTeam?.abbreviation ?? 'Home'}</td>
                    {Array.from({ length: maxPeriods }, (_, i) => (
                      <td key={i} className="text-center px-1.5 py-1 font-mono tabular-nums">{ourTeam?.linescores?.[i] ?? '-'}</td>
                    ))}
                    <td className="text-center pl-2 py-1 font-mono tabular-nums text-white font-semibold">{ourTeam ? sum(ourTeam.linescores) : '-'}</td>
                  </tr>
                  <tr className="text-white/85">
                    <td className="pr-3 py-1 font-medium text-xs">{oppTeam?.abbreviation ?? 'Away'}</td>
                    {Array.from({ length: maxPeriods }, (_, i) => (
                      <td key={i} className="text-center px-1.5 py-1 font-mono tabular-nums">{oppTeam?.linescores?.[i] ?? '-'}</td>
                    ))}
                    <td className="text-center pl-2 py-1 font-mono tabular-nums text-white font-semibold">{oppTeam ? sum(oppTeam.linescores) : '-'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Team stats (default view) */}
          {!showPlayerStats && (
            <>
              {allStats.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-600">
                        <th className="text-left pr-3 pb-1 font-medium tracking-wider uppercase text-[10px]" />
                        <th className="text-right px-2 pb-1 font-medium tracking-wider uppercase text-[10px]" style={{ color: teamColor }}>{ourTeam?.abbreviation ?? 'Home'}</th>
                        <th className="text-right pl-2 pb-1 font-medium tracking-wider uppercase text-[10px] text-gray-500">{oppTeam?.abbreviation ?? 'Away'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allStats.map((s, si) => (
                        <tr key={si} className="text-white/70" style={si % 2 === 1 ? { backgroundColor: `${teamColor}08` } : undefined}>
                          <td className="pr-3 py-1 text-gray-400 text-xs tracking-wide">{teamStatLabels[s.name] ?? prettifyName(s.name)}</td>
                          <td className="text-right px-2 py-1 font-mono tabular-nums">{s.our}</td>
                          <td className="text-right pl-2 py-1 font-mono tabular-nums">{s.opp}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Team stats not yet available</p>
              )}
            </>
          )}

          {/* Player stats (toggle view) — side by side */}
          {showPlayerStats && (
            <>
              {hasAnyPlayerStats ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sortedPlayerStats.map((team: any, ti: number) => {
                    const isOurTeam = team.teamAbbr === teamAbbr
                    return (
                      <div key={team.teamAbbr || ti}>
                        <p className="text-xs font-medium mb-2 tracking-wider uppercase" style={{ color: isOurTeam ? teamColor : undefined, opacity: isOurTeam ? 1 : 0.7 }}>
                          {team.teamAbbr}
                        </p>
                        {team.categories.map((cat: any, ci: number) => (
                          <div key={ci} className="mb-3">
                            <h5 className="text-[10px] font-medium text-gray-500 mb-1 uppercase tracking-wider">{cat.label}</h5>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-gray-600">
                                    <th className="text-left pr-2 pb-1 font-medium">#</th>
                                    <th className="text-left pr-2 pb-1 font-medium">Player</th>
                                    {cat.statNames.map((n: string, ni: number) => (
                                      <th key={ni} className="text-right px-1 pb-1 font-medium text-gray-500 text-[10px] tracking-wider">{playerStatLabels[n] ?? prettifyName(n)}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {cat.athletes.map((a: any, ai: number) => (
                                    <tr key={a.id || ai} className="text-white/70" style={ai % 2 === 1 ? { backgroundColor: isOurTeam ? `${teamColor}08` : `${teamColor}04` } : undefined}>
                                      <td className="pr-2 py-0.5 font-mono text-gray-500 text-right">{a.jersey ?? ''}</td>
                                      <td className="pr-2 py-0.5 truncate max-w-28">
                                        {a.displayName}
                                        {a.position ? <span className="text-gray-500 ml-0.5">({a.position})</span> : ''}
                                      </td>
                                      {cat.statNames.map((n: string, ni: number) => (
                                        <td key={ni} className="text-right px-1 py-0.5 font-mono tabular-nums">{a.stats?.[n] ?? '-'}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Player stats not yet available</p>
              )}
            </>
          )}

          {data?.status && (
            <p className="text-[10px] text-gray-600 mt-1">{data.status.shortDetail ?? data.status.description}</p>
          )}
        </>
      )}
    </div>
  )
}

function getSeasonTypeName(e: EspnEvent): string | undefined {
  const t = e.seasonType?.type ?? e.season?.type
  if (!t) return undefined
  if (t === 1) return 'Preseason'
  if (t === 3) return 'Playoffs'
  if (t === 4) return 'Summer League'
  return e.seasonType?.name ?? undefined
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
      seasonTypeName: getSeasonTypeName(e),
    }
  })

  let upcoming: TeamDashboardData['upcoming'] = null
  let upcomingEventId: string | null = null
  let upcomingDate: string | null = null

  if (schedule.upcoming) {
    const comp = schedule.upcoming.competitions?.[0]
    const status = comp?.status?.type
    const isLive = status?.state === 'in' || (status?.name === 'STATUS_IN_PROGRESS')
    const opp = getOpponent(schedule.upcoming, espnAbbr, sport)
    const venue = comp?.venue?.fullName

    let homeScore: string | undefined
    let awayScore: string | undefined
    let homeAbbr: string | undefined
    let awayAbbr: string | undefined
    if (isLive && comp?.competitors) {
      const home = comp.competitors.find(c => c.homeAway === 'home')
      const away = comp.competitors.find(c => c.homeAway === 'away')
      homeScore = home?.score?.displayValue
      awayScore = away?.score?.displayValue
      homeAbbr = home?.team?.abbreviation
      awayAbbr = away?.team?.abbreviation
    }

    upcoming = {
      date: isLive ? (status?.detail ?? status?.shortDetail) : getGameDetail(schedule.upcoming),
      opponent: opp.name,
      opponentLogo: opp.logo,
      location: opp.location,
      venue,
      isPreseason: schedule.upcoming.seasonType?.type === 1 || schedule.upcoming.season?.type === 1,
      isLive,
      eventId: schedule.upcoming.id,
      homeScore,
      awayScore,
      homeAbbr,
      awayAbbr,
      statusDetail: isLive ? (status?.detail ?? status?.shortDetail ?? 'In progress') : undefined,
      seasonTypeName: getSeasonTypeName(schedule.upcoming),
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

const nflStatKey: Record<string, string> = {
  cmp: 'completions', att: 'passingAttempts', passYd: 'passingYards',
  passTd: 'passingTouchdowns', int: 'interceptions', qbr: 'QBRating',
  car: 'rushingAttempts', rushYd: 'rushingYards', rushTd: 'rushingTouchdowns',
  rec: 'receptions', recYd: 'receivingYards', tgt: 'receivingTargets',
  recTd: 'receivingTouchdowns', fgm: 'fieldGoalsMade', fga: 'fieldGoalsAttempted',
  xpm: 'kickExtraPointsMade', xpa: 'kickExtraPointsAttempted',
  solo: 'soloTackles', ast: 'assistTackles', sack: 'sacks',
  tfl: 'tacklesForLoss', qbHit: 'QBHits', defInt: 'interceptions',
  pd: 'passesDefensed', ff: 'forcedFumbles', fr: 'fumbleRecoveries',
  punt: 'punts', puntYd: 'puntYards', puntAvg: 'grossAvgPuntYards',
  puntIn20: 'puntsInside20',
}

const nflDefSchema = [
  { key: 'solo', label: 'SOLO' }, { key: 'ast', label: 'AST' },
  { key: 'sack', label: 'SACK' }, { key: 'tfl', label: 'TFL' },
]

const nflStatSchema: Record<string, { key: string; label: string }[]> = {
  QB: [
    { key: 'cmp', label: 'CMP' }, { key: 'att', label: 'ATT' },
    { key: 'passYd', label: 'YD' }, { key: 'passTd', label: 'TD' },
    { key: 'int', label: 'INT' }, { key: 'qbr', label: 'QBR' },
  ],
  RB: [
    { key: 'car', label: 'CAR' }, { key: 'rushYd', label: 'YD' },
    { key: 'rushTd', label: 'TD' }, { key: 'rec', label: 'REC' },
    { key: 'recYd', label: 'REC YD' },
  ],
  FB: [
    { key: 'car', label: 'CAR' }, { key: 'rushYd', label: 'YD' },
    { key: 'rushTd', label: 'TD' }, { key: 'rec', label: 'REC' },
    { key: 'recYd', label: 'REC YD' },
  ],
  WR: [
    { key: 'rec', label: 'REC' }, { key: 'recYd', label: 'YD' },
    { key: 'tgt', label: 'TGT' }, { key: 'recTd', label: 'TD' },
  ],
  TE: [
    { key: 'rec', label: 'REC' }, { key: 'recYd', label: 'YD' },
    { key: 'tgt', label: 'TGT' }, { key: 'recTd', label: 'TD' },
  ],
  K: [
    { key: 'fgm', label: 'FGM' }, { key: 'fga', label: 'FGA' },
    { key: 'xpm', label: 'XPM' }, { key: 'xpa', label: 'XPA' },
  ],
  P: [
    { key: 'punt', label: 'PUNT' }, { key: 'puntYd', label: 'YD' },
    { key: 'puntAvg', label: 'AVG' }, { key: 'puntIn20', label: 'IN20' },
  ],
  DE: nflDefSchema, DT: nflDefSchema, NT: nflDefSchema,
  PK: [
    { key: 'fgm', label: 'FGM' }, { key: 'fga', label: 'FGA' },
    { key: 'xpm', label: 'XPM' }, { key: 'xpa', label: 'XPA' },
  ],
  OLB: [...nflDefSchema, { key: 'qbHit', label: 'QBHIT' }, { key: 'pd', label: 'PD' }],
  MLB: [...nflDefSchema, { key: 'qbHit', label: 'QBHIT' }, { key: 'pd', label: 'PD' }],
  ILB: [...nflDefSchema, { key: 'qbHit', label: 'QBHIT' }, { key: 'pd', label: 'PD' }],
  LB: [...nflDefSchema, { key: 'qbHit', label: 'QBHIT' }, { key: 'pd', label: 'PD' }],
  CB: [
    { key: 'solo', label: 'SOLO' }, { key: 'ast', label: 'AST' },
    { key: 'defInt', label: 'INT' }, { key: 'pd', label: 'PD' },
    { key: 'ff', label: 'FF' },
  ],
  S: [
    { key: 'solo', label: 'SOLO' }, { key: 'ast', label: 'AST' },
    { key: 'defInt', label: 'INT' }, { key: 'pd', label: 'PD' },
    { key: 'ff', label: 'FF' },
  ],
  SS: [
    { key: 'solo', label: 'SOLO' }, { key: 'ast', label: 'AST' },
    { key: 'defInt', label: 'INT' }, { key: 'pd', label: 'PD' },
    { key: 'ff', label: 'FF' },
  ],
  FS: [
    { key: 'solo', label: 'SOLO' }, { key: 'ast', label: 'AST' },
    { key: 'defInt', label: 'INT' }, { key: 'pd', label: 'PD' },
    { key: 'ff', label: 'FF' },
  ],
  OT: [], OG: [], C: [], LS: [],
}

function renderNflStats(stats: Record<string, string> | null, pos: string): { schema: { key: string; label: string }[]; values: (string | null)[] } {
  const schema = nflStatSchema[pos] ?? []
  if (!stats) return { schema, values: schema.map(() => null) }
  const values = schema.map(s => {
    const espnKey = nflStatKey[s.key]
    return espnKey && stats[espnKey] !== undefined ? stats[espnKey] : null
  })
  return { schema, values }
}

const relevantStats: Record<string, { label: string; key: string }[]> = {
  NBA: [
    { label: 'PTS', key: 'avgPoints' }, { label: 'AST', key: 'avgAssists' },
    { label: 'REB', key: 'avgRebounds' }, { label: 'STL', key: 'avgSteals' },
    { label: 'BLK', key: 'avgBlocks' }, { label: 'MIN', key: 'avgMinutes' },
    { label: 'FG%', key: 'fieldGoalPct' }, { label: '3P%', key: 'threePointPct' },
    { label: 'FT%', key: 'freeThrowPct' },
  ],
  NHL: [
    { label: 'G', key: 'goals' }, { label: 'A', key: 'assists' },
    { label: 'PTS', key: 'points' }, { label: '+/-', key: 'plusMinus' },
    { label: 'PIM', key: 'penaltyMinutes' }, { label: 'SOG', key: 'shotsOnGoal' },
    { label: 'TOI', key: 'timeOnIce' },
  ],
  MLB: [
    { label: 'AVG', key: 'battingAvg' }, { label: 'HR', key: 'homeRuns' },
    { label: 'RBI', key: 'runsBattedIn' }, { label: 'OBP', key: 'onBasePercentage' },
    { label: 'SLG', key: 'sluggingPercentage' }, { label: 'SB', key: 'stolenBases' },
    { label: 'ERA', key: 'era' }, { label: 'W', key: 'wins' },
    { label: 'L', key: 'losses' }, { label: 'SO', key: 'strikeouts' },
    { label: 'BB', key: 'walks' }, { label: 'SV', key: 'saves' },
  ],
}

function RosterPanel({ team, roster, loading, onBack }: { team: any; roster: any[] | null; loading: boolean; onBack: () => void }) {
  const posOrder: { key: string; name: string }[] = []
  const posRank: Record<string, number> = {}
  const order = sportPositionOrder[team.sport] ?? []
  order.forEach((p, i) => { posRank[p] = i; posOrder.push({ key: p, name: p }) })

  const groups: Record<string, any[]> = {}
  if (roster) {
    for (const a of roster) {
      const abbr = a.position?.abbreviation ?? 'POS'
      if (!groups[abbr]) groups[abbr] = []
      groups[abbr].push(a)
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => (b.primaryStat ?? -1) - (a.primaryStat ?? -1))
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
              const stats = groups[abbr]
              return (
                <div key={abbr || `pos-${pi}`}>
                  <p className="text-xs font-medium mb-2 tracking-wider text-gray-400">{posName} <span className="text-gray-600">({abbr})</span></p>
                  <div className="space-y-0.5">
                    {stats.map((athlete: any, ai) => {
                      const rookie = checkRookie(athlete)
                      const hasStats = athlete.seasonStats
                      const isNfl = team.sport === 'NFL'
                      const nflRendered = isNfl && hasStats ? renderNflStats(athlete.seasonStats, athlete.position?.abbreviation ?? '') : null
                      const nflSchema = nflRendered?.schema
                      const nflValues = nflRendered?.values
                      return (
                        <div key={athlete.id ?? `athlete-${pi}-${ai}`} className="flex items-center gap-2 sm:gap-3 rounded-lg px-2 sm:px-3 py-1.5" style={{ backgroundColor: rookie ? `${team.colors.primary}12` : 'transparent' }}>
                          <span className="text-xs w-5 sm:w-6 text-right font-mono text-gray-500">{athlete.jersey}</span>
                          <span className="text-xs sm:text-sm flex-1 truncate text-white/80">{athlete.fullName ?? `${athlete.firstName ?? ''} ${athlete.lastName ?? ''}`}</span>
                          {nflSchema && nflSchema.length > 0 && (
                            <div className="flex items-center gap-2 sm:gap-3 font-mono tabular-nums overflow-x-auto" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {nflSchema.map((s, si) => (
                                <div key={s.key} className="text-right flex-shrink-0" style={{ minWidth: si < 2 ? '3.5rem' : '2.5rem' }}>
                                  <span className="text-[9px] sm:text-[10px] text-gray-500">{s.label}</span>
                                  <span className="text-[10px] sm:text-[11px] text-white/80 ml-0.5">{nflValues![si] ?? '—'}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {!isNfl && hasStats && relevantStats[team.sport] && (
                            <div className="flex items-center gap-1.5 sm:gap-2 font-mono tabular-nums overflow-x-auto" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {relevantStats[team.sport].map(s => {
                                const v = athlete.seasonStats[s.key]
                                if (v === undefined || v === null) return null
                                return (
                                  <div key={s.key} className="text-right flex-shrink-0" style={{ minWidth: '2.5rem' }}>
                                    <span className="text-[9px] sm:text-[10px] text-gray-500">{s.label}</span>
                                    <span className="text-[10px] sm:text-[11px] text-white/80 ml-0.5">{v}</span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                          {!hasStats && athlete.college?.name && (
                            <span className="text-[10px] text-gray-600 hidden lg:inline truncate max-w-20">{athlete.college.name}</span>
                          )}
                          {!hasStats && !athlete.college?.name && athlete.experience?.displayValue && (
                            <span className="text-[10px] text-gray-500">{athlete.experience.displayValue}</span>
                          )}
                          {!hasStats && !athlete.college?.name && !athlete.experience?.displayValue && (
                            <span className="text-[10px] text-gray-600">No stats yet</span>
                          )}
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
