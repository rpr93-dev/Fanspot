'use client'

import { useCallback, useEffect, useState } from 'react'
import styles from './steals.module.css'

interface AuctionRow {
  playerId: number
  name: string
  pos: string
  team: string
  projectedPoints: number
  vorp: number
  value: number
  market: number | null
  surplus: number | null
  posRank: number
  injuryTier: string
  injuryDetail?: string
}

interface Assumptions {
  budget: number
  teams: number
  rosterSize: number
  totalMoney: number
  discretionary: number
  dollarsPerPoint: number
  replacementLevels: Record<string, number>
  marketUnavailable: boolean
}

interface AuctionResponse {
  rows: AuctionRow[]
  injuryWatch: AuctionRow[]
  total: number
  assumptions: Assumptions
  methodology: string
}

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'D/ST']
const PAGE_SIZE = 40

function money(n: number | null): string {
  return n == null ? '—' : `$${n.toFixed(0)}`
}

export default function AuctionBoard({ sport, teamFilter }: { sport: string; teamFilter: string | null }) {
  const [budget, setBudget] = useState(200)
  const [teams, setTeams] = useState(12)
  const [rosterSize, setRosterSize] = useState(16)
  const [pos, setPos] = useState('ALL')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [data, setData] = useState<AuctionResponse | null>(null)
  const [rows, setRows] = useState<AuctionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const buildUrl = useCallback(
    (offset: number) => {
      const q = new URLSearchParams({
        budget: String(budget),
        teams: String(teams),
        rosterSize: String(rosterSize),
        pos,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      if (teamFilter) q.set('team', teamFilter)
      if (debouncedSearch) q.set('search', debouncedSearch)
      return `/api/fantasy/auction/${sport}?${q.toString()}`
    },
    [sport, budget, teams, rosterSize, pos, teamFilter, debouncedSearch],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(buildUrl(0), { signal: AbortSignal.timeout(60000) })
      .then(async (r) => {
        const json = await r.json()
        if (!r.ok) throw new Error(json.message ?? json.error ?? 'Request failed')
        return json as AuctionResponse
      })
      .then((json) => {
        if (cancelled) return
        setData(json)
        setRows(json.rows)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load auction values')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [buildUrl])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const r = await fetch(buildUrl(rows.length), { signal: AbortSignal.timeout(60000) })
      const json = (await r.json()) as AuctionResponse
      if (r.ok) setRows((prev) => [...prev, ...json.rows])
    } finally {
      setLoadingMore(false)
    }
  }

  const a = data?.assumptions

  return (
    <>
      <div className={styles.stickybar}>
        <div className={styles.controls}>
          <div className={styles.postabs}>
            {POSITIONS.map((p) => (
              <button key={p} className={pos === p ? styles.active : undefined} onClick={() => setPos(p)}>
                {p}
              </button>
            ))}
          </div>
          <input
            className={styles.search}
            placeholder="Search player…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className={styles.spacer} />
          <label className={styles.numField}>
            Budget
            <input
              type="number"
              min={10}
              max={1000}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value) || 0)}
            />
          </label>
          <label className={styles.numField}>
            Teams
            <input
              type="number"
              min={2}
              max={20}
              value={teams}
              onChange={(e) => setTeams(Number(e.target.value) || 0)}
            />
          </label>
          <label className={styles.numField}>
            Roster
            <input
              type="number"
              min={1}
              max={40}
              value={rosterSize}
              onChange={(e) => setRosterSize(Number(e.target.value) || 0)}
            />
          </label>
        </div>

        {a && (
          <p className={styles.assumptionLine}>
            ${a.totalMoney.toLocaleString()} across {a.teams} teams · ${a.discretionary.toLocaleString()} left to
            bid with after the $1-per-slot floor · ${a.dollarsPerPoint.toFixed(2)} per point above replacement
          </p>
        )}
      </div>

      <p className={styles.countLine}>
        {loading
          ? 'Loading…'
          : `Showing ${rows.length} of ${data?.total ?? 0}${teamFilter ? ` · ${teamFilter} only` : ''}`}
      </p>

      {error && (
        <div className={styles.error}>
          {error}
          <button onClick={() => setBudget((b) => b)}>Retry</button>
        </div>
      )}

      {loading && !error && (
        <div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      )}

      {!loading && !error && rows.length === 0 && <p className={styles.empty}>No players match.</p>}

      {!loading && !error && rows.length > 0 && (
        <div className={styles.auctionTable}>
          <div className={styles.auctionHead}>
            <span>Player</span>
            <span>Worth</span>
            <span>Going for</span>
            <span>Edge</span>
          </div>
          {rows.map((r) => (
            <div key={r.playerId} className={styles.auctionRow}>
              <span className={styles.auctionName}>
                <b>{r.name}</b>
                <em>
                  {r.pos} · {r.team} · {r.projectedPoints} proj
                </em>
              </span>
              <span className={styles.auctionValue}>{money(r.value)}</span>
              <span className={styles.auctionMarket}>{money(r.market)}</span>
              <span
                className={
                  r.surplus == null ? styles.auctionFlat : r.surplus > 0 ? styles.auctionUp : styles.auctionDown
                }
              >
                {r.surplus == null ? '—' : `${r.surplus > 0 ? '+' : ''}$${Math.abs(r.surplus).toFixed(0)}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && data && rows.length < data.total && (
        <button className={styles.loadmore} onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : `Show ${Math.min(PAGE_SIZE, data.total - rows.length)} more`}
        </button>
      )}

      {!loading && data && data.injuryWatch.length > 0 && (
        <section className={styles.injurySection}>
          <h2 className={styles.newsHead}>Injury watch</h2>
          <p className={styles.assumptionLine}>
            Priced, but held out of the ranking above: a collapsed market price on an injured player reads as a
            bargain when it is the opposite.
          </p>
          {data.injuryWatch.map((r) => (
            <div key={r.playerId} className={styles.auctionRow}>
              <span className={styles.auctionName}>
                <b>{r.name}</b>
                <em>
                  {r.pos} · {r.team} · {r.injuryDetail ?? r.injuryTier}
                </em>
              </span>
              <span className={styles.auctionValue}>{money(r.value)}</span>
              <span className={styles.auctionMarket}>{money(r.market)}</span>
              <span className={styles.auctionFlat}>—</span>
            </div>
          ))}
        </section>
      )}

      {data && (
        <p className={styles.methodology} title={data.methodology}>
          Modelled values, not quoted prices. {a?.marketUnavailable ? 'No market prices available for comparison.' : 'Market is ESPN’s average winning bid, rescaled to this league’s money.'}
        </p>
      )}
    </>
  )
}
