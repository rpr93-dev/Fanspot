'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

type InjuryTier = 'healthy' | 'probable' | 'questionable' | 'doubtful' | 'out' | 'severe'

interface StarterPlayer {
  playerId: number
  name: string
  projectedPoints: number
  statLine: string
  depthChartOrder?: number
  percentStarted: number
  injuryTier: InjuryTier
  injuryDetail?: string
  outlook: string
}

interface Starter {
  pos: string
  player: StarterPlayer | null
  contender: { playerId: number; name: string } | null
  unsettled: boolean
  evidence?: 'depth-chart' | 'usage' | 'projection'
  reason: string
}

const INJURY_LABEL: Partial<Record<InjuryTier, string>> = {
  probable: 'PROB',
  questionable: 'QUES',
  doubtful: 'DOUBT',
  out: 'OUT',
  severe: 'INJ WATCH',
}

export default function FantasyWidget({
  sport,
  teamAbbr,
  teamColor,
}: {
  sport: string
  teamAbbr: string
  teamColor: string
}) {
  const [starters, setStarters] = useState<Starter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/fantasy/team-outlook/${sport.toLowerCase()}/${teamAbbr.toLowerCase()}`,
          { signal: AbortSignal.timeout(60000) },
        )
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`)
        if (!cancelled) setStarters(body.starters ?? [])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [sport, teamAbbr])

  // Lands on the player's own position tab, filtered to this team, with the row opened
  // and the board reskinned to this team's colors.
  function stealsHref(s: Starter): string {
    const q = new URLSearchParams({ pos: s.pos, team: teamAbbr, theme: teamAbbr })
    if (s.player) q.set('player', String(s.player.playerId))
    return `/fantasy/${sport.toLowerCase()}?${q.toString()}`
  }

  return (
    <div
      className="rounded-xl p-6 flex flex-col"
      style={{ backgroundColor: `${teamColor}08`, border: `1px solid ${teamColor}15` }}
    >
      <h2 className="text-xs font-medium tracking-wider uppercase mb-1 text-gray-400">Fantasy Outlook</h2>
      <p className="text-[10px] text-gray-600 mb-4">Current starter at each position</p>

      {loading && (
        <div className="animate-pulse space-y-3 flex-1">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 rounded" style={{ backgroundColor: `${teamColor}15` }} />
          ))}
        </div>
      )}

      {error && <p className="text-sm text-gray-500 flex-1 flex items-center justify-center">{error}</p>}

      {!loading && !error && (
        <div className="space-y-2 flex-1">
          {starters.map((s) => (
            <Link
              key={s.pos}
              href={stealsHref(s)}
              className="block rounded-lg p-3 transition hover:brightness-125"
              style={{ backgroundColor: `${teamColor}0a`, border: `1px solid ${teamColor}12` }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[10px] font-bold tracking-wider text-gray-500 shrink-0">{s.pos}1</span>
                  <span className="text-sm font-medium text-white/85 truncate">
                    {s.player ? s.player.name : '—'}
                  </span>
                  {s.player && INJURY_LABEL[s.player.injuryTier] && (
                    <span
                      className="text-[9px] font-bold px-1 py-px rounded shrink-0 text-red-300 bg-red-500/15"
                      title={s.player.injuryDetail}
                    >
                      {INJURY_LABEL[s.player.injuryTier]}
                    </span>
                  )}
                </div>
                {s.player && s.player.projectedPoints > 0 && (
                  <span className="text-xs text-gray-500 shrink-0 tabular-nums">
                    {s.player.projectedPoints} FP
                  </span>
                )}
              </div>

              {s.unsettled ? (
                <p className="text-[11px] text-amber-400/80 mt-1 leading-snug">{s.reason}</p>
              ) : s.player ? (
                <p className="text-[11px] text-gray-500 mt-1 leading-snug line-clamp-2">{s.player.outlook}</p>
              ) : (
                <p className="text-[11px] text-gray-600 mt-1 leading-snug">{s.reason}</p>
              )}
            </Link>
          ))}

          {starters.length === 0 && (
            <p className="text-sm text-gray-500 flex-1 flex items-center justify-center">No outlook data</p>
          )}
        </div>
      )}
    </div>
  )
}
