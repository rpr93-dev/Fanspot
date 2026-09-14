'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import { teams, sportConfig, sportPath } from '@/data/teams'
import { useParams } from 'next/navigation'
import { getTeamSchedule, getTeamNews, getEspnAbbr } from '@/lib/sports-api'
import StandingsBox from './StandingsBox'
import NextGamePanel from '@/components/NextGamePanel'
import AiNalyst from '@/components/AiNalyst'
import FantasyWidget from '@/components/FantasyWidget'
import type { EspnEvent } from '@/lib/sports-api'
import { playerStatLabels, sportPositionOrder, nflStatKey, nflStatSchema, relevantStats } from '@/lib/roster-stats'
import { GameStatsSection } from '@/components/box-score/GameStatsSection'

function useTeamDashboard(sport: string, teamId: string, teamName: string, teamAbbreviation: string) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!teamId || !teamName) { setLoading(false); return }
    let cancelled = false
    const abbr = getEspnAbbr(teamId, teamAbbreviation)

    async function load() {
      try {
        const res = await fetch(`/api/team/${teamId}/dashboard?sport=${sport}&roster=false`, {
          signal: AbortSignal.timeout(20000),
        })
        if (!res.ok) throw new Error(`Dashboard API returned ${res.status}`)
        const dashboard = await res.json()
        if (cancelled) return
      setData(dashboard)
    } catch (err) {
      console.error('[dashboard] Failed to load:', err)
      if (!cancelled) setData(null)
    } finally {
      if (!cancelled) setLoading(false)
    }
    }

    load()
  }, [teamId, sport, teamName])

  return { dashboard: data, loading }
}

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
  spread?: number | null
  overUnder?: number | null
}

interface TeamDashboardData {
  upcoming: { date: string; opponent: string; opponentAbbr?: string; opponentLogo: string; location: 'home' | 'away'; venue?: string; isPreseason?: boolean; isLive?: boolean; eventId?: string; eventDate?: string; kickoff?: string; homeScore?: string; awayScore?: string; homeAbbr?: string; awayAbbr?: string; statusDetail?: string; seasonTypeName?: string } | null
  lastFive: { date: string; opponent: string; opponentAbbr: string; opponentLogo: string; result: 'W' | 'L'; score: string; eventId: string; isPreseason?: boolean; seasonTypeName?: string }[]
  oddsInfo: OddsInfo | null
  news: { title: string; source: string; date: string; snippet: string; url: string }[]
  standings: ConferenceGroup[]
  teamStanding: string
  standingsMessage?: string
  spotlightEvent?: EspnEvent | null
  spotlightEventId?: string | null
}

function getGameDetail(event: EspnEvent): string {
  return event.competitions?.[0]?.status?.type?.shortDetail ?? new Date(event.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' })
}

function getShortDate(event: EspnEvent): string {
  return new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Maps an opponent's ESPN abbreviation (e.g. WSH) to the teams.ts abbreviation the
 * fantasy pipeline uses (e.g. WAS). Falls back to the ESPN abbr when unknown.
 */
function getOpponentFantasyAbbr(opponentEspnAbbr: string, opponentName: string, sport: string): string {
  const match = teams.find((t) => {
    if (t.sport !== sport.toUpperCase()) return false
    return getEspnAbbr(t.id, t.abbreviation) === opponentEspnAbbr || t.name === opponentName
  })
  return match?.abbreviation ?? opponentEspnAbbr
}

/**
 * Odds poll cadence, driven by the game clock:
 *  - live or within an hour of kickoff → 30s (live odds)
 *  - within 24h → hourly
 *  - otherwise → every 6h (preseason/regular-season odds post days ahead and barely
 *    move, so polling more often just burns the sportsbook quota)
 */
function oddsPollInterval(
  upcoming: { id: string; date: string; kickoff?: string } | null,
  isLive: boolean,
): number {
  if (isLive) return 30_000
  const kickoff = upcoming?.kickoff ? new Date(upcoming.kickoff).getTime() : null
  if (!kickoff) return 6 * 60 * 60 * 1000
  const msUntil = kickoff - Date.now()
  if (msUntil <= 60 * 60 * 1000) return 30_000
  if (msUntil <= 24 * 60 * 60 * 1000) return 60 * 60 * 1000
  return 6 * 60 * 60 * 1000
}

function getOpponent(event: EspnEvent, teamAbbr: string, sport: string): { name: string; abbr: string; logo: string; location: 'home' | 'away' } {
  const competitors = event.competitions?.[0]?.competitors ?? []
  const opponent = competitors.find((c) => c.team.abbreviation !== teamAbbr)
  const home = competitors.find((c) => c.homeAway === 'home')
  const isHome = home?.team.abbreviation === teamAbbr
  const oppAbbr = opponent?.team.abbreviation ?? ''
  return {
    name: opponent?.team.displayName ?? 'Unknown',
    abbr: oppAbbr,
    logo: opponent?.team.logo ?? (oppAbbr ? getTeamLogoUrl(oppAbbr, sport) : ''),
    location: isHome ? 'home' : ('away' as 'home' | 'away'),
  }
}

function getScore(event: EspnEvent, teamAbbr: string): string {
  const competitors = event.competitions?.[0]?.competitors ?? []
  const team = competitors.find((c) => c.team.abbreviation === teamAbbr)
  const opp = competitors.find((c) => c.team.abbreviation !== teamAbbr)
  // ESPN score shape varies: plain string ("0") vs { displayValue }.
  const disp = (s: any): string => (s == null ? '' : (typeof s === 'object' ? (s.displayValue ?? '') : String(s)))
  const a = disp(team?.score)
  const b = disp(opp?.score)
  if (!a || !b) return ''
  return `${a}-${b}`
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

  const [showRoster, setShowRoster] = useState(false)
  const [rosterData, setRosterData] = useState<any[] | null>(null)
  const [rosterLoading, setRosterLoading] = useState(false)
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null)
  const [boxScoreData, setBoxScoreData] = useState<any>(null)
  const [boxScoreLoading, setBoxScoreLoading] = useState(false)
  const [liveBoxScore, setLiveBoxScore] = useState<any>(null)
  const [isLiveGame, setIsLiveGame] = useState(false)
  const [showNextGame, setShowNextGame] = useState(false)
  const [scraperLoading, setScraperLoading] = useState(false)
  const [scraperData, setScraperData] = useState<any>(null)
  const [scraperError, setScraperError] = useState<string | null>(null)
  const [hasAutoScraped, setHasAutoScraped] = useState(false)
  const liveGameIdRef = useRef<string | null>(null)
  const upcomingGameRef = useRef<{ id: string; date: string; kickoff?: string } | null>(null)

  const team = teams.find((t) => t.id === teamId && t.sport === sport.toUpperCase())
  const config = sportConfig[sport.toUpperCase()]

  const { dashboard, loading: dashLoading } = useTeamDashboard(
    sport, teamId, team?.name ?? '', team?.abbreviation ?? ''
  )

  useEffect(() => {
    if (dashLoading) return
    if (!dashboard) {
      setLoading(false)
      setData(team ? getFallbackData(team.name, team.sport, getEspnAbbr(team.id, team.abbreviation)) : null)
      return
    }

    const abbr = getEspnAbbr(dashboard.team.id, dashboard.team.abbreviation)
    const schedule = dashboard.schedule
    const schedForState = processScheduleForState(
      { upcoming: schedule.upcoming, lastFive: schedule.lastFive, spotlightEventId: schedule.spotlightEventId },
      abbr,
      dashboard.team.sport
    )

    upcomingGameRef.current = schedForState.upcomingEventId
      ? { id: schedForState.upcomingEventId, date: schedForState.upcomingDate!, kickoff: schedForState.upcoming?.kickoff }
      : null

    const standings = dashboard.standings
    const newsItems = (dashboard.news ?? []).map((a: any) => ({
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
      oddsInfo: dashboard.odds?.odds ?? null,
      news: newsItems.length > 0 ? newsItems : getFallbackNews(dashboard.team.name, dashboard.team.sport, abbr),
      standings: standings?.standings ?? [],
      teamStanding: standings?.teamStanding ?? '',
      standingsMessage: standings?.message ?? '',
      spotlightEvent: schedForState.spotlightEvent,
      spotlightEventId: schedForState.spotlightEventId,
    })
    const live = schedForState.upcoming?.isLive
    setIsLiveGame(!!live)
    liveGameIdRef.current = live ? (schedForState.upcomingEventId ?? null) : null
    setLoading(false)
  }, [dashboard, dashLoading])

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
      .catch((e) => { console.error('[roster fetch]', e); setRosterLoading(false) })
  }, [showRoster, team?.id])

  // Reset scraper state when navigating to a different team.
  useEffect(() => {
    setHasAutoScraped(false)
    setScraperData(null)
    setScraperError(null)
  }, [teamId, sport])

  // Auto-scrape player lines via Docker the second a team page loads
  // with an upcoming game. Results flow into NextGamePanel as props.
  useEffect(() => {
    if (!team || !data?.upcoming?.eventId || !data.upcoming.opponentAbbr || hasAutoScraped) return
    let cancelled = false
    setScraperLoading(true)
    setScraperError(null)

    fetch('/api/scraper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        team: getEspnAbbr(team.id, team.abbreviation),
        opponent: data.upcoming.opponentAbbr,
        gameDate: (data.upcoming.eventDate ?? data.upcoming.date ?? '').replace(/\D/g, ''),
        sport: team.sport.toUpperCase(),
      }),
      signal: AbortSignal.timeout(120_000),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Scraper returned ${res.status}`)
        return res.json()
      })
      .then((json) => {
        if (cancelled) return
        setScraperData(json.results)
        setHasAutoScraped(true)
      })
      .catch((err) => {
        console.error('[scraper] Auto-scraper failed:', err)
        if (!cancelled) setScraperError(err?.message || 'Scraper unavailable')
      })
      .finally(() => {
        if (!cancelled) setScraperLoading(false)
      })

    return () => { cancelled = true }
  }, [team?.id, data?.upcoming?.eventId])

  // Odds poll — cadence follows the game clock: ~6h out, hourly the day before,
  // live (30s) within an hour of kickoff or while the game is in progress.
  useEffect(() => {
    if (!team) return
    const t = team
    const abbr = getEspnAbbr(t.id, t.abbreviation)

    let timer: ReturnType<typeof setTimeout>
    let stopped = false

    async function poll() {
      if (stopped) return
      if (document.hidden) { schedule(); return } // background tab: skip the fetch, keep the cycle alive
      try {
        let url = `/api/odds?sport=${t.sport}&team=${abbr}`
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
      } catch (e) { console.error('[odds poll]', e) }
      schedule()
    }

    function schedule() {
      if (stopped) return
      timer = setTimeout(poll, oddsPollInterval(upcomingGameRef.current, !!liveGameIdRef.current))
    }

    // First fetch after a short beat so the dashboard's initial load (which already
    // includes odds) doesn't double-fetch; then let the interval take over.
    timer = setTimeout(poll, 5000)
    return () => { stopped = true; clearTimeout(timer) }
  }, [team?.id, isLiveGame])

  // News poll every 120s
  useEffect(() => {
    if (!team) return
    const id = setInterval(async () => {
      if (document.hidden) return // background tab
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
        setData(p => p ? { ...p, news: items.length > 0 ? items : getFallbackNews(team.name, team.sport, getEspnAbbr(team.id, team.abbreviation)) } : p)
      } catch (e) { console.error('[news poll]', e) }
    }, 120000)
    return () => clearInterval(id)
  }, [team?.id])

  // Standings poll every 120s
  useEffect(() => {
    if (!team) return
    const abbr = getEspnAbbr(team.id, team.abbreviation)
    const id = setInterval(async () => {
      if (document.hidden) return // background tab
      try {
        const res = await fetch(`/api/standings?sport=${team.sport}&team=${abbr}`)
        if (res.ok) {
          const json = await res.json()
          setData(p => p ? { ...p, standings: json.standings ?? [], teamStanding: json.teamStanding ?? '', standingsMessage: json.message ?? '' } : p)
        }
      } catch (e) { console.error('[standings poll]', e) }
    }, 120000)
    return () => clearInterval(id)
  }, [team?.id])

  // Schedule poll every 300s
  useEffect(() => {
    if (!team) return
    const id = setInterval(async () => {
      if (document.hidden) return // background tab
      try {
        const schedule = await getTeamSchedule(team.sport, team.id, team.abbreviation)
        const abbr = getEspnAbbr(team.id, team.abbreviation)
        const result = processScheduleForState(schedule, abbr, team.sport)
        upcomingGameRef.current = result.upcomingEventId
          ? { id: result.upcomingEventId, date: result.upcomingDate!, kickoff: result.upcoming?.kickoff }
          : null
        setData(p => p ? { ...p, upcoming: result.upcoming, lastFive: result.lastFive, spotlightEvent: result.spotlightEvent, spotlightEventId: result.spotlightEventId } : p)
        const live = result.upcoming?.isLive
        setIsLiveGame(!!live)
        liveGameIdRef.current = live ? (result.upcomingEventId ?? null) : null
      } catch (e) { console.error('[schedule poll]', e) }
    }, 300000)
    return () => clearInterval(id)
  }, [team?.id])

  // Live box score poll every 15s when a game is in progress
  useEffect(() => {
    if (!team || !isLiveGame || !liveGameIdRef.current) return
    const eventId = liveGameIdRef.current
    const t = team

    async function fetchLiveBoxScore() {
      if (document.hidden) return // background tab
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
      } catch (e) { console.error('[live box score poll]', e) }
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
        setBoxScoreData(res?.boxScore ?? null)
        setBoxScoreLoading(false)
      })
      .catch((e) => { console.error('[box score fetch]', e); setBoxScoreLoading(false) })
  }, [selectedGameId, team?.id])

  if (!team || !config) {
    return (
      <div className="min-h-screen fs-page">
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h1 className="fs-title text-2xl text-fs-muted mb-4">Team not found</h1>
            <Link href={`/${sport}`} className="hover-lift fs-meta hover:text-fs-text" style={{ '--card-color': 'rgba(255,255,255,0.3)' } as React.CSSProperties}>&larr; Back to League</Link>
          </div>
        </div>
      </div>
    )
  }

  const logoUrl = getTeamLogoUrl(getEspnAbbr(team.id, team.abbreviation), team.sport)

  return (
    <div className="min-h-screen fs-page" style={{ '--glow': `${team.colors.primary}1c` } as React.CSSProperties}>
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10">
        <Link href={`/${sport}`} className="hover-lift fs-meta hover:text-fs-text inline-block mb-8" style={{ '--card-color': team.colors.primary } as React.CSSProperties}>&larr; {config.name}</Link>

        <div className="hidden md:grid md:grid-cols-12 gap-5 mb-5 items-stretch">
            <div className={`md:col-span-7 min-w-0 fs-panel p-5 sm:p-6 ${data?.upcoming?.eventId ? 'hover-card cursor-pointer group' : ''}`}
              style={{ '--tint': team.colors.primary, '--tint-border': `${team.colors.primary}26`, '--card-color': team.colors.primary } as React.CSSProperties}
              onClick={() => {
                if (!data?.upcoming?.eventId && !data?.spotlightEventId) return
                if (data.upcoming?.eventId) {
                  if (data.upcoming.isLive) {
                    // Toggle: open the live box score, or close it back to the main page.
                    const liveId = data.upcoming.eventId
                    setShowNextGame(false)
                    setSelectedGameId((cur) => (cur === liveId ? null : (liveId as string)))
                  } else {
                    // Upcoming game: open the preview panel (odds + prop model).
                    setSelectedGameId(null)
                    setShowNextGame((v) => !v)
                  }
                } else {
                  // Spotlight-only card (no upcoming game in the feed) — open its box score
                  const sid = data.spotlightEventId ?? null
                  setShowNextGame(false)
                  setSelectedGameId((cur) => (cur === sid ? null : sid))
                }
              }}>
              <h2 className="fs-eyebrow mb-4" style={{ '--tint': team.colors.primary } as React.CSSProperties}>{data?.upcoming?.isLive ? 'Live' : data?.spotlightEvent && !data?.upcoming ? 'This Week' : 'Next Game'}</h2>
              {loading ? (
                <div className="animate-pulse space-y-3">
                  <div className="fs-skeleton h-7 w-3/4" />
                  <div className="fs-skeleton h-4 w-1/2" />
                </div>
              ) : data?.spotlightEvent && !data?.upcoming ? (
                <div className="animate-fade-in-up">
                  {(() => {
                    const e = data.spotlightEvent!
                    const abbr = getEspnAbbr(team.id, team.abbreviation)
                    const opp = getOpponent(e, abbr, team.sport)
                    const status = e.competitions?.[0]?.status?.type
                    const comp = e.competitions?.[0]
                    const teamComp = comp?.competitors?.find(c => c.team.abbreviation === abbr)
                    const oppComp = comp?.competitors?.find(c => c.team.abbreviation !== abbr)
                    const disp = (s: any): string => (s == null ? '' : (typeof s === 'object' ? (s.displayValue ?? '') : String(s)))
                    const ourScore = disp(teamComp?.score)
                    const oppScore = disp(oppComp?.score)
                    const weekText = e.week?.text ?? (e.seasonType?.type === 1 ? 'Preseason' : e.seasonType?.type === 2 ? 'Regular Season' : e.seasonType?.type === 3 ? 'Postseason' : '')
                    return (
                      <>
                        <div className="flex items-center gap-3 mb-2">
                          {opp.logo && (
                            <img src={opp.logo} alt="" className="w-7 h-7 object-contain" />
                          )}
                          <p className="text-xl font-medium text-fs-text">
                            {opp.location === 'home' ? 'vs' : '@'} {opp.name}
                          </p>
                        </div>
                        <div className="mt-1">
                          <p className="text-sm text-fs-muted">{getGameDetail(e)}</p>
                          <div className="flex items-center gap-3 mt-2">
                            {ourScore && oppScore ? (
                              <span className="text-2xl font-bold font-mono text-fs-text tabular-nums">{ourScore} — {oppScore}</span>
                            ) : (
                              <p className="text-sm text-fs-muted-2">Final</p>
                            )}
                            <span className="text-xs font-medium text-fs-gold bg-fs-gold/10 px-2 py-0.5 rounded">{weekText}</span>
                          </div>
                        </div>
                      </>
                    )
                  })()}
                </div>
              ) : data?.upcoming ? (
                <div className="animate-fade-in-up">
                  <div className="flex items-center gap-3 mb-2">
                    {data.upcoming.opponentLogo && (
                      <img src={data.upcoming.opponentLogo} alt="" className="w-7 h-7 object-contain" />
                    )}
                    <p className="text-xl font-medium text-fs-text">
                      {data.upcoming.location === 'home' ? 'vs' : '@'} {data.upcoming.opponent}
                    </p>
                  </div>
                  {data.upcoming.isLive ? (
                    <div className="mt-1">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold tracking-wider bg-fs-red/15 text-fs-red">
                          <span className="w-1.5 h-1.5 rounded-full bg-fs-red animate-pulse" />
                          LIVE
                        </span>
                        <span className="text-xs sm:text-sm text-fs-muted">{data.upcoming.statusDetail ?? 'Starting soon'}</span>
                      </div>
                      {data.upcoming.awayScore != null && data.upcoming.homeScore != null ? (
                        <div className="flex items-center gap-5 mt-1">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-medium text-fs-muted w-8 text-right">{data.upcoming.awayAbbr ?? 'Away'}</span>
                            <span className="text-2xl font-bold font-mono text-fs-text min-w-[3ch] text-right tabular-nums">{data.upcoming.awayScore}</span>
                          </div>
                          <span className="text-lg text-fs-muted-2">-</span>
                          <div className="flex items-center gap-3">
                            <span className="text-2xl font-bold font-mono text-fs-text min-w-[3ch] text-right tabular-nums">{data.upcoming.homeScore}</span>
                            <span className="text-xs font-medium text-fs-muted w-8 text-left">{data.upcoming.homeAbbr ?? 'Home'}</span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-fs-muted-2 mt-1 animate-pulse">Score data loading...</p>
                      )}
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-fs-muted mt-1">{data.upcoming.date}</p>
                      <p className="text-xs text-fs-muted-2 mt-0.5">{data.upcoming.location === 'home' ? 'Home' : 'Away'}{data.upcoming.venue ? ` · ${data.upcoming.venue}` : ''}</p>
                    </>
                  )}
                  {data.upcoming.seasonTypeName && <span className="inline-block mt-2 px-2 py-0.5 text-xs font-medium bg-fs-gold/10 text-fs-gold rounded">{data.upcoming.seasonTypeName}</span>}
                  {data.oddsInfo ? (
                    <div className="mt-5 pt-4 space-y-3" style={{ borderTop: `1px solid ${team.colors.primary}20` }}>
                      <div className="grid md:grid-cols-2 gap-x-5 gap-y-3">
                      <div className="flex items-center justify-between text-sm gap-3">
                        <span className="text-fs-muted truncate">
                          <span className="text-fs-text font-medium">{data.oddsInfo.our.abbr}</span>
                          {data.oddsInfo.our.isFavorite
                            ? <span className="text-fs-turf ml-1">(Favorite)</span>
                            : data.oddsInfo.opponent.isFavorite
                              ? <span className="text-fs-red ml-1">(Underdog)</span>
                              : <span className="text-fs-muted-2 ml-1">(Even)</span>
                          }
                        </span>
                        <span className="font-mono text-fs-text shrink-0">{data.oddsInfo.our.moneyline > 0 ? '+' : ''}{data.oddsInfo.our.moneyline}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm gap-3">
                        <span className="text-fs-muted truncate">
                          <span className="text-fs-text font-medium">{data.oddsInfo.opponent.abbr}</span>
                          {data.oddsInfo.opponent.isFavorite
                            ? <span className="text-fs-turf ml-1">(Favorite)</span>
                            : data.oddsInfo.our.isFavorite
                              ? <span className="text-fs-red ml-1">(Underdog)</span>
                              : <span className="text-fs-muted-2 ml-1">(Even)</span>
                          }
                        </span>
                        <span className="font-mono text-fs-text shrink-0">{data.oddsInfo.opponent.moneyline > 0 ? '+' : ''}{data.oddsInfo.opponent.moneyline}</span>
                      </div>
                      </div>
                      {(data.oddsInfo.spread != null || data.oddsInfo.overUnder != null) && (
                        <div className="flex items-center gap-4 text-sm pt-1">
                          {data.oddsInfo.spread != null && (
                            <span className="text-fs-muted">
                              Spread <span className="font-mono text-fs-text">{data.oddsInfo.spread > 0 ? '+' : ''}{data.oddsInfo.spread}</span>
                            </span>
                          )}
                          {data.oddsInfo.overUnder != null && (
                            <span className="text-fs-muted">
                              O/U <span className="font-mono text-fs-text">{data.oddsInfo.overUnder}</span>
                            </span>
                          )}
                        </div>
                      )}
                      <div className="pt-2">
                        <p className="text-xs text-fs-muted mb-2">Implied Probability (vig-free)</p>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 rounded-full" style={{ backgroundColor: `${team.colors.primary}22` }}>
                            <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${data.oddsInfo.our.prob}%`, backgroundColor: team.colors.primary }} />
                          </div>
                          <span className="text-sm font-medium text-fs-text w-10 text-right">{data.oddsInfo.our.prob}%</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-fs-muted-2 pt-1">
                        <span>{data.oddsInfo.sportsbook}</span>
                        <span>Updated {new Date(data.oddsInfo.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${team.colors.primary}20` }}>
                      <p className="text-sm text-fs-muted-2">Odds not yet available</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-fs-muted-2 animate-fade-in">{sport === 'nfl' ? 'Season starts September' : sport === 'nba' || sport === 'nhl' ? 'Season starts October' : 'Season in progress'}</p>
              )}
            </div>

            <div className="md:col-span-5 min-w-0 hover-card fs-panel p-6 flex items-center gap-5 cursor-pointer group" style={{ '--tint': team.colors.primary, '--tint-border': `${team.colors.primary}24`, '--card-color': team.colors.primary } as React.CSSProperties}
              onClick={() => setShowRoster((v) => !v)}>
              <div className="w-20 h-20 flex items-center justify-center shrink-0 relative">
                {logoFailed ? (
                  <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ backgroundColor: team.colors.primary }}>
                    <span className="text-2xl font-bold" style={{ color: team.colors.secondary }}>{team.abbreviation}</span>
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
              <div className="min-w-0">
                <h1 className="fs-title text-3xl text-fs-text truncate">{team.name}</h1>
                <p className="fs-meta mt-1.5">{team.conference} &middot; {team.division}</p>
              </div>
            </div>
          </div>

        {showRoster ? (
          <RosterPanel
            team={team}
            roster={rosterData}
            loading={rosterLoading}
            onBack={() => setShowRoster(false)}
          />
        ) : showNextGame && data?.upcoming?.eventId ? (
          <NextGamePanel
            sport={team.sport}
            teamAbbr={getEspnAbbr(team.id, team.abbreviation)}
            opponentAbbr={data.upcoming.opponentAbbr ?? ''}
            teamFantasyAbbr={team.abbreviation}
            opponentFantasyAbbr={getOpponentFantasyAbbr(data.upcoming.opponentAbbr ?? '', data.upcoming.opponent, team.sport)}
            eventId={data.upcoming.eventId}
            eventDate={data.upcoming.eventDate}
            teamColor={team.colors.primary}
            teamName={team.name}
            opponentName={data.upcoming.opponent}
            odds={data.oddsInfo}
            isPreseason={data.upcoming.isPreseason}
            onBack={() => setShowNextGame(false)}
            scraperLoading={scraperLoading}
            scraperData={scraperData}
            scraperError={scraperError}
            isLive={isLiveGame}
            liveBoxScore={liveBoxScore}
          />
        ) : selectedGameId ? (
          <>
            {!(isLiveGame && selectedGameId === liveGameIdRef.current && data?.upcoming?.eventId === selectedGameId) && (
              <div className="mb-5">
                <LastFiveTiles
                  games={data?.lastFive ?? []}
                  selectedId={selectedGameId}
                  onSelect={(id) => setSelectedGameId(id === selectedGameId ? null : id)}
                  teamColor={team.colors.primary}
                  standing={data?.teamStanding}
                  loading={loading}
                />
              </div>
            )}
            <BoxScorePanel
              data={boxScoreData}
              loading={boxScoreLoading}
              teamAbbr={getEspnAbbr(team.id, team.abbreviation)}
              teamColor={team.colors.primary}
              sport={team.sport}
              isLive={isLiveGame && selectedGameId === liveGameIdRef.current}
              onBack={() => { setSelectedGameId(null); setBoxScoreData(null) }}
            />
            {/* Model vs Live: the frozen pre-game prop snapshot against the live
                box score (one live point saved per quarter for engine tuning). */}
            {team.sport.toUpperCase() === 'NFL' && isLiveGame
              && selectedGameId === liveGameIdRef.current
              && data?.upcoming?.eventId === selectedGameId ? (
              <NextGamePanel
                sport={team.sport}
                teamAbbr={getEspnAbbr(team.id, team.abbreviation)}
                opponentAbbr={data.upcoming.opponentAbbr ?? ''}
                teamFantasyAbbr={team.abbreviation}
                opponentFantasyAbbr={getOpponentFantasyAbbr(data.upcoming.opponentAbbr ?? '', data.upcoming.opponent, team.sport)}
                eventId={data.upcoming.eventId}
                eventDate={data.upcoming.eventDate}
                teamColor={team.colors.primary}
                teamName={team.name}
                opponentName={data.upcoming.opponent}
                odds={data.oddsInfo}
                isPreseason={data.upcoming.isPreseason}
                onBack={() => {}}
                scraperLoading={scraperLoading}
                scraperData={scraperData}
                scraperError={scraperError}
                isLive
                liveBoxScore={liveBoxScore}
                compact
              />
            ) : null}
          </>
        ) : (
          <>
            <div className="mb-5 hidden md:block">
              <LastFiveTiles
                games={data?.lastFive ?? []}
                selectedId={selectedGameId}
                onSelect={(id) => setSelectedGameId(id === selectedGameId ? null : id)}
                teamColor={team.colors.primary}
                standing={data?.teamStanding}
                loading={loading}
              />
            </div>

            <div className="hidden md:grid md:grid-cols-12 gap-5 items-start">
              <div className="md:col-span-4 min-w-0">
              <StandingsBox
                standings={data?.standings ?? []}
                teamId={team.id}
                teamAbbr={team.abbreviation}
                teamConference={team.conference}
                teamColor={team.colors.primary}
                sport={sport}
                loading={loading}
                standingsMessage={data?.standingsMessage}
              />
              </div>

              <div className="md:col-span-4 min-w-0 fs-panel p-6 flex flex-col" style={{ '--tint': team.colors.primary, '--tint-border': `${team.colors.primary}20` } as React.CSSProperties}>
                <h2 className="fs-eyebrow mb-4" style={{ '--tint': team.colors.primary } as React.CSSProperties}>Latest News</h2>
                {loading ? (
                  <div className="animate-pulse space-y-4 flex-1">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="space-y-2">
                        <div className="fs-skeleton h-4 w-3/4" />
                        <div className="fs-skeleton h-3 w-full" />
                      </div>
                    ))}
                  </div>
                ) : data?.news.length ? (
                  <div className="space-y-3 animate-fade-in-up flex-1 flex flex-col justify-center" style={{ animationDelay: '150ms' }}>
                    {data.news.map((item, i) => (
                      <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                         className="hover-bright block rounded-lg p-3.5" style={{ backgroundColor: `${team.colors.primary}0c`, border: `1px solid ${team.colors.primary}10`, '--card-color': team.colors.primary } as React.CSSProperties}>
                        <h3 className="text-sm font-medium text-fs-text/85 leading-snug mb-1.5 line-clamp-2">{item.title}</h3>
                        {item.snippet ? (
                          <p className="text-xs mb-2 line-clamp-2 text-fs-muted">{item.snippet}</p>
                        ) : null}
                        <div className="flex items-center gap-2 text-xs text-fs-muted-2 fs-mono">
                          <span>{item.source}</span>
                          <span className="text-fs-muted-2/70">&middot;</span>
                          <span>{item.date}</span>
                        </div>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-fs-muted animate-fade-in flex-1 flex items-center justify-center">No news available</p>
                )}
              </div>

              {team && (
                <div className="md:col-span-4 min-w-0">
                  <FantasyWidget sport={team.sport} teamAbbr={team.abbreviation} teamColor={team.colors.primary} />
                </div>
              )}
            </div>

            {/* Dedicated mobile layout: compact horizontal strips, snap rows */}
            <div className="md:hidden space-y-4">
              <div className="fs-panel p-4 flex items-center gap-3 animate-fade-in-up" style={{ '--tint': team.colors.primary, '--tint-border': `${team.colors.primary}20` } as React.CSSProperties}>
                {logoFailed ? (
                  <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: team.colors.primary }}>
                    <span className="text-sm font-bold" style={{ color: team.colors.secondary }}>{team.abbreviation}</span>
                  </div>
                ) : (
                  <img src={logoUrl} alt={team.name} className="w-12 h-12 object-contain shrink-0" onError={() => setLogoFailed(true)} />
                )}
                <div className="min-w-0 flex-1">
                  <h1 className="text-lg font-semibold text-fs-text truncate">{team.name}</h1>
                  <p className="fs-meta truncate">{team.conference} &middot; {team.division}{data?.teamStanding ? ` · ${data.teamStanding}` : ''}</p>
                </div>
                <button onClick={() => setShowRoster((v) => !v)}
                  className="hover-bright text-xs font-semibold px-3.5 py-2 rounded-full shrink-0"
                  style={{ backgroundColor: `${team.colors.primary}18`, border: `1px solid ${team.colors.primary}30`, '--card-color': team.colors.primary } as React.CSSProperties}>
                  Roster
                </button>
              </div>

              {data?.upcoming ? (
                <div className={`fs-panel p-4 ${data.upcoming.eventId ? 'hover-card cursor-pointer' : ''}`}
                  style={{ '--tint': team.colors.primary, '--tint-border': `${team.colors.primary}20`, '--card-color': team.colors.primary } as React.CSSProperties}
                  onClick={() => {
                    if (!data?.upcoming?.eventId) return
                    if (data.upcoming.isLive) {
                      setShowNextGame(false)
                      const liveId = data.upcoming.eventId
                      setSelectedGameId((cur) => (cur === liveId ? null : (liveId as string)))
                    } else {
                      setSelectedGameId(null)
                      setShowNextGame((v) => !v)
                    }
                  }}>
                  <div className="flex items-center gap-3 min-w-0">
                    {data.upcoming.opponentLogo && (
                      <img src={data.upcoming.opponentLogo} alt="" className="w-10 h-10 object-contain shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fs-text truncate">
                        {data.upcoming.location === 'home' ? 'vs' : '@'} {data.upcoming.opponent}
                      </p>
                      <p className="text-xs text-fs-muted-2 truncate">{data.upcoming.date}{data.upcoming.venue ? ` · ${data.upcoming.venue}` : ''}</p>
                    </div>
                    {data.upcoming.isLive && data.upcoming.awayScore != null && data.upcoming.homeScore != null ? (
                      <span className="font-mono font-bold text-fs-text tabular-nums shrink-0">{data.upcoming.awayScore}-{data.upcoming.homeScore}</span>
                    ) : (
                      <span className="text-fs-muted-2 shrink-0">&rsaquo;</span>
                    )}
                  </div>
                  {data.oddsInfo && (data.oddsInfo.spread != null || data.oddsInfo.overUnder != null) && (
                    <div className="flex items-center gap-2 mt-3 overflow-x-auto">
                      {data.oddsInfo.spread != null && (
                        <span className="text-xs font-mono px-2.5 py-1 rounded-full whitespace-nowrap" style={{ backgroundColor: `${team.colors.primary}12`, border: `1px solid ${team.colors.primary}20` }}>
                          Spread {data.oddsInfo.spread > 0 ? '+' : ''}{data.oddsInfo.spread}
                        </span>
                      )}
                      {data.oddsInfo.overUnder != null && (
                        <span className="text-xs font-mono px-2.5 py-1 rounded-full whitespace-nowrap" style={{ backgroundColor: `${team.colors.primary}12`, border: `1px solid ${team.colors.primary}20` }}>
                          O/U {data.oddsInfo.overUnder}
                        </span>
                      )}
                      <span className="text-xs font-mono px-2.5 py-1 rounded-full whitespace-nowrap" style={{ backgroundColor: `${team.colors.primary}12`, border: `1px solid ${team.colors.primary}20` }}>
                        {data.oddsInfo.our.abbr} {data.oddsInfo.our.moneyline > 0 ? '+' : ''}{data.oddsInfo.our.moneyline}
                      </span>
                      {scraperLoading ? (
                        <span className="text-xs text-fs-muted-2 whitespace-nowrap">Scraping props…</span>
                      ) : (scraperData?.totalProps ?? 0) > 0 ? (
                        <span className="text-xs text-fs-turf whitespace-nowrap">✓ {scraperData.totalProps} props</span>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}

              <div>
                <div className="flex items-center justify-between mb-2 px-1">
                  <h2 className="fs-eyebrow" style={{ '--tint': team.colors.primary } as React.CSSProperties}>Last 5 Games</h2>
                  {data?.teamStanding && <span className="fs-meta">{data.teamStanding}</span>}
                </div>
                {loading ? (
                  <div className="flex gap-2 overflow-hidden">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="fs-skeleton h-14 min-w-[10rem] flex-1" />
                    ))}
                  </div>
                ) : data?.lastFive.length ? (
                  <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-1 -mx-4 px-4">
                    {data.lastFive.map((game) => (
                      <div key={game.eventId} className="rounded-lg px-3 py-2.5 flex items-center gap-2.5 cursor-pointer snap-start min-w-[10.5rem] flex-1" style={{ backgroundColor: `${team.colors.primary}0d`, border: `1px solid ${game.eventId === selectedGameId ? team.colors.primary : `${team.colors.primary}18`}` } as React.CSSProperties}
                        onClick={() => setSelectedGameId(game.eventId === selectedGameId ? null : game.eventId)}>
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium shrink-0 ${
                          game.result === 'W' ? 'text-fs-turf' : 'text-fs-red'
                        }`} style={{ backgroundColor: game.result === 'W' ? 'rgba(139,197,63,0.15)' : 'rgba(232,93,76,0.15)' }}>
                          {game.result}
                        </span>
                        {game.opponentLogo && (
                          <img src={game.opponentLogo} alt="" className="w-6 h-6 object-contain shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-fs-text/85 truncate">{game.opponentAbbr || game.opponent}</p>
                          <p className="text-xs text-fs-muted tabular-nums">{game.score}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-fs-muted">No recent games</p>
                )}
              </div>

              <StandingsBox
                standings={data?.standings ?? []}
                teamId={team.id}
                teamAbbr={team.abbreviation}
                teamConference={team.conference}
                teamColor={team.colors.primary}
                sport={sport}
                loading={loading}
                standingsMessage={data?.standingsMessage}
              />

              <div className="fs-panel p-4" style={{ '--tint': team.colors.primary, '--tint-border': `${team.colors.primary}20` } as React.CSSProperties}>
                <h2 className="fs-eyebrow mb-3" style={{ '--tint': team.colors.primary } as React.CSSProperties}>Latest News</h2>
                {loading ? (
                  <div className="animate-pulse space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="fs-skeleton h-4 w-3/4" />
                    ))}
                  </div>
                ) : data?.news.length ? (
                  <div className="divide-y" style={{ borderColor: `${team.colors.primary}14` }}>
                    {data.news.slice(0, 5).map((item, i) => (
                      <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 py-2.5 min-w-0">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-fs-text/85 leading-snug line-clamp-2">{item.title}</p>
                          <p className="text-[11px] text-fs-muted-2 mt-0.5">{item.source} · {item.date}</p>
                        </div>
                        <span className="text-fs-muted-2 shrink-0">&rsaquo;</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-fs-muted">No news available</p>
                )}
              </div>

              {!loading && team && (
                <FantasyWidget sport={team.sport} teamAbbr={team.abbreviation} teamColor={team.colors.primary} />
              )}
            </div>
          </>
        )}

        <AiNalyst
          sport={team.sport}
          teamId={team.id}
          teamAbbreviation={team.abbreviation}
          teamColor={team.colors.primary}
          pageType={selectedGameId && !isLiveGame ? 'past-game' : 'team'}
          eventId={selectedGameId && !isLiveGame ? selectedGameId : undefined}
        />
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

function prettifyName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()
}

function BoxScorePanel({ data, loading, teamAbbr, teamColor, sport, isLive, onBack }: { data: any; loading: boolean; teamAbbr: string; teamColor: string; sport: string; isLive?: boolean; onBack: () => void }) {
  const [showPlayerStats, setShowPlayerStats] = useState(false)

  const bsTeams: any[] = data?.teams ?? []
  // Head-to-head order is always away (left) vs home (right), regardless of
  // which side is "our" team. Fall back to index order when homeAway is absent.
  const awayTeam = bsTeams.find((t: any) => t.homeAway === 'away')
    ?? (bsTeams[0]?.homeAway === 'home' ? bsTeams[1] : bsTeams[0])
    ?? null
  const homeTeam = bsTeams.find((t: any) => t.homeAway === 'home')
    ?? (awayTeam === bsTeams[0] ? bsTeams[1] : bsTeams[0])
    ?? null
  const maxPeriods = Math.max(awayTeam?.linescores?.length ?? 0, homeTeam?.linescores?.length ?? 0)

  const sortedPlayerStats = useMemo(() =>
    [...(data?.playerStats ?? [])].sort((a, b) => {
      if (a.teamAbbr === teamAbbr) return -1
      if (b.teamAbbr === teamAbbr) return 1
      return 0
    }),
    [data?.playerStats, teamAbbr],
  )

  const hasAnyPlayerStats = sortedPlayerStats.some((t: any) => t.categories?.some((c: any) => c.athletes?.length > 0))



  return (
    <div className="animate-fade-in-up mt-4 pt-3" style={{ borderTop: `1px solid ${teamColor}20` }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="fs-eyebrow" style={{ '--tint': teamColor } as React.CSSProperties}>Box Score</h3>
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="inline-flex items-center gap-1.5 text-xs text-fs-red font-medium mr-1">
              <span className="relative flex w-2 h-2">
                <span className="absolute w-full h-full rounded-full bg-fs-red animate-ping opacity-75" />
                <span className="relative w-2 h-2 rounded-full bg-fs-red" />
              </span>
              LIVE · updating
            </span>
          )}
          <button onClick={() => setShowPlayerStats((v) => !v)}
            className="hover-bright text-xs px-2 py-1 rounded text-fs-muted hover:text-fs-text"
            style={{ backgroundColor: `${teamColor}15`, border: `1px solid ${teamColor}25`, '--card-color': teamColor } as React.CSSProperties}>
            {showPlayerStats ? 'Team Stats' : 'Player Stats'}
          </button>
          <button onClick={onBack}
            className="hover-bright text-xs px-2 py-1 rounded text-fs-muted hover:text-fs-text"
            style={{ backgroundColor: `${teamColor}15`, border: `1px solid ${teamColor}25`, '--card-color': teamColor } as React.CSSProperties}>
            &larr; Back
          </button>
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse"><div className="fs-skeleton h-20" /></div>
      ) : !data?.teams?.length ? (
        <p className="text-sm text-fs-muted">Box score unavailable</p>
      ) : (
        <>
          {/* Team stats (default view): head-to-head comparison, away left / home right */}
          {!showPlayerStats && (
            <>
              {maxPeriods > 0 && (
                <div data-testid="linescores" className="mb-4 overflow-x-auto">
                <div className="mx-auto flex w-fit min-w-full flex-col gap-1 text-[11px] tabular-nums text-fs-muted-2">
                  <div className="flex items-center justify-center gap-2 sm:gap-2.5">
                    <span className="w-8 text-right font-semibold text-fs-muted">{awayTeam?.abbreviation ?? 'Away'}</span>
                    {Array.from({ length: maxPeriods }, (_, i) => (
                      <span key={i} className="flex flex-col items-center">
                        <span className="text-[9px] uppercase tracking-wider opacity-70">{getPeriodLabels(sport)[i]}</span>
                        <span className="font-mono">{awayTeam?.linescores?.[i] ?? '-'}</span>
                      </span>
                    ))}
                    <span className="flex flex-col items-center">
                      <span className="text-[9px] uppercase tracking-wider opacity-70">T</span>
                      <span className="font-mono font-semibold text-fs-text">{awayTeam ? sum(awayTeam.linescores) : '-'}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-center gap-2 sm:gap-2.5">
                    <span className="w-8 text-right font-semibold text-fs-muted">{homeTeam?.abbreviation ?? 'Home'}</span>
                    {Array.from({ length: maxPeriods }, (_, i) => (
                      <span key={i} className="flex flex-col items-center">
                        <span className="text-[9px] uppercase tracking-wider opacity-70">{getPeriodLabels(sport)[i]}</span>
                        <span className="font-mono">{homeTeam?.linescores?.[i] ?? '-'}</span>
                      </span>
                    ))}
                    <span className="flex flex-col items-center">
                      <span className="text-[9px] uppercase tracking-wider opacity-70">T</span>
                      <span className="font-mono font-semibold text-fs-text">{homeTeam ? sum(homeTeam.linescores) : '-'}</span>
                    </span>
                  </div>
                </div>
                </div>
              )}
              {awayTeam && homeTeam ? (
                <GameStatsSection
                  away={awayTeam}
                  home={homeTeam}
                  status={data?.status ?? null}
                  sport={sport}
                  lastPlay={data?.lastPlay ?? null}
                />
              ) : (
                <p className="text-sm text-fs-muted">Team stats not yet available</p>
              )}
            </>
          )}

          {/* Player stats (toggle view) — side by side */}
          {showPlayerStats && (
            <>
              {hasAnyPlayerStats ? (
                <div className="grid md:grid-cols-2 gap-4 min-w-0">
                  {sortedPlayerStats.map((team: any, ti: number) => {
                    const isOurTeam = team.teamAbbr === teamAbbr
                    const athleteCount = team.categories.reduce((n: number, c: any) => n + (c.athletes?.length ?? 0), 0)
                    return (
                      <div key={team.teamAbbr || ti} className="min-w-0">
                        <div className="flex items-baseline justify-between gap-2 mb-2">
                          <p className="text-sm font-semibold tracking-wider uppercase" style={{ color: isOurTeam ? teamColor : undefined, opacity: isOurTeam ? 1 : 0.7 }}>
                            {team.teamAbbr}
                          </p>
                          <span className="fs-meta shrink-0">{athleteCount} players</span>
                        </div>
                        {team.categories.map((cat: any, ci: number) => (
                          <div key={ci} className="mb-3 rounded-lg overflow-hidden" style={{ border: `1px solid ${teamColor}16` }}>
                            <div className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-fs-muted-2" style={{ backgroundColor: `${teamColor}0a` }}>
                              {cat.label}
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-fs-muted-2">
                                    <th className="text-left px-2.5 py-1.5 font-medium">Player</th>
                                    {cat.statNames.map((n: string, ni: number) => (
                                      <th key={ni} className="text-right px-2 py-1.5 font-medium tabular-nums">{playerStatLabels[n] ?? prettifyName(n)}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {cat.athletes.map((a: any, i: number) => (
                                    <tr key={a.id || `ath-${i}`} className="text-fs-text/75" style={{ borderTop: `1px solid ${teamColor}0c` }}>
                                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                                        <span className="font-mono text-fs-muted-2 mr-1.5">{a.jersey ?? ''}</span>
                                        <span className="text-sm font-medium text-fs-text/90">{a.displayName}</span>
                                        {a.position ? <span className="text-fs-muted-2 ml-1 text-xs">{a.position}</span> : ''}
                                      </td>
                                      {cat.statNames.map((n: string, ni: number) => (
                                        <td key={ni} className="px-2 py-1.5 text-right font-mono tabular-nums text-[13px]">{a.stats?.[n] ?? <span className="text-fs-muted-2">—</span>}</td>
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
                <p className="text-sm text-fs-muted">Player stats not yet available</p>
              )}
            </>
          )}

          {showPlayerStats && data?.status && (
            <p className="text-xs text-fs-muted-2 mt-1">{data.status.shortDetail ?? data.status.description}</p>
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

function processScheduleForState(schedule: { upcoming: EspnEvent | null; lastFive: EspnEvent[]; spotlightEventId?: string | null }, espnAbbr: string, sport: string) {
  const lastFive = schedule.lastFive.map((e) => {
    const opp = getOpponent(e, espnAbbr, sport)
    return {
      date: getShortDate(e),
      opponent: opp.name,
      opponentAbbr: opp.abbr,
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
  let spotlightEventId: string | null = schedule.spotlightEventId ?? null
  let spotlightEvent: EspnEvent | null = null

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
      // ESPN score shape varies: plain string ("0") vs { displayValue }.
      const normScore = (s: any): string | undefined =>
        s == null || s === '' ? undefined : (typeof s === 'object' ? (s.displayValue ?? undefined) : String(s))
      homeScore = normScore(home?.score)
      awayScore = normScore(away?.score)
      homeAbbr = home?.team?.abbreviation
      awayAbbr = away?.team?.abbreviation
    }

    const upcomingDateIso = schedule.upcoming.date
    upcoming = {
      date: isLive ? (status?.detail ?? status?.shortDetail) : getGameDetail(schedule.upcoming),
      opponent: opp.name,
      opponentAbbr: opp.abbr,
      opponentLogo: opp.logo,
      location: opp.location,
      venue,
      isPreseason: schedule.upcoming.seasonType?.type === 1 || schedule.upcoming.season?.type === 1,
      isLive,
      eventId: schedule.upcoming.id,
      eventDate: upcomingDateIso ? upcomingDateIso.slice(0, 10).replace(/-/g, '') : undefined,
      kickoff: upcomingDateIso,
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

  // Spotlight event: a completed game from the current week that should stay
  // featured until the week turns over (NFL only).
  if (spotlightEventId && sport.toUpperCase() === 'NFL') {
    const allGames = [schedule.upcoming, ...schedule.lastFive]
    spotlightEvent = allGames.find((e) => e?.id === spotlightEventId) ?? null
  }

  return { lastFive, upcoming, upcomingEventId, upcomingDate, spotlightEvent, spotlightEventId }
}

function checkRookie(athlete: any): boolean {
  const exp = athlete?.experience
  if (!exp) return true
  if (typeof exp.years === 'number' && exp.years <= 0) return true
  if (String(exp.displayValue ?? '').toUpperCase() === 'R') return true
  if (String(exp.abbreviation ?? '').toUpperCase() === 'R') return true
  return false
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

interface LastFiveGame {
  date: string
  opponent: string
  opponentAbbr: string
  opponentLogo: string
  result: 'W' | 'L'
  score: string
  eventId: string
  isPreseason?: boolean
  seasonTypeName?: string
}

// Horizontal result tiles with dynamic resizing: snap-scroll row on mobile,
// equal-width 5-col grid on desktop. One component for every usage so the
// mobile and desktop layouts never drift apart.
function LastFiveTiles({ games, selectedId, onSelect, teamColor, standing, loading }: {
  games: LastFiveGame[]
  selectedId: string | null
  onSelect: (id: string) => void
  teamColor: string
  standing?: string
  loading: boolean
}) {
  return (
    <div className="fs-panel p-4 sm:p-5" style={{ '--tint': teamColor, '--tint-border': `${teamColor}20` } as React.CSSProperties}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="fs-eyebrow" style={{ '--tint': teamColor } as React.CSSProperties}>Last 5 Games</h2>
        {standing && <span className="fs-meta">{standing}</span>}
      </div>
      {loading ? (
        <div className="flex md:grid md:grid-cols-5 gap-2 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="fs-skeleton h-14 min-w-[10rem] md:min-w-0 flex-1" />
          ))}
        </div>
      ) : games.length ? (
        <div className="flex md:grid md:grid-cols-5 gap-2 overflow-x-auto md:overflow-visible snap-x snap-mandatory md:snap-none pb-1 md:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0 animate-fade-in-up" style={{ animationDelay: '50ms' }}>
          {games.map((game) => (
            <div key={game.eventId} className="hover-card rounded-lg px-3 py-2.5 flex items-center gap-2.5 text-left cursor-pointer snap-start min-w-[11rem] md:min-w-0 flex-1" style={{ backgroundColor: `${teamColor}0d`, border: `1px solid ${game.eventId === selectedId ? teamColor : `${teamColor}18`}`, '--card-color': teamColor } as React.CSSProperties}
              onClick={() => onSelect(game.eventId)}>
              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium shrink-0 ${
                game.result === 'W' ? 'text-fs-turf' : 'text-fs-red'
              }`} style={{ backgroundColor: game.result === 'W' ? 'rgba(139,197,63,0.15)' : 'rgba(232,93,76,0.15)' }}>
                {game.result}
              </span>
              {game.opponentLogo && (
                <img src={game.opponentLogo} alt="" className="w-6 h-6 object-contain shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-fs-text/85 truncate">
                  <span className="sm:hidden">{game.opponentAbbr || game.opponent}</span>
                  <span className="hidden sm:inline">{game.opponent}</span>
                </p>
                <p className="text-xs text-fs-muted tabular-nums">{game.score} <span className="text-fs-muted-2">· {game.date}</span></p>
              </div>
              {game.isPreseason
                ? <span className="text-[11px] text-fs-gold/80 shrink-0">Pre</span>
                : game.seasonTypeName
                  ? <span className="text-[11px] text-fs-gold/80 shrink-0">{game.seasonTypeName === 'Preseason' ? 'Pre' : game.seasonTypeName}</span>
                  : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-fs-muted animate-fade-in">No recent games</p>
      )}
    </div>
  )
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
      <div className="fs-panel p-6 overflow-hidden" style={{ '--tint': team.colors.primary, '--tint-border': `${team.colors.primary}20` } as React.CSSProperties}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="fs-eyebrow" style={{ '--tint': team.colors.primary } as React.CSSProperties}>Roster</h2>
          <button onClick={onBack}
            className="hover-bright text-xs px-3 py-1.5 rounded-full text-fs-muted hover:text-fs-text"
            style={{ backgroundColor: `${team.colors.primary}15`, border: `1px solid ${team.colors.primary}25`, '--card-color': team.colors.primary } as React.CSSProperties}>
            &larr; Dashboard
          </button>
        </div>

        {loading ? (
          <div className="animate-pulse space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="fs-skeleton h-4 w-16" />
                {[...Array(3)].map((_, j) => (
                  <div key={j} className="fs-skeleton h-7" />
                ))}
              </div>
            ))}
          </div>
        ) : !roster || sortedPositions.length === 0 ? (
          <p className="text-sm text-fs-muted">Roster unavailable</p>
        ) : (
          <div className="space-y-5">
            {sortedPositions.map((abbr, pi) => {
              const posName = groups[abbr][0]?.position?.name ?? abbr
              const stats = groups[abbr]
              return (
                <div key={abbr || `pos-${pi}`}>
                  <p className="fs-meta mb-2">{posName} <span className="text-fs-muted-2/60">({abbr})</span></p>
                  <div className="space-y-0.5">
                    {stats.map((athlete: any, ai) => {
                      const rookie = checkRookie(athlete)
                      const hasStats = athlete.seasonStats
                      const isNfl = team.sport === 'NFL'
                      const nflRendered = isNfl && hasStats ? renderNflStats(athlete.seasonStats, athlete.position?.abbreviation ?? '') : null
                      const nflSchema = nflRendered?.schema
                      const nflValues = nflRendered?.values
                      return (
                        <div key={athlete.id ?? `athlete-${pi}-${ai}`} className="flex items-center gap-2 sm:gap-3 rounded-lg px-2 sm:px-3 py-1.5 overflow-x-auto" style={{ backgroundColor: rookie ? `${team.colors.primary}12` : 'transparent' }}>
                          <span className="text-xs w-5 sm:w-6 text-right font-mono text-fs-muted-2 flex-shrink-0">{athlete.jersey}</span>
                          <span className="text-xs sm:text-sm flex-shrink-0 text-fs-text/85 whitespace-nowrap">{athlete.fullName ?? `${athlete.firstName ?? ''} ${athlete.lastName ?? ''}`}</span>
                          {nflSchema && nflSchema.length > 0 && (
                            <div className="flex items-center gap-2 sm:gap-3 font-mono tabular-nums flex-shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {nflSchema.map((s, si) => (
                                <div key={s.key} className="text-right flex-shrink-0" style={{ minWidth: si < 2 ? '3.5rem' : '2.5rem' }}>
                                  <span className="text-xs text-fs-muted-2">{s.label}</span>
                                  <span className="text-xs text-fs-text/85 ml-0.5">{nflValues![si] ?? '—'}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {!isNfl && hasStats && relevantStats[team.sport] && (
                            <div className="flex items-center gap-1.5 sm:gap-2 font-mono tabular-nums flex-shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {relevantStats[team.sport].map(s => {
                                const v = athlete.seasonStats[s.key]
                                if (v === undefined || v === null) return null
                                return (
                                  <div key={s.key} className="text-right flex-shrink-0" style={{ minWidth: '2.5rem' }}>
                                    <span className="text-xs text-fs-muted-2">{s.label}</span>
                                    <span className="text-xs text-fs-text/85 ml-0.5">{v}</span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                          {!hasStats && athlete.college?.name && (
                            <span className="text-xs text-fs-muted-2 hidden lg:inline truncate max-w-20">{athlete.college.name}</span>
                          )}
                          {!hasStats && !athlete.college?.name && athlete.experience?.displayValue && (
                            <span className="text-xs text-fs-muted">{athlete.experience.displayValue}</span>
                          )}
                          {!hasStats && !athlete.college?.name && !athlete.experience?.displayValue && (
                            <span className="text-xs text-fs-muted-2">No stats yet</span>
                          )}
                          {rookie && (
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-bold" style={{ backgroundColor: `${team.colors.primary}40`, color: team.colors.secondary }}>R</span>
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

function getFallbackNews(name: string, sport: string, abbr?: string) {
  const espnSlug = abbr?.toLowerCase() ?? name.split(' ').pop()?.toLowerCase() ?? ''
  const espnUrl = `https://www.espn.com/${sport.toLowerCase()}/team/_/name/${espnSlug}`
  const now = new Date()
  const month = now.toLocaleDateString('en-US', { month: 'short' })
  const d = (n: number) => `${month} ${now.getDate() + n}`
  return [
    { title: `${name} Latest News & Updates`, source: 'ESPN', date: d(0), snippet: `Latest news, scores, and updates for ${name}.`, url: espnUrl },
    { title: `${name} Schedule & Results`, source: 'ESPN', date: d(-2), snippet: `View the full schedule and recent results for ${name}.`, url: espnUrl },
    { title: `${name} Roster & Transactions`, source: 'ESPN', date: d(-4), snippet: `Roster moves, injuries, and transactions for ${name}.`, url: espnUrl },
    { title: `${name} Standings & Playoff Race`, source: 'ESPN', date: d(-6), snippet: `Where ${name} stand in the ${sport} playoff race.`, url: `https://www.espn.com/${sport.toLowerCase()}/standings` },
  ]
}

function getFallbackData(name: string, sport: string, abbr?: string): TeamDashboardData {
  return {
    upcoming: null,
    lastFive: [],
    oddsInfo: null,
    news: getFallbackNews(name, sport, abbr),
    standings: [],
    teamStanding: '',
  }
}
