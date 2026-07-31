'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface WidgetSteal {
  playerId: number
  name: string
  pos: string
  team: string
  posRank: number
  adpRank: number
  gap: number
  conf: number
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
  const [steals, setSteals] = useState<WidgetSteal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(
          `/api/fantasy/steals/${sport.toLowerCase()}?pos=ALL&sort=gap&scoring=ppr&limit=3`,
          { signal: AbortSignal.timeout(15000) },
        )
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        if (!cancelled) setSteals(data.rows || [])
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [sport])

  return (
    <div
      className="rounded-xl p-6 flex flex-col"
      style={{ backgroundColor: `${teamColor}08`, border: `1px solid ${teamColor}15` }}
    >
      <h2 className="text-xs font-medium tracking-wider uppercase mb-4 text-gray-400">Fantasy Outlook</h2>
      {loading && (
        <div className="animate-pulse space-y-3 flex-1">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-10 rounded" style={{ backgroundColor: `${teamColor}15` }} />
          ))}
        </div>
      )}
      {error && (
        <p className="text-sm text-gray-500 flex-1 flex items-center justify-center">No data</p>
      )}
      {!loading && !error && steals.length === 0 && (
        <p className="text-sm text-gray-500 flex-1 flex items-center justify-center">No steals found</p>
      )}
      {steals.length > 0 && (
        <div className="space-y-2 flex-1">
          {steals.map((s) => (
            <div
              key={s.playerId}
              className="flex items-center justify-between rounded-lg p-3"
              style={{ backgroundColor: `${teamColor}0a`, border: `1px solid ${teamColor}08` }}
            >
              <div>
                <span className="text-sm font-medium text-white/80">{s.name}</span>
                <span className="text-xs text-gray-500 ml-2">{s.pos}</span>
                <span className={`text-xs ml-1.5 ${s.team === teamAbbr ? 'text-white font-medium' : 'text-gray-600'}`}>
                  {s.team}
                </span>
              </div>
              <div className="text-right">
                <span
                  className="text-xs text-gray-500"
                  title={`Projected ${s.pos}${s.posRank} · drafted as ${s.pos}${s.adpRank}`}
                >
                  {s.pos}{s.adpRank} → {s.pos}{s.posRank}
                </span>
                <div className="flex items-center gap-1 justify-end">
                  <span className={`text-xs font-bold ${s.gap > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {s.gap > 0 ? '+' : ''}{s.gap}
                  </span>
                  <span className="text-[10px] text-gray-600">spots</span>
                </div>
              </div>
            </div>
          ))}
          <Link
            href={`/fantasy/${sport.toLowerCase()}?team=${teamAbbr}`}
            className="block text-xs text-center text-gray-500 hover:text-white mt-2 transition"
          >
            View all steals →
          </Link>
        </div>
      )}
    </div>
  )
}
