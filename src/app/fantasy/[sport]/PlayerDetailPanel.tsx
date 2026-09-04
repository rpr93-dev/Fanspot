'use client'

import styles from './steals.module.css'

export interface PlayerNews {
  title: string
  url: string
  source: string
  snippet: string
}

export interface PlayerDetail {
  playerId: number
  name: string
  pos: string
  team: string
  bio: {
    age?: number
    yearsExp?: number
    height?: string
    weight?: string
    college?: string
    jersey?: string
    depthChartOrder?: number
  }
  injury: { injured: boolean; status: string }
  projection: { points: number; line: string } | null
  lastSeason: { year?: number; points: number } | null
  market: {
    /** Within-position ADP rank — same semantics as the board's field bar. */
    adpRank?: number
    /** League-wide rank; shown alongside so the two figures can't be confused. */
    overallAdpRank?: number
    /** Ready-made labelled form, e.g. "QB #12 - overall #102". */
    adpLabel?: string
    ownedPct: number
    startedPct: number
    auctionValue: number
  }
  vegas: { teamImpliedPoints: number } | null
  news: PlayerNews[]
}

export type DetailState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: PlayerDetail }

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={styles.detailStat}>
      <span className={styles.lab}>{label}</span>
      <span className={`${styles.val} ${alert ? styles.injured : ''}`}>{value}</span>
    </div>
  )
}

export function DetailPanel({
  state,
  extra,
  hideAuctionStat,
}: {
  state: DetailState
  extra?: React.ReactNode
  /** Set where the caller already shows this figure rescaled, to avoid two prices. */
  hideAuctionStat?: boolean
}) {
  if (state.status === 'loading') {
    return <div className={styles.detail}><p className={styles.detailNote}>Loading player info…</p></div>
  }
  if (state.status === 'error') {
    return <div className={styles.detail}><p className={styles.detailNote}>Couldn&apos;t load player info: {state.message}</p></div>
  }

  const d = state.data
  const b = d.bio
  return (
    <div className={styles.detail}>
      {extra}

      <div className={styles.detailGrid}>
        {b.age != null && <Stat label="Age" value={String(b.age)} />}
        {b.yearsExp != null && <Stat label="Exp" value={b.yearsExp === 0 ? 'Rookie' : `${b.yearsExp} yr`} />}
        {b.height && <Stat label="Ht" value={b.height} />}
        {b.weight && <Stat label="Wt" value={`${b.weight} lb`} />}
        {b.jersey && <Stat label="No." value={`#${b.jersey}`} />}
        {b.college && <Stat label="College" value={b.college} />}
        {b.depthChartOrder != null && <Stat label="Depth" value={`${d.pos}${b.depthChartOrder}`} />}
        <Stat label="Status" value={d.injury.status} alert={d.injury.injured || d.injury.status !== 'ACTIVE'} />
        {(d.market.adpLabel || d.market.adpRank != null) && (
          <Stat label="ADP" value={d.market.adpLabel ?? `#${d.market.adpRank}`} />
        )}
        <Stat label="Rostered" value={`${d.market.ownedPct}%`} />
        <Stat label="Started" value={`${d.market.startedPct}%`} />
        {!hideAuctionStat && d.market.auctionValue > 0 && (
          <Stat label="Auction" value={`$${d.market.auctionValue}`} />
        )}
        {d.vegas && <Stat label="Team total" value={d.vegas.teamImpliedPoints.toFixed(1)} />}
      </div>

      {d.projection && (
        <p className={styles.detailLine}>
          Projected <b>{d.projection.points} FP</b>
          {d.projection.line ? ` — ${d.projection.line}` : ''}
          {d.lastSeason ? ` · ${d.lastSeason.points} FP in ${d.lastSeason.year ?? 'the last completed season'}` : ''}
        </p>
      )}

      <p className={styles.newsHead}>Latest news</p>
      {d.news.length === 0 ? (
        <p className={styles.detailNote}>No recent coverage found.</p>
      ) : (
        d.news.map((n) => (
          <a key={n.url} className={styles.newsItem} href={n.url} target="_blank" rel="noopener noreferrer">
            <span className={styles.newsTitle}>{n.title}</span>
            <span className={styles.newsMeta}>{n.source}</span>
          </a>
        ))
      )}
    </div>
  )
}
