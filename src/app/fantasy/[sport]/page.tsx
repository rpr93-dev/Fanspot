'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { isFantasySportLive } from '@/lib/providers/fantasy-constants'
import { resolveTeamTheme, themeVars } from '@/lib/fantasy/team-theme'
import AuctionBoard from './AuctionBoard'
import { DetailPanel, type DetailState, type PlayerDetail } from './PlayerDetailPanel'
import styles from './steals.module.css'

type InjuryTier = 'healthy' | 'probable' | 'questionable' | 'doubtful' | 'out' | 'severe'

interface StealRow {
  playerId: number
  name: string
  pos: string
  team: string
  posRank: number
  adpRank: number
  gap: number
  adpSource: 'espn' | 'popularity_fallback'
  conf: number
  ownedPct: number
  note: string
  posPoolSize: number
  projectedPoints: number
  overallAdp: number
  impliedTeamTotal?: number
  envScore?: number
  envSignal?: 'top-offense' | 'average' | 'poor-offense'
  envRank?: number
  envTeamCount?: number
  schemeDelta?: number
  schemeHeadline?: string
  injuryTier: InjuryTier
  injuryStatus: string
  injuryDetail?: string
  gateApplied: boolean
  gateReason?: 'severe-injury' | 'suspended' | 'doubtful-rank-floor'
  rankByGap?: number
  suspended?: boolean
}

const INJURY_BADGES: Partial<Record<InjuryTier, { label: string; warn?: boolean }>> = {
  probable: { label: 'PROBABLE', warn: true },
  questionable: { label: 'QUESTIONABLE', warn: true },
  doubtful: { label: 'DOUBTFUL' },
  out: { label: 'OUT' },
  severe: { label: 'INJURY WATCH' },
}
interface BoardResponse {
  rows: StealRow[]
  injuryWatch: StealRow[]
  total: number
  counts: Record<string, number>
  positions: string[]
  tracked: number
  generatedAt: string
}

const SPORT_NAMES: Record<string, string> = { nfl: 'NFL', nba: 'NBA', mlb: 'MLB', nhl: 'NHL' }
const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'D/ST']
const PAGE_SIZE = 40

const SCORING_OPTIONS = [
  { value: 'ppr', label: 'PPR' },
  { value: 'half-ppr', label: 'Half-PPR' },
  { value: 'standard', label: 'Standard' },
]

function FieldBar({ row }: { row: StealRow }) {
  const max = Math.max(row.posPoolSize, 1)
  const pj = Math.min(100, (row.posRank / max) * 100)
  const ad = Math.min(100, (row.adpRank / max) * 100)
  const lo = Math.min(pj, ad)
  const hi = Math.max(pj, ad)
  const isValue = row.gap > 0

  return (
    <div className={styles.field}>
      <span className={`${styles.lbl} ${styles.hi}`} style={{ left: `${pj}%` }}>#{row.posRank}</span>
      <span className={styles.lbl} style={{ left: `${ad}%` }}>#{row.adpRank}</span>
      <div className={styles.track} />
      <div
        className={`${styles.bar} ${isValue ? styles.pos : styles.neg}`}
        style={{ left: `${lo}%`, width: `${hi - lo}%` }}
      />
      <div className={`${styles.tick} ${styles.proj}`} style={{ left: `${pj}%` }} />
      <div className={`${styles.tick} ${styles.adp}`} style={{ left: `${ad}%` }} />
    </div>
  )
}

function Row({
  row,
  index,
  open,
  detail,
  onToggle,
  watch,
  target,
}: {
  row: StealRow
  index: number
  open: boolean
  detail?: DetailState
  onToggle: () => void
  watch?: boolean
  target?: boolean
}) {
  const isValue = row.gap > 0
  // A suspension outranks any injury tag: it is why the player is unavailable.
  const badge = row.suspended ? { label: 'SUSPENDED', warn: false } : INJURY_BADGES[row.injuryTier]
  return (
    <>
      <div
        id={`player-${row.playerId}`}
        className={`${styles.row} ${styles.clickable} ${!watch && index === 0 ? styles.top : ''} ${watch ? styles.watch : ''} ${target ? styles.target : ''} ${open ? styles.open : ''}`}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
      >
        <div className={styles.rank}>{watch ? '—' : index + 1}</div>
        <div className={styles.who}>
          <div className={styles.nameLine}>
            <span className={styles.name}>{row.name}</span>
            <span className={styles.tag}>
              <span className={styles.pos}>{row.pos}</span> · {row.team}
            </span>
            {target && <span className={styles.targetTag}>FROM TEAM PAGE</span>}
            {badge && (
              <span
                className={`${styles.injTag} ${badge.warn ? styles.warn : ''}`}
                title={row.injuryDetail ? `${row.injuryStatus} — ${row.injuryDetail}` : row.injuryStatus}
              >
                {badge.label}
              </span>
            )}
            {row.gateReason === 'doubtful-rank-floor' && (
              <span className={styles.injTag} title={`Ranked #${row.rankByGap} by ADP-gap but held out of the top 10 while listed Doubtful.`}>
                HELD OUT OF TOP 10
              </span>
            )}
            {row.adpSource === 'popularity_fallback' && (
              <span
                className={styles.popTag}
                title="No platform draft rank for this player — this is search popularity, not ADP. Treat the gap as unreliable."
              >
                POPULARITY, NOT ADP
              </span>
            )}
            {row.envSignal === 'top-offense' && (
              <span
                className={styles.envTag}
                title={`Team ranks #${row.envRank ?? '?'}/${row.envTeamCount ?? '?'} in Vegas implied points per game — a strong environment makes the gap more trustworthy.${row.schemeHeadline ? ` Scheme: ${row.schemeHeadline}` : ''}`}
              >
                TOP OFFENSE
              </span>
            )}
            {row.envSignal === 'poor-offense' && (
              <span
                className={`${styles.envTag} ${styles.bad}`}
                title={`Team ranks #${row.envRank ?? '?'}/${row.envTeamCount ?? '?'} in Vegas implied points per game — a weak environment caps how much the gap can be trusted.${row.schemeHeadline ? ` Scheme: ${row.schemeHeadline}` : ''}`}
              >
                BOTTOM OFFENSE
              </span>
            )}
          </div>
          <div className={styles.metaLine}>
            <span className={styles.meta} data-tip="Model confidence in this projection">
              Conf <b>{row.conf}</b>
            </span>
            <span className={styles.meta} data-tip="% of ESPN leagues rostering this player">
              Roster&apos;d <b>{row.ownedPct}%</b>
            </span>
            <span className={styles.meta} data-tip={`Projected ${row.projectedPoints} fantasy points this season`}>
              Proj <b>{row.projectedPoints}</b>
            </span>
            {row.impliedTeamTotal != null && (
              <span className={styles.meta} data-tip="Vegas implied points per game for this player's team">
                Team total <b>{row.impliedTeamTotal.toFixed(1)}</b>
              </span>
            )}
            <span className={styles.meta}>{row.note}</span>
          </div>
        </div>
        <FieldBar row={row} />
        <div className={styles.gap}>
          <div className={`${styles.num} ${isValue ? styles.pos : styles.neg}`}>
            {isValue ? '+' : ''}{row.gap}
          </div>
          <div className={styles.lab}>{isValue ? 'spot value' : row.gap === 0 ? 'on value' : 'reach'}</div>
        </div>
      </div>
      {open && detail && <DetailPanel state={detail} />}
    </>
  )
}

export default function FantasySportPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const sport = ((params.sport as string) || 'nfl').toLowerCase()
  const live = isFantasySportLive(sport)

  const teamFilter = searchParams.get('team')
  const targetPlayerId = Number(searchParams.get('player')) || null
  const targetName = searchParams.get('name')
  // Themed only when arriving from a team page; a direct visit keeps the neutral palette.
  const theme = resolveTeamTheme(sport, searchParams.get('theme'))

  const initialPos = (searchParams.get('pos') ?? 'QB').toUpperCase()
  const [pos, setPos] = useState(POSITIONS.includes(initialPos) ? initialPos : 'QB')
  const [mode, setMode] = useState<'snake' | 'auction'>(
    searchParams.get('mode') === 'auction' ? 'auction' : 'snake',
  )
  const [sort, setSort] = useState('gap')
  const [scoring, setScoring] = useState('ppr')
  const [adpPlatform, setAdpPlatform] = useState('espn')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [rows, setRows] = useState<StealRow[]>([])
  const [injuryWatch, setInjuryWatch] = useState<StealRow[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [tracked, setTracked] = useState(0)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openPlayer, setOpenPlayer] = useState<number | null>(null)
  const [details, setDetails] = useState<Record<number, DetailState>>({})
  const [missingTarget, setMissingTarget] = useState(false)

  const requestId = useRef(0)
  const scrolledTo = useRef<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const buildUrl = useCallback(
    (offset: number) => {
      const q = new URLSearchParams({
        pos,
        sort,
        scoring,
        adpPlatform,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      if (debouncedSearch) q.set('q', debouncedSearch)
      if (teamFilter) q.set('team', teamFilter)
      return `/api/fantasy/steals/${sport}?${q.toString()}`
    },
    [sport, pos, sort, scoring, adpPlatform, debouncedSearch, teamFilter],
  )

  const load = useCallback(async () => {
    if (!live) {
      setLoading(false)
      return
    }
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    setOpenPlayer(null)
    try {
      const res = await fetch(buildUrl(0), { signal: AbortSignal.timeout(60000) })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message || body.error || `HTTP ${res.status}`)
      }
      const data: BoardResponse = await res.json()
      if (id !== requestId.current) return
      setRows(data.rows)
      setInjuryWatch(data.injuryWatch ?? [])
      setTotal(data.total)
      setCounts(data.counts ?? {})
      setTracked(data.tracked ?? 0)
      setGeneratedAt(data.generatedAt)
    } catch (err) {
      if (id !== requestId.current) return
      setError(err instanceof Error ? err.message : 'Failed to load the board')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [buildUrl, live])

  useEffect(() => {
    load()
  }, [load])

  // Deep link from a team page: open and scroll to that player once, after the first
  // page of rows lands. Runs once per id so it doesn't fight later user interaction.
  useEffect(() => {
    // Clearing the deep link (e.g. "Show the whole league") must retract the notice —
    // the early return below would otherwise leave it up with nothing to refer to.
    if (!targetPlayerId) {
      setMissingTarget(false)
      return
    }
    if (loading || scrolledTo.current === targetPlayerId) return
    const present =
      rows.some((r) => r.playerId === targetPlayerId) ||
      injuryWatch.some((r) => r.playerId === targetPlayerId)
    if (!present) {
      // The board only tracks players rostered in at least 1% of leagues, so a
      // deep-linked starter can legitimately be absent. Say so instead of leaving
      // an unexplained empty list.
      setMissingTarget(true)
      return
    }
    setMissingTarget(false)
    scrolledTo.current = targetPlayerId
    setOpenPlayer(targetPlayerId)
    void loadDetail(targetPlayerId)
    requestAnimationFrame(() => {
      document.getElementById(`player-${targetPlayerId}`)?.scrollIntoView({ block: 'center' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetPlayerId, loading, rows, injuryWatch])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const res = await fetch(buildUrl(rows.length), { signal: AbortSignal.timeout(60000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: BoardResponse = await res.json()
      setRows((prev) => [...prev, ...data.rows])
      setTotal(data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more')
    } finally {
      setLoadingMore(false)
    }
  }

  if (!live) {
    return (
      <div className={styles.board}>
        <div className={styles.wrap}>
          <p className={styles.eyebrow}>Fanspot / {SPORT_NAMES[sport] ?? sport.toUpperCase()} / Draft Prep</p>
          <h1 className={styles.title}>Steals Board</h1>
          <div className={styles.soon} style={{ marginTop: 22 }}>
            <p className={styles.soonTag}>Coming soon</p>
            <p>
              The pipeline only has real projection and ADP data for the NFL right now.
              Rather than show {SPORT_NAMES[sport] ?? sport.toUpperCase()} numbers that are
              really NFL numbers, this board stays closed until the data is genuinely there.
            </p>
            <Link href="/fantasy/nfl" className={styles.soonLink}>Go to NFL steals</Link>
          </div>
        </div>
      </div>
    )
  }

  const posLabel = pos === 'ALL' ? 'players' : `${pos}s`
  const hasMore = rows.length < total

  async function togglePlayer(playerId: number) {
    if (openPlayer === playerId) {
      setOpenPlayer(null)
      return
    }
    setOpenPlayer(playerId)
    await loadDetail(playerId)
  }

  async function loadDetail(playerId: number) {
    if (details[playerId]?.status === 'ready') return

    setDetails((prev) => ({ ...prev, [playerId]: { status: 'loading' } }))
    try {
      const res = await fetch(`/api/fantasy/player/${sport}/${playerId}`, {
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message || body.error || `HTTP ${res.status}`)
      }
      const data: PlayerDetail = await res.json()
      setDetails((prev) => ({ ...prev, [playerId]: { status: 'ready', data } }))
    } catch (err) {
      setDetails((prev) => ({
        ...prev,
        [playerId]: { status: 'error', message: err instanceof Error ? err.message : 'unknown error' },
      }))
    }
  }

  return (
    <div className={styles.board} style={themeVars(theme)}>
      <div className={styles.wrap}>
        <p className={styles.eyebrow}>Fanspot / {SPORT_NAMES[sport] ?? sport.toUpperCase()} / Draft Prep</p>
        <h1 className={styles.title}>{mode === 'auction' ? 'Auction Values' : 'Steals Board'}</h1>
        <p className={styles.sub}>
          {mode === 'auction' ? (
            <>
              What each player is worth in <b>your</b> league, priced off the money and roster spots you
              enter. Compared against what the market pays for them.
            </>
          ) : (
            <>
              Players going <b>later</b> than their projected value. Ranked within position — a QB and a kicker are never compared directly.
            </>
          )}
        </p>

        {theme && teamFilter && (
          <p className={styles.teamBanner}>
            Viewing {theme.name}
            <Link href={`/fantasy/${sport}`}>Show the whole league</Link>
          </p>
        )}

        <div className={styles.modeTabs}>
          <button
            className={mode === 'snake' ? styles.active : undefined}
            onClick={() => setMode('snake')}
          >
            Snake
          </button>
          <button
            className={mode === 'auction' ? styles.active : undefined}
            onClick={() => setMode('auction')}
          >
            Auction
          </button>
        </div>

        {mode === 'auction' && <AuctionBoard sport={sport} teamFilter={teamFilter} />}

        {mode === 'snake' && (
        <>

        <div className={styles.stickybar}>
          <div className={styles.controls}>
            <div className={styles.postabs}>
              {POSITIONS.map((p) => (
                <button
                  key={p}
                  className={pos === p ? styles.active : undefined}
                  onClick={() => setPos(p)}
                  title={counts[p] != null ? `${counts[p]} tracked` : undefined}
                >
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
            <select className={styles.select} value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="gap">Sort: Value gap</option>
              <option value="scheme">Sort: Scheme value</option>
              <option value="adp">Sort: ADP rank</option>
              <option value="proj">Sort: Proj. rank</option>
            </select>
            <select className={styles.select} value={scoring} onChange={(e) => setScoring(e.target.value)}>
              {SCORING_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <select className={styles.select} value={adpPlatform} onChange={(e) => setAdpPlatform(e.target.value)}>
              <option value="espn">ADP: ESPN</option>
              <option value="sleeper">ADP: Sleeper</option>
            </select>
          </div>

          <div className={styles.scaleNote}>
            <span className={styles.k}><span className={styles.dot} style={{ background: 'var(--text)' }} />Proj. rank</span>
            <span className={styles.k}><span className={styles.dot} style={{ background: 'var(--muted-2)' }} />ADP rank</span>
            <span className={styles.k}><span className={styles.dot} style={{ background: 'var(--turf)' }} />Value</span>
            <span className={styles.k}><span className={styles.dot} style={{ background: 'var(--red)' }} />Reach</span>
          </div>
        </div>

        <p className={styles.countLine}>
          {loading
            ? 'Loading…'
            : `Showing ${rows.length} of ${total} ${posLabel}${teamFilter ? ` · ${teamFilter.toUpperCase()} only` : ''}`}
        </p>

        {error && (
          <div className={styles.error}>
            {error}
            <button onClick={load}>Retry</button>
          </div>
        )}

        {loading && !error && (
          <div>
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className={styles.skeleton} />)}
          </div>
        )}

        {!loading && !error && missingTarget && (
          <p className={styles.notice}>
            {targetName ? `${targetName} isn't` : "That player isn't"} on the Steals board.
            The board only ranks players rostered in at least 1% of leagues, so a listed
            starter can still be absent — that's a signal in itself, not a missing record.
            <Link href={`/fantasy/${sport}?pos=${pos}`}>See every {pos} instead</Link>
          </p>
        )}

        {!loading && !error && rows.length === 0 && !missingTarget && (
          <p className={styles.empty}>No players match.</p>
        )}

        {!loading && !error && rows.map((row, i) => (
          <Row
            key={row.playerId}
            row={row}
            index={i}
            target={row.playerId === targetPlayerId}
            open={openPlayer === row.playerId}
            detail={details[row.playerId]}
            onToggle={() => togglePlayer(row.playerId)}
          />
        ))}

        {!loading && !error && rows.length > 0 && (
          <button className={styles.loadmore} onClick={loadMore} disabled={!hasMore || loadingMore}>
            {loadingMore
              ? 'Loading…'
              : hasMore
                ? `Show ${Math.min(PAGE_SIZE, total - rows.length)} more`
                : 'All players shown'}
          </button>
        )}

        {!loading && !error && injuryWatch.length > 0 && (
          <>
            <h2 className={styles.watchHead}>Availability Watch</h2>
            <p className={styles.watchSub}>
              Held off the main board because they are unavailable — a long-term injury or a
              suspension — not because of their ADP gap. Ranked by the same value math — they
              just aren&apos;t steals while the return timeline is open.
            </p>
            {injuryWatch.map((row, i) => (
              <Row
                key={row.playerId}
                row={row}
                index={i}
                watch
                target={row.playerId === targetPlayerId}
                open={openPlayer === row.playerId}
                detail={details[row.playerId]}
                onToggle={() => togglePlayer(row.playerId)}
              />
            ))}
          </>
        )}
        </>
        )}

        <footer className={styles.footer}>
          <span>
            {tracked} players tracked
            {generatedAt ? ` · updated ${new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
          <span>
            {mode === 'auction'
              ? 'value = projection above the last startable player, priced to your budget'
              : 'gap = ADP rank − projected rank, within position'}
          </span>
        </footer>
      </div>
    </div>
  )
}
