'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { teams, sportConfig } from '@/data/teams'
import NextGamePanel from '@/components/NextGamePanel'
import { getEspnAbbr } from '@/lib/sports-api'

interface GameData {
  id: string
  date: string
  name: string
  shortName: string
  season: any
  week: { number: number; text: string }
  competitions: {
    status: {
      type: {
        completed: boolean
        state: string
        description: string
        shortDetail: string
      }
      competitorStatus?: boolean
      displayClock?: number
      period?: number
    }
    competitors: {
      team: {
        id: string
        abbreviation: string
        displayName: string
        name: string
        logo: string
      }
      homeAway: 'home' | 'away'
      score: string
      stats?: Record<string, string>
    }[]
    odds?: any[]
    venue?: {
      fullName: string
      city: string
      state: string
    }
  }[]
}

export default function GamePage() {
  const params = useParams()
  const sport = params.sport as string
  const eventId = params.eventId as string
  const config = sportConfig[sport.toUpperCase()]
  
  const [gameData, setGameData] = useState<GameData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [odds, setOdds] = useState<Record<string, any>>({})
  const [scraperData, setScraperData] = useState<Record<string, any>>({})
  const [scraperLoading, setScraperLoading] = useState<Record<string, boolean>>({})
  const [liveBoxScore, setLiveBoxScore] = useState<any>(null)

  const teamsInfo = useMemo(() => {
    if (!gameData) return { home: null, away: null }
    const competitors = gameData.competitions?.[0]?.competitors ?? []
    const home = competitors.find((c) => c.homeAway === 'home')
    const away = competitors.find((c) => c.homeAway === 'away')
    return {
      home: home ? {
        name: home.team.displayName,
        abbr: home.team.abbreviation,
        logo: home.team.logo,
      } : null,
      away: away ? {
        name: away.team.displayName,
        abbr: away.team.abbreviation,
        logo: away.team.logo,
      } : null,
    }
  }, [gameData])

  const opponentFantasyAbbr = (abbr: string) => {
    const match = teams.find((t) => {
      if (t.sport !== sport.toUpperCase()) return false
      return getEspnAbbr(t.id, t.abbreviation) === abbr
    })
    return match?.abbreviation
  }

  useEffect(() => {
    if (!eventId || !sport) return

    setLoading(true)
    setError(null)

    fetch(`/api/game?eventId=${eventId}`)
      .then(r => {
        if (!r.ok) throw new Error(`API error: ${r.status}`)
        return r.json()
      })
      .then(data => {
        const game = data?.game ?? null
        if (!game) throw new Error('No game data returned')
        setGameData(game)
      })
      .catch(err => {
        console.error('[game] Failed to load:', err)
        setError(err.message)
      })
      .finally(() => setLoading(false))
  }, [eventId, sport])

  const eventDate = gameData?.date?.slice(0, 10).replace(/-/g, '')
  const status = gameData?.competitions?.[0]?.status?.type
  const isLiveNow = status?.state === 'in'
  const isCompleted = status?.completed || status?.state === 'post'

  // While the game is in progress, keep the header scores/status and the box
  // score fresh so the page switches from preview to live naturally.
  useEffect(() => {
    if (!eventId || !isLiveNow) return
    let stopped = false

    async function poll() {
      if (document.hidden) return
      try {
        const res = await fetch(`/api/box-score?sport=${sport}&eventId=${eventId}`, { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json()
        const box = json?.boxScore
        if (stopped || !box) return
        setLiveBoxScore(box)
        if (box.status?.state && box.status.state !== 'in') {
          setGameData((g) =>
            g
              ? {
                  ...g,
                  competitions: g.competitions.map((c, i) =>
                    i === 0
                      ? {
                          ...c,
                          status: {
                            ...c.status,
                            type: {
                              ...c.status.type,
                              state: box.status.state,
                              completed: !!box.status.completed,
                              shortDetail: box.status.shortDetail ?? c.status.type.shortDetail,
                              description: box.status.description ?? c.status.type.description,
                            },
                          },
                        }
                      : c
                  ),
                }
              : g
          )
        } else {
          setGameData((g) =>
            g
              ? {
                  ...g,
                  competitions: g.competitions.map((c, i) => {
                    if (i !== 0) return c
                    const known = (abbr: string) =>
                      box.teams?.find((t: any) => (t.abbreviation ?? '').toUpperCase() === abbr.toUpperCase())
                    return {
                      ...c,
                      competitors: c.competitors.map((cmp) => {
                        const t = known(cmp.team?.abbreviation ?? '')
                        const dv = t?.score?.displayValue
                        return dv != null ? { ...cmp, score: dv } : cmp
                      }),
                    }
                  }),
                }
              : g
          )
        }
      } catch { /* keep last snapshot */ }
    }

    poll()
    const id = setInterval(poll, 15000)
    return () => { stopped = true; clearInterval(id) }
  }, [eventId, sport, isLiveNow])

  const loadPropsForTeam = async (teamAbbr: string, opponentAbbr: string) => {
    if (!gameData) return
    
    const gameDate = gameData.date.slice(0, 10).replace(/-/g, '')
    
    try {
      const oddsRes = await fetch(`/api/odds?sport=${sport}&team=${teamAbbr}&eventId=${eventId}&date=${gameDate}`)
      if (oddsRes.ok) {
        const oddsData = await oddsRes.json()
        setOdds(prev => ({ ...prev, [teamAbbr]: oddsData.odds }))
      }
    } catch (err) {
      console.error(`[odds] Failed for ${teamAbbr}:`, err)
    }

    if (sport.toUpperCase() === 'NFL') {
      setScraperLoading(prev => ({ ...prev, [teamAbbr]: true }))
      try {
        const scraperRes = await fetch('/api/scraper', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ team: teamAbbr, opponent: opponentAbbr, gameDate, sport: sport.toLowerCase() }),
        })
        if (scraperRes.ok) {
          const scraperJson = await scraperRes.json()
          if (scraperJson?.results) {
            setScraperData(prev => ({ ...prev, [teamAbbr]: scraperJson.results }))
          }
        }
      } catch (err) {
        console.error(`[scraper] Failed for ${teamAbbr}:`, err)
      } finally {
        setScraperLoading(prev => ({ ...prev, [teamAbbr]: false }))
      }
    }
  }

  useEffect(() => {
    if (!gameData || !teamsInfo.home || !teamsInfo.away) return
    
    loadPropsForTeam(teamsInfo.away.abbr, teamsInfo.home.abbr)
    loadPropsForTeam(teamsInfo.home.abbr, teamsInfo.away.abbr)
  }, [gameData, teamsInfo])

  const isPreseason = gameData?.season?.type?.id === '1' || gameData?.season?.type?.number === 1

  const gameStatusText = isLiveNow
    ? `LIVE · ${status?.shortDetail || status?.description}`
    : isCompleted
      ? (status?.shortDetail || 'Final')
      : (status?.description || 'PRE')
  const homeScore = gameData?.competitions?.[0]?.competitors
    ?.find((c) => c.homeAway === 'home')?.score ?? '-'
  const awayScore = gameData?.competitions?.[0]?.competitors
    ?.find((c) => c.homeAway === 'away')?.score ?? '-'

  if (!config) {
    return (
      <div className="min-h-screen fs-page flex items-center justify-center">
        <div className="text-center">
          <h1 className="fs-title text-2xl text-fs-muted mb-4">Sport not found</h1>
          <Link href="/" className="fs-meta hover:text-fs-text">&larr; All Leagues</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen fs-page" style={{ '--glow': `${config.color}1c` } as React.CSSProperties}>
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10">
        <Link href={`/${sport}`} className="hover-lift fs-meta hover:text-fs-text inline-block mb-8" style={{ '--card-color': config.color } as React.CSSProperties}>
          &larr; {config.name}
        </Link>

        {loading ? (
          <div className="space-y-6">
            <div className="fs-skeleton h-32 rounded-xl"></div>
            <div className="fs-skeleton h-96 rounded-xl"></div>
          </div>
        ) : error ? (
          <div className="fs-panel p-6 text-center">
            <p className="text-fs-red">Error: {error}</p>
            <Link href={`/${sport}`} className="fs-meta hover:text-fs-text mt-4 inline-block">
              &larr; Back to {config.name}
            </Link>
          </div>
        ) : gameData ? (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="fs-eyebrow mb-2" style={{ '--tint': config.color } as React.CSSProperties}>
                  {gameData.week?.text || 'Game'}
                </p>
                <h1 className="fs-title text-3xl sm:text-4xl">
                  {teamsInfo.away?.abbr} @ {teamsInfo.home?.abbr}
                </h1>
                <p className="fs-meta mt-2">
                  {new Date(gameData.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
                {gameData.competitions?.[0]?.venue && (
                  <p className="text-sm text-fs-muted-2 mt-1">
                    {gameData.competitions[0].venue.fullName} &middot; {gameData.competitions[0].venue.city}, {gameData.competitions[0].venue.state}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <p className="text-xs text-fs-muted-2 uppercase tracking-wider">{teamsInfo.away?.abbr}</p>
                  <p className="text-3xl font-bold font-mono">{awayScore}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-fs-muted-2 uppercase tracking-wider">{teamsInfo.home?.abbr}</p>
                  <p className="text-3xl font-bold font-mono">{homeScore}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                  isCompleted 
                    ? 'bg-fs-red/20 text-fs-red' 
                    : status?.state === 'in'
                    ? 'bg-fs-turf/20 text-fs-turf animate-pulse'
                    : 'bg-fs-gold/20 text-fs-gold'
                }`}>
                  {gameStatusText}
                </span>
              </div>
            </div>

            {/* Away Team Panel */}
            {teamsInfo.away && (
              <NextGamePanel
                sport={sport}
                teamAbbr={teamsInfo.away.abbr}
                opponentAbbr={teamsInfo.home?.abbr ?? ''}
                teamFantasyAbbr={opponentFantasyAbbr(teamsInfo.away.abbr)}
                opponentFantasyAbbr={opponentFantasyAbbr(teamsInfo.home?.abbr ?? '')}
                eventId={eventId}
                eventDate={eventDate}
                teamColor={config.color}
                teamName={teamsInfo.away.name}
                opponentName={teamsInfo.home?.name ?? teamsInfo.home?.abbr ?? ''}
                odds={odds[teamsInfo.away.abbr]}
                isPreseason={isPreseason}
                scraperLoading={scraperLoading[teamsInfo.away.abbr] ?? false}
                scraperData={scraperData[teamsInfo.away.abbr]}
                isLive={isLiveNow}
                liveBoxScore={liveBoxScore}
                compact={isLiveNow}
                onBack={() => {}}
              />
            )}

            {/* Home Team Panel */}
            {teamsInfo.home && teamsInfo.away && (
              <NextGamePanel
                sport={sport}
                teamAbbr={teamsInfo.home.abbr}
                opponentAbbr={teamsInfo.away.abbr}
                teamFantasyAbbr={opponentFantasyAbbr(teamsInfo.home.abbr)}
                opponentFantasyAbbr={opponentFantasyAbbr(teamsInfo.away.abbr)}
                eventId={eventId}
                eventDate={eventDate}
                teamColor={config.color}
                teamName={teamsInfo.home.name}
                opponentName={teamsInfo.away.name}
                odds={odds[teamsInfo.home.abbr]}
                isPreseason={isPreseason}
                scraperLoading={scraperLoading[teamsInfo.home.abbr] ?? false}
                scraperData={scraperData[teamsInfo.home.abbr]}
                isLive={isLiveNow}
                liveBoxScore={liveBoxScore}
                compact={isLiveNow}
                onBack={() => {}}
              />
            )}
          </div>
        ) : (
          <div className="fs-panel p-6 text-center">
            <p className="text-fs-muted">Game not found.</p>
          </div>
        )}
      </div>
    </div>
  )
}
