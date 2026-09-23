'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { teams, sportConfig } from '@/data/teams'
import NextGamePanel from '@/components/NextGamePanel'
import { GameStatsSection, LastPlayBlock } from '@/components/box-score/GameStatsSection'
import { LiveGameSummary } from '@/components/game/GameSummary'
import { GameHeader } from '@/components/game/GameHeader'
import { LinescoreTable, PlayerBoxScore } from '@/components/game/PlayerBoxScore'
import { PlayByPlay } from '@/components/game/PlayByPlay'
import { EmptyState, ErrorState, SkeletonRows } from '@/components/feedback'
import { useLivePoll } from '@/hooks/useLivePoll'
import { getEspnAbbr } from '@/lib/sports-api'
import { normalizeEvent, normalizeSportKey, type NormalizedGame, type SportKey } from '@/lib/models'
import type { NormalizedPlay } from '@/lib/plays'

type TabId = 'summary' | 'box' | 'plays' | 'teams' | 'model'

const TAB_LABELS: Record<TabId, string> = {
  summary: 'Summary',
  box: 'Box Score',
  plays: 'Plays',
  teams: 'Team Stats',
  model: 'Props',
}

export default function GamePage() {
  const params = useParams()
  const sportParam = params.sport as string
  const eventId = params.eventId as string
  const sport = normalizeSportKey(sportParam)
  const config = sport ? sportConfig[sport] : undefined

  const [game, setGame] = useState<NormalizedGame | null>(null)
  const [gameError, setGameError] = useState<string | null>(null)
  const [boxScore, setBoxScore] = useState<any>(null)
  const [plays, setPlays] = useState<NormalizedPlay[] | null>(null)
  const [playsError, setPlaysError] = useState<string | null>(null)
  const [playsChecked, setPlaysChecked] = useState(false)
  const [tab, setTab] = useState<TabId>('summary')
  const [odds, setOdds] = useState<Record<string, any>>({})
  const [scraperData, setScraperData] = useState<Record<string, any>>({})
  const [scraperLoading, setScraperLoading] = useState<Record<string, boolean>>({})
  const [modelLoaded, setModelLoaded] = useState(false)
  const [oddsStatus, setOddsStatus] = useState<Record<string, 'loading' | 'found' | 'none' | 'no-game' | 'error'>>({})

  const isLive = game?.status.phase === 'live'
  const isFinal = game?.status.phase === 'final'

  // Default tab follows game state: finals open on the box score.
  useEffect(() => {
    if (isFinal) setTab((t) => (t === 'summary' ? 'box' : t))
  }, [isFinal])

  const loadGame = useCallback(async () => {
    if (!sport || !eventId) return
    const res = await fetch(`/api/game?sport=${sport}&eventId=${eventId}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Game API returned ${res.status}`)
    const json = await res.json()
    const normalized = normalizeEvent(sport, json?.game)
    if (!normalized) throw new Error('No game data returned')
    setGame(normalized)
    setGameError(null)
  }, [sport, eventId])

  const loadBoxScore = useCallback(async () => {
    if (!sport || !eventId) return
    const res = await fetch(`/api/box-score?sport=${sport}&eventId=${eventId}`, { cache: 'no-store' })
    if (!res.ok) return
    const json = await res.json()
    if (json?.boxScore) {
      setBoxScore(json.boxScore)
      // Keep header scores/status fresh while live.
      const st = json.boxScore.status
      setGame((g) => {
        if (!g || !st) return g
        const state = st.completed ? 'final' : st.state === 'in' ? 'live' : g.status.phase
        if (state === 'live') {
          const known = (abbr: string) =>
            json.boxScore.teams?.find((t: any) => (t.abbreviation ?? '').toUpperCase() === abbr.toUpperCase())
          const patch = (side: typeof g.away) => {
            const t = known(side.abbr)
            return t?.score?.displayValue != null ? { ...side, scoreDisplay: String(t.score.displayValue), score: Number(t.score.displayValue) || side.score } : side
          }
          return {
            ...g,
            away: patch(g.away),
            home: patch(g.home),
            status: {
              ...g.status,
              phase: 'live',
              shortDetail: st.shortDetail ?? g.status.shortDetail,
              detail: st.detail ?? g.status.detail,
            },
          }
        }
        if (state === 'final' && g.status.phase !== 'final') {
          return { ...g, status: { ...g.status, phase: 'final', completed: true } }
        }
        return g
      })
    }
  }, [sport, eventId])

  const loadPlays = useCallback(async () => {
    if (!sport || !eventId) return
    try {
      const res = await fetch(`/api/plays?sport=${sport}&eventId=${eventId}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`Plays API returned ${res.status}`)
      const json = await res.json()
      setPlays(Array.isArray(json?.plays) ? json.plays : [])
      setPlaysError(null)
    } catch (err) {
      setPlaysError(err instanceof Error ? err.message : 'Failed to load plays')
    } finally {
      setPlaysChecked(true)
    }
  }, [sport, eventId])

  // Initial loads.
  useEffect(() => {
    let cancelled = false
    setGameError(null)
    loadGame().catch((err) => {
      if (!cancelled) setGameError(err instanceof Error ? err.message : 'Failed to load game')
    })
    loadBoxScore()
    loadPlays()
    return () => {
      cancelled = true
    }
  }, [loadGame, loadBoxScore, loadPlays])

  // Box-score retry: a single failed first load must not leave the page
  // without team stats. Retry a few times until the payload arrives (a ref
  // mirror avoids restarting the timer on every live score update).
  const boxScoreRef = useRef<any>(null)
  boxScoreRef.current = boxScore
  const boxScoreAttempts = useRef(0)
  useEffect(() => {
    boxScoreAttempts.current = 0
  }, [sport, eventId])
  useLivePoll(
    loadBoxScore,
    () => {
      if (isLive) return 15_000
      if (boxScoreRef.current) return null
      if (boxScoreAttempts.current >= 8) return null
      boxScoreAttempts.current += 1
      return 10_000
    },
    [loadBoxScore, isLive],
  )

  // Live polling: plays too (server-cached).
  useLivePoll(loadPlays, () => (isLive ? 15_000 : null), [loadPlays, isLive])

  const teamsInfo = useMemo(() => {
    if (!game) return { home: null, away: null }
    return { home: game.home, away: game.away }
  }, [game])

  const opponentFantasyAbbr = useCallback(
    (abbr: string) => {
      if (!sport) return undefined
      const match = teams.find((t) => {
        if (t.sport !== sport) return false
        return getEspnAbbr(t.id, t.abbreviation) === abbr
      })
      return match?.abbreviation
    },
    [sport],
  )

  // Props data loads lazily when the tab opens (avoids slow scraper/odds
  // waterfalls for visitors who never look at modeling). Every sport gets odds
  // + projections; the NFL additionally gets the Docker line scraper.
  useEffect(() => {
    if (tab !== 'model' || modelLoaded || !game || !sport) return
    setModelLoaded(true)
    const awayAbbr = game.away.abbr
    const homeAbbr = game.home.abbr
    const gameDate = game.date.slice(0, 10).replace(/-/g, '')
    const loadForTeam = async (teamAbbr: string, opponentAbbr: string) => {
      setOddsStatus((prev) => ({ ...prev, [teamAbbr]: 'loading' }))
      try {
        const oddsRes = await fetch(`/api/odds?sport=${sport}&team=${teamAbbr}&eventId=${eventId}&date=${gameDate}`)
        if (oddsRes.ok) {
          const oddsData = await oddsRes.json()
          setOdds((prev) => ({ ...prev, [teamAbbr]: oddsData.odds }))
          setOddsStatus((prev) => ({ ...prev, [teamAbbr]: oddsData.status ?? (oddsData.odds ? 'found' : 'none') }))
        } else {
          setOddsStatus((prev) => ({ ...prev, [teamAbbr]: 'error' }))
        }
      } catch (err) {
        console.error(`[odds] Failed for ${teamAbbr}:`, err)
        setOddsStatus((prev) => ({ ...prev, [teamAbbr]: 'error' }))
      }
      if (sport === 'NFL') {
        setScraperLoading((prev) => ({ ...prev, [teamAbbr]: true }))
        try {
          const scraperRes = await fetch('/api/scraper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ team: teamAbbr, opponent: opponentAbbr, gameDate, sport: sport.toLowerCase() }),
          })
          if (scraperRes.ok) {
            const scraperJson = await scraperRes.json()
            if (scraperJson?.results) setScraperData((prev) => ({ ...prev, [teamAbbr]: scraperJson.results }))
          }
        } catch (err) {
          console.error(`[scraper] Failed for ${teamAbbr}:`, err)
        } finally {
          setScraperLoading((prev) => ({ ...prev, [teamAbbr]: false }))
        }
      }
    }
    void loadForTeam(awayAbbr, homeAbbr)
    void loadForTeam(homeAbbr, awayAbbr)
  }, [tab, modelLoaded, game, sport, eventId])

  if (!sport || !config) {
    return (
      <div className="min-h-screen fs-page flex items-center justify-center">
        <div className="text-center">
          <h1 className="fs-title text-2xl text-fs-muted mb-4">Sport not found</h1>
          <Link href="/" className="fs-meta hover:text-fs-text">&larr; All Leagues</Link>
        </div>
      </div>
    )
  }

  const sportKey = sport as SportKey
  const bsTeams: any[] = boxScore?.teams ?? []
  const awayBs = bsTeams.find((t: any) => t.homeAway === 'away') ?? bsTeams[0] ?? null
  const homeBs = bsTeams.find((t: any) => t.homeAway === 'home') ?? bsTeams[1] ?? null
  const hasTeamStats = !!awayBs && !!homeBs
  const hasPlayerStats = (boxScore?.playerStats ?? []).some(
    (t: any) => t.categories?.some((c: any) => c.athletes?.length > 0),
  )
  const hasPlays = (plays ?? []).length > 0

  const availableTabs: TabId[] = [
    'summary',
    ...(hasPlayerStats || boxScore ? ['box' as TabId] : []),
    ...(playsChecked && hasPlays ? ['plays' as TabId] : []),
    ...(hasTeamStats ? ['teams' as TabId] : []),
    // NFL keeps the tab after the game (model graded vs final); other sports'
    // projections are pre-game only, so the tab retires once the game is final.
    ...(sport === 'NFL' || !isFinal ? ['model' as TabId] : []),
  ]
  const activeTab = availableTabs.includes(tab) ? tab : 'summary'
  const eventDate = game?.date?.slice(0, 10).replace(/-/g, '')
  const isPreseason = false // season-type detail comes from the event when present

  return (
    <div className="min-h-screen fs-page" style={{ '--glow': `${config.color}1c` } as React.CSSProperties}>
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10">
        <Link
          href={`/${sportParam}`}
          className="hover-lift fs-meta hover:text-fs-text inline-block mb-6"
          style={{ '--card-color': config.color } as React.CSSProperties}
        >
          &larr; {config.name}
        </Link>

        {gameError ? (
          <ErrorState
            message={`Couldn't load this game: ${gameError}`}
            onRetry={() => {
              setGameError(null)
              loadGame().catch((err) =>
                setGameError(err instanceof Error ? err.message : 'Failed to load game'),
              )
            }}
          />
        ) : !game ? (
          <div className="space-y-6">
            <div className="fs-skeleton h-40 rounded-xl" />
            <div className="fs-skeleton h-96 rounded-xl" />
          </div>
        ) : (
          <div className="space-y-6">
            <GameHeader game={game} />

            <div className="flex gap-1 p-1 rounded-full border border-fs-line bg-fs-panel/60 w-fit max-w-full overflow-x-auto" role="tablist" aria-label="Game sections">
              {availableTabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t}
                  onClick={() => setTab(t)}
                  className={`fs-tab whitespace-nowrap ${activeTab === t ? 'fs-tab-active' : ''}`}
                >
                  {TAB_LABELS[t]}
                </button>
              ))}
            </div>

            {activeTab === 'summary' && (
              <div className="space-y-4" role="tabpanel">
                {game.status.phase === 'pre' ? (
                  <div className="fs-panel p-5">
                    <h2 className="fs-title text-lg mb-2">Pregame</h2>
                    <p className="text-sm text-fs-muted">
                      {new Date(game.date).toLocaleString('en-US', {
                        weekday: 'long', month: 'long', day: 'numeric',
                        hour: 'numeric', minute: '2-digit',
                      })}
                      {game.broadcast ? ` · ${game.broadcast}` : ''}
                    </p>
                    {game.odds && (game.odds.spread != null || game.odds.total != null || game.odds.homeMoneyline != null) && (
                      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 fs-mono text-sm tabular-nums">
                        {game.odds.spread != null && <span>Spread {game.odds.spread > 0 ? `+${game.odds.spread}` : game.odds.spread}</span>}
                        {game.odds.total != null && <span>O/U {game.odds.total}</span>}
                        {game.odds.homeMoneyline != null && <span>{game.home.abbr} {game.odds.homeMoneyline > 0 ? `+${game.odds.homeMoneyline}` : game.odds.homeMoneyline}</span>}
                        {game.odds.awayMoneyline != null && <span>{game.away.abbr} {game.odds.awayMoneyline > 0 ? `+${game.odds.awayMoneyline}` : game.odds.awayMoneyline}</span>}
                      </div>
                    )}
                    {game.away.recordSummary && game.home.recordSummary && (
                      <p className="fs-meta mt-3">
                        {game.away.abbr} {game.away.recordSummary} · {game.home.abbr} {game.home.recordSummary}
                      </p>
                    )}
                  </div>
                ) : (
                  <LiveGameSummary
                    sport={sport}
                    away={{ abbr: game.away.abbr, name: game.away.name }}
                    home={{ abbr: game.home.abbr, name: game.home.name }}
                    boxScore={boxScore}
                    plays={plays}
                    playsChecked={playsChecked}
                    playsError={playsError}
                    onRetryPlays={loadPlays}
                    lastPlayBlock={
                      boxScore?.lastPlay ? (
                        <LastPlayBlock play={boxScore.lastPlay} sport={sport} />
                      ) : null
                    }
                    onViewTeamStats={() => {
                      if (hasTeamStats) setTab('teams')
                    }}
                  />
                )}
              </div>
            )}

            {activeTab === 'box' && (
              <div role="tabpanel">
                <LinescoreTable
                  sport={sportKey}
                  away={awayBs ? { abbreviation: awayBs.abbreviation, linescores: awayBs.linescores, homeAway: 'away' } : null}
                  home={homeBs ? { abbreviation: homeBs.abbreviation, linescores: homeBs.linescores, homeAway: 'home' } : null}
                />
                <PlayerBoxScore sport={sportKey} playerStats={boxScore?.playerStats ?? null} loading={!boxScore} />
              </div>
            )}

            {activeTab === 'plays' && (
              <div role="tabpanel">
                <PlayByPlay plays={plays} loading={!playsChecked} error={playsError} onRetry={loadPlays} />
              </div>
            )}

            {activeTab === 'teams' && (
              <div role="tabpanel">
                <LinescoreTable
                  sport={sportKey}
                  away={awayBs ? { abbreviation: awayBs.abbreviation, linescores: awayBs.linescores, homeAway: 'away' } : null}
                  home={homeBs ? { abbreviation: homeBs.abbreviation, linescores: homeBs.linescores, homeAway: 'home' } : null}
                />
                {awayBs && homeBs ? (
                  <GameStatsSection
                    away={awayBs}
                    home={homeBs}
                    status={boxScore?.status ?? null}
                    sport={sport}
                    lastPlay={boxScore?.lastPlay ?? null}
                  />
                ) : (
                  <EmptyState title="Team stats not yet available." />
                )}
              </div>
            )}

            {activeTab === 'model' && teamsInfo.away && teamsInfo.home && (
              <div className="space-y-6" role="tabpanel">
                <NextGamePanel
                  sport={sportParam}
                  teamAbbr={teamsInfo.away.abbr}
                  opponentAbbr={teamsInfo.home.abbr}
                  teamFantasyAbbr={opponentFantasyAbbr(teamsInfo.away.abbr)}
                  opponentFantasyAbbr={opponentFantasyAbbr(teamsInfo.home.abbr)}
                  eventId={eventId}
                  eventDate={eventDate}
                  teamColor={config.color}
                  teamName={teamsInfo.away.name}
                  opponentName={teamsInfo.home.name}
                  odds={odds[teamsInfo.away.abbr]}
                  oddsStatus={oddsStatus[teamsInfo.away.abbr] ?? 'loading'}
                  isPreseason={isPreseason}
                  scraperLoading={scraperLoading[teamsInfo.away.abbr] ?? false}
                  scraperData={scraperData[teamsInfo.away.abbr]}
                  isLive={isLive}
                  phase={isFinal ? 'final' : isLive ? 'live' : 'pre'}
                  liveBoxScore={boxScore}
                  compact={isLive || isFinal}
                  projectionTeams="ours"
                  onBack={() => {}}
                />
                <NextGamePanel
                  sport={sportParam}
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
                  oddsStatus={oddsStatus[teamsInfo.home.abbr] ?? 'loading'}
                  isPreseason={isPreseason}
                  scraperLoading={scraperLoading[teamsInfo.home.abbr] ?? false}
                  scraperData={scraperData[teamsInfo.home.abbr]}
                  isLive={isLive}
                  phase={isFinal ? 'final' : isLive ? 'live' : 'pre'}
                  liveBoxScore={boxScore}
                  compact={isLive || isFinal}
                  projectionTeams="ours"
                  onBack={() => {}}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
