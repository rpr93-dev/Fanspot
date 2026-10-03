'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { hasFantasyDraftRoom, isFantasySportLive } from '@/lib/providers/fantasy-constants'
import { resolveTeamTheme, themeVars } from '@/lib/fantasy/team-theme'
import AuctionBoard from './AuctionBoard'
import MockDraftRoom from './MockDraftRoom'
import { DetailPanel, type DetailState, type PlayerDetail } from './PlayerDetailPanel'
import { boardConfigFor, formatBoardValue } from './board-config'
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
  projSlotValue: number
  adpSlotValue: number
  valueGap: number
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
  /** NBA: ranks are league-wide and positions are an eligibility filter. */
  rankScope?: 'position' | 'overall'
  eligible?: string[]
  /** 'z' = 9-cat z-score value (one decimal), 'pts' = fantasy points. */
  valueUnit?: 'pts' | 'z'
  /** NBA per-game line: "x PTS · x REB · x AST · x STL · x BLK · x 3PM". */
  statLine?: string
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
const PAGE_SIZE = 40

function FieldBar({ row }: { row: StealRow }) {
  const max = Math.max(row.posPoolSize, 1)
  const pj = Math.min(100, (row.posRank / max) * 100)
  const ad = Math.min(100, (row.adpRank / max) * 100)
  const lo = Math.min(pj, ad)
  const hi = Math.max(pj, ad)
  const isValue = row.valueGap > 0

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
  const isValue = row.valueGap > 0
  const z = row.valueUnit === 'z'
  const unit = z ? 'z' : 'pts'
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
            <span className={styles.meta} data-tip="Model confidence in this projection" tabIndex={0}>
              Conf <b>{row.conf}</b>
            </span>
            <span className={styles.meta} data-tip="% of ESPN leagues rostering this player" tabIndex={0}>
              Roster&apos;d <b>{row.ownedPct}%</b>
            </span>
            <span
              className={styles.meta}
              data-tip={
                z
                  ? `Projected 9-category value ${formatBoardValue(row.projectedPoints, 'z')} — sum of per-game z-scores, scaled by games played`
                  : `Projected ${row.projectedPoints} fantasy points this season`
              }
              tabIndex={0}
            >
              {z ? 'Value' : 'Proj'} <b>{formatBoardValue(row.projectedPoints, row.valueUnit)}</b>
            </span>
            {row.impliedTeamTotal != null && (
              <span className={styles.meta} data-tip="Vegas implied points per game for this player's team" tabIndex={0}>
                Team total <b>{row.impliedTeamTotal.toFixed(1)}</b>
              </span>
            )}
            <span className={styles.meta}>{row.note}</span>
          </div>
          {row.statLine && (
            <div className={styles.statLine} title="Projected per-game averages">
              {row.statLine}
            </div>
          )}
        </div>
        <FieldBar row={row} />
        <div className={styles.gap}>
          <div className={`${styles.num} ${isValue ? styles.pos : styles.neg}`}>
            {isValue ? '+' : ''}{formatBoardValue(row.valueGap, row.valueUnit)}
          </div>
          <div className={styles.lab}>{isValue ? `${unit} of value` : row.valueGap === 0 ? 'on value' : `${unit} behind`}</div>
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
  const cfg = boardConfigFor(sport)
  const draftRoom = hasFantasyDraftRoom(sport)

  const teamFilter = searchParams.get('team')
  const targetPlayerId = Number(searchParams.get('player')) || null
  const targetName = searchParams.get('name')
  // Themed only when arriving from a team page; a direct visit keeps the neutral palette.
  const theme = resolveTeamTheme(sport, searchParams.get('theme'))

  const initialPos = (searchParams.get('pos') ?? cfg.defaultPos).toUpperCase()
  const [pos, setPos] = useState(cfg.positions.includes(initialPos) ? initialPos : cfg.defaultPos)
  const [mode, setMode] = useState<'snake' | 'auction' | 'mock'>(
    searchParams.get('mode') === 'auction'
      ? 'auction'
      : searchParams.get('mode') === 'mock' && draftRoom
        ? 'mock'
        : 'snake',
  )
  const [sort, setSort] = useState('gap')
  const [scoring, setScoring] = useState(cfg.defaultScoring)
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

  const nflExtras = cfg.nflExtras
  const buildUrl = useCallback(
    (offset: number) => {
      const q = new URLSearchParams({
        pos,
        sort,
        scoring,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      if (nflExtras) q.set('adpPlatform', adpPlatform)
      if (debouncedSearch) q.set('q', debouncedSearch)
      if (teamFilter) q.set('team', teamFilter)
      return `/api/fantasy/steals/${sport}?${q.toString()}`
    },
    [sport, pos, sort, scoring, adpPlatform, debouncedSearch, teamFilter, nflExtras],
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
      // The board only tracks players rostered in a minimum share of leagues, so a
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
              The pipeline only has real projection and ADP data for the NFL and NBA right now.
              Rather than show {SPORT_NAMES[sport] ?? sport.toUpperCase()} numbers borrowed from
              another sport, this board stays closed until the data is genuinely there.
            </p>
            <Link href="/fantasy/nfl" className={styles.soonLink}>Go to NFL steals</Link>{' '}
            <Link href="/fantasy/nba" className={styles.soonLink}>Go to NBA steals</Link>
          </div>
        </div>
      </div>
    )
  }

  const posLabel = pos === 'ALL' ? 'players' : cfg.overall ? `${pos}-eligible players` : `${pos}s`
  const scoringLabel = cfg.scoring.find((s) => s.value === scoring)?.label ?? scoring
  const hasMore = rows.length < total
  const updatedAt = generatedAt
    ? new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

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
        <h1 className={styles.title}>
          {mode === 'auction' ? 'Auction Values' : mode === 'mock' ? 'Mock Draft Room' : 'Steals Board'}
        </h1>
        <p className={styles.sub}>
          {mode === 'auction' ? (
            <>
              What each player is worth in <b>your</b> league, priced off the money and roster spots you
              enter. Compared against what the market pays for them.
            </>
          ) : mode === 'mock' ? (
            <>
              Run a snapshot draft against the <b>exact engine</b> that prices the Steals board — you
              make the picks, nine to nineteen reasonable-manager bots fill in the rest, and the room
              grades the result.
            </>
          ) : cfg.overall ? (
            <>
              Players going <b>later</b> than their projected value. Ranked league-wide — the position
              buttons filter by eligibility, so a PF/C shows under both.
            </>
          ) : (
            <>
              Players going <b>later</b> than their projected value. Ranked within position — a QB and a kicker are never compared directly.
            </>
          )}
          {mode === 'snake' && (
            <span className={styles.subDetail}>
              A steal is the {cfg.overall ? 'value' : 'point'} gap between the slot a player is projected for and the slot their
              ADP prices them at, normalized and weighted by confidence — so a
              low-confidence waiver outlier can&apos;t outrank a stable difference-maker.
            </span>
          )}
        </p>

        {theme && teamFilter && (
          <p className={styles.teamBanner}>
            Viewing {theme.name}
            <Link href={`/fantasy/${sport}`}>Show the whole league</Link>
          </p>
        )}

        <div className={styles.modeTabs} role="group" aria-label="Draft mode">
          <button
            type="button"
            aria-pressed={mode === 'snake'}
            className={mode === 'snake' ? styles.active : undefined}
            onClick={() => setMode('snake')}
          >
            Snake
          </button>
          <button
            type="button"
            aria-pressed={mode === 'auction'}
            className={mode === 'auction' ? styles.active : undefined}
            onClick={() => setMode('auction')}
          >
            Auction
          </button>
          <button
            type="button"
            aria-pressed={mode === 'mock'}
            className={mode === 'mock' ? styles.active : undefined}
            onClick={() => setMode('mock')}
            disabled={!draftRoom}
            title={draftRoom ? undefined : 'Mock and auction draft rooms are coming soon for this sport'}
          >
            Mock Draft{draftRoom ? '' : ' · Soon'}
          </button>
        </div>

        {mode === 'mock' && draftRoom && <MockDraftRoom sport={sport} />}

        {mode === 'auction' && <AuctionBoard sport={sport} teamFilter={teamFilter} />}

        {mode === 'snake' && (
        <div className={styles.layout}>
        <div className={styles.main}>

        <div className={styles.stickybar}>
          <div className={styles.controls}>
            <div className={styles.postabs} role="group" aria-label="Position filter">
              {cfg.positions.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={pos === p}
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
              aria-label="Search players"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className={styles.spacer} />
            <select className={styles.select} aria-label="Sort order" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="gap">Sort: Value gap</option>
              {cfg.nflExtras && <option value="scheme">Sort: Scheme value</option>}
              <option value="adp">Sort: ADP rank</option>
              <option value="proj">Sort: Proj. rank</option>
            </select>
            <select className={styles.select} aria-label="Scoring format" value={scoring} onChange={(e) => setScoring(e.target.value)}>
              {cfg.scoring.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            {cfg.nflExtras && (
              <select className={styles.select} aria-label="ADP platform" value={adpPlatform} onChange={(e) => setAdpPlatform(e.target.value)}>
                <option value="espn">ADP: ESPN</option>
                <option value="sleeper">ADP: Sleeper</option>
              </select>
            )}
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
            <button type="button" onClick={load}>Retry</button>
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
            The board only ranks players rostered in at least {cfg.minOwnedPct}% of leagues, so a listed
            starter can still be absent — that&apos;s a signal in itself, not a missing record.
            <Link href={`/fantasy/${sport}?pos=${pos}`}>
              {pos === 'ALL' ? 'See the whole board instead' : `See every ${pos} instead`}
            </Link>
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
          <button type="button" className={styles.loadmore} onClick={loadMore} disabled={!hasMore || loadingMore}>
            {loadingMore
              ? 'Loading…'
              : hasMore
                ? `Show ${Math.min(PAGE_SIZE, total - rows.length)} more`
                : 'All players shown'}
          </button>
        )}
        </div>

        <aside className={styles.aside} aria-label="Board summary and availability watch">
          <section className={styles.asideCard}>
            <h2>Board</h2>
            <p>
              <b>{scoringLabel}</b> scoring · {pos === 'ALL' ? 'all positions' : posLabel}
              {teamFilter ? ` · ${teamFilter.toUpperCase()} only` : ''}
            </p>
            <p>
              {loading ? 'Loading…' : `${total} ranked · ${tracked} tracked`}
              {updatedAt ? ` · updated ${updatedAt}` : ''}
            </p>
          </section>

          <section className={styles.asideCard}>
            <h2>How to read a row</h2>
            <ul>
              <li><b>Field bar</b> — projected rank vs. ADP rank{cfg.overall ? ' across the whole league' : ' within the position'}. Green = value, red = reach.</li>
              <li><b>Conf</b> — 0–100 trust in the projection{cfg.overall ? ' (durability, minutes, injury, roster share, experience)' : ''}.</li>
              <li>
                <b>{cfg.overall && scoring === 'category' ? 'Value' : 'Proj'}</b> —{' '}
                {cfg.overall && scoring === 'category'
                  ? 'sum of per-game 9-cat z-scores × games/82 (TO counts against).'
                  : 'projected season fantasy points.'}
              </li>
              <li>
                <b>Gap</b> — {cfg.overall && scoring === 'category' ? 'z' : 'points'} of value between the projected slot and the ADP slot.
              </li>
            </ul>
          </section>

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
        </aside>
        </div>
        )}

        <footer className={styles.footer}>
          {mode === 'mock' ? (
            <span>bots draft off the same ranking every user sees</span>
          ) : (
            <span>
              {tracked} players tracked
              {updatedAt ? ` · updated ${updatedAt}` : ''}
            </span>
          )}
          <span>
            {mode === 'auction'
              ? cfg.overall
                ? 'value = projection above the last rostered player league-wide, priced to your budget'
                : 'value = projection above the last startable player, priced to your budget'
              : cfg.overall
                ? 'gap = ADP rank − projected rank, overall'
                : 'gap = ADP rank − projected rank, within position'}
          </span>
        </footer>
      </div>
    </div>
  )
}
