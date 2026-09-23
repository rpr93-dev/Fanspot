'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { eventDateToAsOf, extractLiveStats, quartersPlayed, isGameComplete, namesMatch } from '@/lib/propLedger'
import { isOutTier, parseRosterInjuries, teamQbs } from '@/lib/injury'
import { computeOverUnderEdge, EDGE_STYLES, formatPrice, normalizePlayerName, pickConfidencePct } from '@/lib/propEdge'
import { PlayerProjections, type BookPlayer, type ProjectionRow } from '@/components/PlayerProjections'

interface PropLine {
  market: string
  label: string
  stat?: string | null
  line: number
  over: number | null
  under: number | null
}

interface PropPlayer {
  name: string
  position: string | null
  team: string | null
  props: PropLine[]
}

interface ProjectedLine {
  name: string
  position: string
  team: string
  status?: string | null
  note?: string | null
  lines: { stat?: string; label: string; value: number; sd?: number }[]
}

interface PropsResponse {
  available: boolean
  reason?: string
  bookmaker?: string
  homeTeam?: string
  awayTeam?: string
  players?: PropPlayer[]
  projections?: ProjectedLine[]
  preseason?: boolean
  matchup?: {
    total: number
    spread: number
    ourTotal: number
    oppTotal: number
    ourMultiplier: number
    oppMultiplier: number
  } | null
}

interface StarterPlayer {
  playerId: number
  name: string
  projectedPoints: number
  statLine?: string
  injuryTier: string
  injuryDetail?: string
  outlook?: string
}

interface Starter {
  pos: string
  player: StarterPlayer | null
  contender?: { playerId: number; name: string } | null
  unsettled?: boolean
  reason?: string
}

interface ModelProjection {
  player: string
  stat: string
  stat_label: string
  unit: string
  projection: number | null
  baseline: number | null
  low: number | null
  high: number | null
  p10: number | null
  p25: number | null
  p50: number | null
  p75: number | null
  p90: number | null
  confidence: string
  confidence_score: number | null
  n_games: number
  effective_sample_size: number | null
  opponent_factor: number | null
  script_factor: number | null
  role_factor: number | null
  recent_form_factor: number | null
  refused_reason: string | null
  note: string | null
  warnings: string[] | null
  last_updated?: string | null
  reliability?: number
  pred_sd?: number | null
}

const INJURY_LABEL: Record<string, string> = {
  probable: 'PROB',
  questionable: 'QUES',
  doubtful: 'DOUBT',
  out: 'OUT',
  severe: 'INJ WATCH',
}

function slotLabel(pos: string): string {
  return pos === 'D/ST' ? 'D/ST' : `${pos}1`
}

const POS_ORDER = ['QB', 'RB', 'WR', 'TE']

export default function NextGamePanel({
  sport,
  teamAbbr,
  opponentAbbr,
  teamFantasyAbbr,
  opponentFantasyAbbr,
  eventId,
  eventDate,
  teamColor,
  teamName,
  opponentName,
  odds,
  oddsStatus,
  isPreseason,
  onBack,
  scraperLoading,
  scraperData,
  scraperError,
  liveBoxScore,
  isLive,
  compact,
  phase: phaseProp,
  projectionTeams = 'both',
  hideWhenEmpty,
}: {
  sport: string
  teamAbbr: string
  opponentAbbr: string
  teamFantasyAbbr?: string
  opponentFantasyAbbr?: string
  eventId?: string
  eventDate?: string
  teamColor: string
  teamName: string
  opponentName: string
  odds: any
  oddsStatus?: 'loading' | 'found' | 'none' | 'no-game' | 'error'
  isPreseason?: boolean
  onBack: () => void
  scraperLoading?: boolean
  scraperData?: any
  scraperError?: string | null
  liveBoxScore?: any | null
  isLive?: boolean
  compact?: boolean
  /**
   * Game phase drives what the panel is for:
   *  - pre:   preview — odds, lineups, projections; the model runs once and
   *           its pre-game snapshot is locked.
   *  - live:  model snapshot vs the live box score (never re-projects).
   *  - final: model snapshot vs the final result, with a pick scorecard.
   * Defaults to live when `isLive`, else pre.
   */
  phase?: 'pre' | 'live' | 'final'
  /** 'ours' limits the non-NFL projection table to this panel's team. */
  projectionTeams?: 'both' | 'ours'
  /** Final phase without a saved snapshot renders nothing (team page). */
  hideWhenEmpty?: boolean
}) {
  const phase = phaseProp ?? (isLive ? 'live' : 'pre')
  const isNfl = sport.toUpperCase() === 'NFL'
  // Live and final both compare the frozen snapshot against a box score.
  const comparing = phase !== 'pre'
  const [props, setProps] = useState<PropsResponse | null>(null)
  const [ourStarters, setOurStarters] = useState<Starter[] | null>(null)
  const [oppStarters, setOppStarters] = useState<Starter[] | null>(null)
  const [fantasyError, setFantasyError] = useState<string | null>(null)

  // Matchup context from the game odds the dashboard already fetched: pass the Vegas
  // total + spread along so the API can make the projected lines matchup-aware.
  const total = typeof odds?.overUnder === 'number' ? odds.overUnder : null
  const spread = typeof odds?.spread === 'number' ? odds.spread : null

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ sport })
    if (teamAbbr) params.set('team', teamAbbr)
    if (opponentAbbr) params.set('opponent', opponentAbbr)
    if (eventDate) params.set('date', eventDate)
    if (eventId) params.set('eventId', eventId)
    if (isPreseason) params.set('preseason', '1')
    if (total != null && spread != null) {
      params.set('total', String(total))
      params.set('spread', String(spread))
    }
    fetch(`/api/props?${params.toString()}`, { signal: AbortSignal.timeout(15000) })
      .then((r) => r.json().catch(() => ({ available: false })))
      .then((json) => { if (!cancelled) setProps(json) })
      .catch(() => { if (!cancelled) setProps({ available: false, reason: 'error' }) })
    return () => { cancelled = true }
  }, [sport, teamAbbr, opponentAbbr, eventId, eventDate, isPreseason, total, spread])

  // Fantasy updates for both teams' star players (starters at each position).
  useEffect(() => {
    // Lineups only matter before the game; live/final work off the snapshot.
    if (!isNfl || phase === 'final') return
    let cancelled = false

    async function load(abbr: string | undefined, setter: (s: Starter[] | null) => void) {
      if (!abbr) return
      try {
        const res = await fetch(`/api/fantasy/team-outlook/${sport.toLowerCase()}/${abbr.toLowerCase()}`, {
          signal: AbortSignal.timeout(30000),
        })
        const body = await res.json().catch(() => ({}))
        if (res.ok && !cancelled) setter(body.starters ?? null)
        else if (!cancelled) setFantasyError(body.message ?? `Could not load ${abbr} outlook`)
      } catch {
        if (!cancelled) setFantasyError(`Could not load ${abbr} outlook`)
      }
    }

    load(teamFantasyAbbr, setOurStarters)
    load(opponentFantasyAbbr, setOppStarters)
    return () => { cancelled = true }
  }, [sport, phase, teamFantasyAbbr, opponentFantasyAbbr])

  const ourProjected = props?.projections?.filter((p) => p.team === teamAbbr) ?? []
  const oppProjected = props?.projections?.filter((p) => p.team === opponentAbbr) ?? []

  // ---- Prop Model (Python pipeline) ----
  const [modelResults, setModelResults] = useState<ModelProjection[] | null>(null)
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [modelRunDate, setModelRunDate] = useState<string | null>(null)
  const [prevModelDataThrough, setPrevModelDataThrough] = useState<string | null>(null)
  const [showScraper, setShowScraper] = useState(false)

  // ---- Injury awareness ----
  const [rosterInjuries, setRosterInjuries] = useState<{ name: string; status: string; date: string | null }[] | null>(null)
  const [backupProjections, setBackupProjections] = useState<ModelProjection[] | null>(null)
  const [backupLoading, setBackupLoading] = useState(false)
  // Mid-game QB tracking: refs hold cross-poll state, exits are useState so
  // the table re-renders (derived fresh every live poll — never latched, so a
  // returning starter swaps straight back in).
  const [exitedQbs, setExitedQbs] = useState<Record<string, { backup: string; quarter: number; teamEspn: string }>>({})
  const exitedQbsRef = useRef<Record<string, { backup: string; quarter: number; teamEspn: string }>>({})
  const prevQbAttemptsRef = useRef<Map<string, number>>(new Map())
  const activeQbRef = useRef<Map<string, string>>(new Map())
  const stallRef = useRef<Map<string, number>>(new Map())
  const backupProjectedRef = useRef<string | null>(null)
  const backupInflightRef = useRef(false)
  const lastSubSigRef = useRef<string | null>(null)

  // Starter name sets — only project starters (not depth-chart backups).
  const ourStarterNames = useMemo(() => {
    const s = new Set<string>()
    for (const st of (ourStarters ?? [])) { if (st.player && !st.unsettled) s.add(st.player.name) }
    return s
  }, [ourStarters])
  const oppStarterNames = useMemo(() => {
    const s = new Set<string>()
    for (const st of (oppStarters ?? [])) { if (st.player && !st.unsettled) s.add(st.player.name) }
    return s
  }, [oppStarters])

  // Markets modeled per position group (yards + volume + TD markets).
  const MARKETS_FOR_POS: Record<string, string[]> = {
    QB: ['passing_yards', 'tds'],
    RB: ['rushing_yards', 'receptions', 'tds'],
    WR: ['receiving_yards', 'receptions', 'tds'],
    TE: ['receiving_yards', 'receptions', 'tds'],
  }
  const statForPos = (pos: string | null): string[] => {
    const p = (pos ?? '').toUpperCase()
    return MARKETS_FOR_POS[p] ?? []
  }

  const modelTeamCodes = () => ({
    our: (teamFantasyAbbr || teamAbbr || '').toUpperCase(),
    opp: (opponentFantasyAbbr || opponentAbbr || '').toUpperCase(),
  })

  // Effective lineup: pre-game Out starters are auto-swapped for their
  // depth-chart contender (any position). Works for every team — the swap is
  // driven by the outlook's injuryTier + contender, never by names.
  const effectiveLineup = useMemo(() => {
    const lineup: { slotPos: string; starterName: string; effectiveName: string; team: string; opponent: string; substituteFor?: string }[] = []
    const codes = modelTeamCodes()
    const add = (starters: Starter[] | null, team: string, opponent: string) => {
      for (const st of (starters ?? [])) {
        if (!st.player || st.unsettled) continue
        const sub = isOutTier(st.player.injuryTier) && st.contender?.name ? st.contender.name : null
        lineup.push({
          slotPos: st.pos,
          starterName: st.player.name,
          effectiveName: sub ?? st.player.name,
          team,
          opponent,
          ...(sub ? { substituteFor: st.player.name } : {}),
        })
      }
    }
    add(ourStarters, codes.our, codes.opp)
    add(oppStarters, codes.opp, codes.our)
    return lineup
  }, [ourStarters, oppStarters, teamFantasyAbbr, opponentFantasyAbbr, teamAbbr, opponentAbbr])

  const effectiveNames = useMemo(
    () => new Set(effectiveLineup.map((s) => s.effectiveName)),
    [effectiveLineup],
  )

  const buildTargets = (): { player: string; stat: string; team: string; opponent: string; prior?: number }[] => {
    const out: { player: string; stat: string; team: string; opponent: string; prior?: number }[] = []
    // One target per modeled market; slot position drives the markets so a
    // swapped-in contender (absent from ESPN projections) still gets lines.
    for (const slot of effectiveLineup) {
      for (const stat of statForPos(slot.slotPos)) {
        // ESPN projected line as a prior: used by the model to blend when
        // NFL history is thin (rookie / < 2× min_games).
        const prior = espnLineFor(slot.effectiveName, stat)
        out.push({ player: slot.effectiveName, stat, team: slot.team, opponent: slot.opponent, prior: prior ?? undefined })
      }
    }
    return out
  }

  const buildLines = () => {
    if (typeof odds?.overUnder !== 'number' || typeof odds?.spread !== 'number') return null
    const codes = modelTeamCodes()
    const spread = Math.abs(odds.spread)
    const favorite = odds.spread < 0 ? codes.our : codes.opp
    return {
      [codes.our]: { total: odds.overUnder, spread, favorite },
      [codes.opp]: { total: odds.overUnder, spread, favorite },
    }
  }

  const runModel = async () => {
    setModelLoading(true)
    setModelError(null)
    // Remember data vintage before run so we can tell if it changed
    setPrevModelDataThrough(modelDataThrough)
    setModelRunDate(new Date().toISOString().slice(5, 16))
    const targets = buildTargets()
    if (!targets.length) {
      setModelError('No skill players available to project')
      setModelLoading(false)
      return
    }
    try {
      const res = await fetch('/api/prop-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets, lines: buildLines(), preseason: !!isPreseason, eventDate }),
        signal: AbortSignal.timeout(180000),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Model API returned ${res.status}`)
      const projs = Array.isArray(json.projections) ? json.projections : []
      setModelResults(projs)
      // Persist the pre-game snapshot once per game (the ledger replaces, never
      // appends, so a repeat run can't create a second "pre" — runs-once rule).
      recordPreSnapshot(projs)
    } catch (e: any) {
      setModelError(e?.message ?? 'Model run failed')
    } finally {
      setModelLoading(false)
    }
  }

  const espnLineFor = (name: string, stat: string): number | null => {
    const p = props?.projections?.find((x) => x.name === name)
    if (!p) return null
    const find = (label: string): number | null =>
      p.lines.find((l) => l.label === label)?.value ?? null
    if (stat === 'passing_yards') return find('Pass Yds')
    if (stat === 'rushing_yards') return find('Rush Yds')
    if (stat === 'receiving_yards') return find('Rec Yds')
    if (stat === 'receptions') return find('Receptions')
    if (stat === 'tds') {
      // Anytime-TD prior: ESPN projects per-type TDs; sum what it has.
      const parts = [find('Pass TDs'), find('Rush TDs'), find('Rec TDs')]
      const known = parts.filter((v): v is number => v != null)
      return known.length ? Math.round(known.reduce((a, b) => a + b, 0) * 10) / 10 : null
    }
    return null
  }

  // ---- Game-day ledger: one pre-game snapshot + live stat points per game ----
  // The snapshot is what the model said BEFORE the game; live points are what
  // actually happened. Together they are the training signal for tuning the
  // prop engine. Stored server-side in prop-model/ledger/ledger.json.
  const [ledger, setLedger] = useState<any | null>(null)
  const [ledgerChecked, setLedgerChecked] = useState(false)
  const autoRanRef = useRef(false)

  // Canonical game key: sorted team pair so both teams' pages share one record.
  const ledgerPair = (): [string, string] => {
    const codes = modelTeamCodes()
    return [codes.our, codes.opp].sort() as [string, string]
  }

  // Load any existing snapshot for this game.
  useEffect(() => {
    if (sport.toUpperCase() !== 'NFL' || !eventDate) { setLedgerChecked(true); return }
    let cancelled = false
    const [t1, t2] = ledgerPair()
    fetch(`/api/prop-ledger?team=${t1}&opponent=${t2}&eventDate=${eventDate}`, { signal: AbortSignal.timeout(10000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) { setLedger(j?.game ?? null); setLedgerChecked(true) } })
      .catch(() => { if (!cancelled) setLedgerChecked(true) })
    return () => { cancelled = true }
  }, [sport, eventDate, teamFantasyAbbr, opponentFantasyAbbr])

  // Roster injury feed (ESPN): live mid-game statuses (Questionable/Out with
  // today's date) for exit detection. ~350KB per team — only fetch when it can
  // matter: live games or kickoff within ±2 days.
  useEffect(() => {
    if (sport.toUpperCase() !== 'NFL' || !eventDate || !/^\d{8}$/.test(eventDate)) return
    const dayMs = 24 * 60 * 60 * 1000
    const now = new Date()
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const gameUtc = Date.UTC(+eventDate.slice(0, 4), +eventDate.slice(4, 6) - 1, +eventDate.slice(6, 8))
    const daysOut = (gameUtc - todayUtc) / dayMs
    if (!isLive && (daysOut > 2 || daysOut < -1)) return
    let cancelled = false
    ;(async () => {
      try {
        const abbrs = [teamAbbr, opponentAbbr].filter(Boolean)
        const results = await Promise.all(abbrs.map(async (abbr) => {
          const res = await fetch(`/api/roster?sport=NFL&team=${abbr}`, { signal: AbortSignal.timeout(20000) })
          if (!res.ok) return []
          return parseRosterInjuries(await res.json().catch(() => null))
        }))
        if (!cancelled) setRosterInjuries(results.flat())
      } catch {
        if (!cancelled) setRosterInjuries([])
      }
    })()
    return () => { cancelled = true }
  }, [sport, eventDate, isLive, teamAbbr, opponentAbbr])

  // Latest roster injury flag for a player (fuzzy name match).
  const rosterFlagFor = (name: string): { status: string; date: string | null } | null => {
    if (!rosterInjuries?.length) return null
    const hit = rosterInjuries.find((r) => namesMatch(r.name, name))
    return hit ? { status: hit.status, date: hit.date } : null
  }

  // Save the pre-game projection snapshot (skipped when one already exists).
  const recordPreSnapshot = (projs: ModelProjection[]) => {
    if (!eventDate || !projs.length || ledger?.pre) return
    try {
      const [t1, t2] = ledgerPair()
      const slotFor = (name: string) => effectiveLineup.find((s) => s.effectiveName === name)
      const teamFor = (name: string) => slotFor(name)?.team ?? modelTeamCodes().opp
      const subFor = (name: string) => slotFor(name)?.substituteFor ?? null
      const rows = projs.map((r) => {
        const scraped = scrapedLineFor(r.player, r.stat)
        const edge = scraped ? computeOverUnderEdge(r.projection, r.pred_sd ?? null, scraped.line) : null
        return {
          ...r,
          team: teamFor(r.player),
          substituteFor: subFor(r.player),
          line: scraped?.line ?? null,
          book: scraped?.book ?? null,
          over: scraped?.over ?? null,
          under: scraped?.under ?? null,
          books: scraped?.books ?? 0,
          pick: edge?.pick ?? null,
          prob: edge?.prob ?? null,
          edge: edge?.edge ?? null,
        }
      })
      const stamps = projs
        .map((r) => r.last_updated)
        .filter((v): v is string => !!v)
        .map((v) => v.slice(0, 10))
        .sort()
      const iso = stamps[stamps.length - 1]
      const dataThrough = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)
        ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`
        : null
      const meta = {
        asOf: eventDateToAsOf(eventDate),
        dataThrough,
        vegas: buildLines(),
        teams: { a: t1, b: t2 },
      }
      fetch('/api/prop-ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pre', team: t1, opponent: t2, eventDate, record: { ...meta, rows } }),
        signal: AbortSignal.timeout(30000),
      })
        .then((res) => res.json().catch(() => null))
        .then((j) => {
          if (j?.ok) {
            setLedger((g: any) => ({
              eventDate, team: t1, opponent: t2,
              live: g?.live ?? [],
              pre: { recordedAt: j.recordedAt, rows, meta },
            }))
          }
        })
        .catch(() => {})
    } catch {}
  }

  // Auto-run once per game: hydrate from the saved snapshot when present,
  // otherwise run the model once now (it only ever reads pre-game data).
  useEffect(() => {
    if (!isNfl) return
    if (autoRanRef.current || modelResults || modelLoading || !ledgerChecked) return
    const hydrateOnly = phase === 'final' && !!ledger?.pre?.rows?.length
    if (!hydrateOnly && !ourProjected.length && !oppProjected.length) return
    if (!hydrateOnly && (!ourStarters || !oppStarters)) return
    if (ledger?.pre?.rows?.length) {
      autoRanRef.current = true
      setModelResults(ledger.pre.rows)
      try {
        setModelRunDate(new Date(ledger.pre.recordedAt).toISOString().slice(5, 16))
      } catch { setModelRunDate(null) }
      if (ledger.pre.meta?.dataThrough) setPrevModelDataThrough(ledger.pre.meta.dataThrough)
      return
    }
    // After the final whistle a fresh run would be graded against a result it
    // was never blind to — only a snapshot locked before/during the game counts.
    if (phase === 'final') return
    autoRanRef.current = true
    void runModel()
  }, [sport, phase, ledgerChecked, ledger, modelResults, modelLoading, ourProjected, oppProjected, ourStarters, oppStarters])

  // ---- Live comparison: model snapshot vs ESPN box score ----
  const liveStats = useMemo(() => {
    const allRows = [...(modelResults ?? []), ...(backupProjections ?? [])]
    if (!comparing || !liveBoxScore || !allRows.length) return null
    const names = Array.from(new Set(allRows.map((r) => r.player))).map((name) => ({ name }))
    try {
      return extractLiveStats(liveBoxScore, names)
    } catch { return null }
  }, [comparing, liveBoxScore, modelResults, backupProjections])
  const liveQuarters = liveBoxScore ? quartersPlayed(liveBoxScore) : 0
  const gameFinal = liveBoxScore ? isGameComplete(liveBoxScore) : false
  const liveStatusLabel = liveBoxScore?.status?.shortDetail ?? liveBoxScore?.status?.description ?? null
  const showLive = liveStats != null

  // Record one live point per quarter (plus the final) — cheap, durable, and
  // exactly the per-game progression the optimizer needs.
  useEffect(() => {
    if (!comparing || !liveBoxScore || !liveStats || !ledgerChecked || !ledger?.pre) return
    if (!eventDate || liveQuarters <= 0) return
    const [t1, t2] = ledgerPair()
    const points = Array.isArray(ledger?.live) ? ledger.live : []
    const maxQ = points.reduce((m: number, p: any) => Math.max(m, p?.quarters ?? 0), 0)
    const hasFinal = points.some((p: any) => p?.final)
    const codes = modelTeamCodes()
    const subs = Object.entries(exitedQbs).map(([out, e]) => ({
      team: e.teamEspn === teamAbbr ? codes.our : codes.opp,
      out,
      in: e.backup,
      quarter: e.quarter,
    }))
    const subSig = JSON.stringify(subs)
    const subChanged = subs.length > 0 && subSig !== lastSubSigRef.current
    if (!(liveQuarters > maxQ || (gameFinal && !hasFinal) || subChanged)) return
    lastSubSigRef.current = subSig
    const point = {
      quarters: liveQuarters,
      state: liveBoxScore?.status?.state ?? null,
      clock: liveStatusLabel,
      ...(gameFinal ? { final: true } : {}),
      rows: liveStats,
      ...(subs.length ? { substitutions: subs } : {}),
      ...(backupProjections?.length ? { backupProjections } : {}),
    }
    fetch('/api/prop-ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'live', team: t1, opponent: t2, eventDate, record: point }),
      signal: AbortSignal.timeout(30000),
    })
      .then((res) => res.json().catch(() => null))
      .then((j) => {
        if (j?.ok) {
          setLedger((g: any) => (g ? { ...g, live: [...(g.live ?? []), { ...point, recordedAt: j.recordedAt }] } : g))
        }
      })
      .catch(() => {})
  }, [comparing, liveBoxScore, liveStats, ledgerChecked, ledger, liveQuarters, gameFinal, eventDate, exitedQbs, backupProjections, teamAbbr])

  // Project a mid-game backup QB through the same pipeline (single-target
  // run; no ESPN prior for backups, so the model leans on position history —
  // correctly low confidence). Runs at most once per backup per game view.
  const runBackupProjection = async (backupName: string, teamCode: string, oppCode: string) => {
    if (backupInflightRef.current || backupProjectedRef.current === backupName) return
    backupInflightRef.current = true
    setBackupLoading(true)
    try {
      const targets = MARKETS_FOR_POS.QB.map((stat) => {
        const prior = espnLineFor(backupName, stat)
        return { player: backupName, stat, team: teamCode, opponent: oppCode, prior: prior ?? undefined }
      })
      const res = await fetch('/api/prop-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets, lines: buildLines(), preseason: !!isPreseason, eventDate }),
        signal: AbortSignal.timeout(180000),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Model API returned ${res.status}`)
      const projs = Array.isArray(json.projections) ? json.projections : []
      // Only keep the rows if this backup is still the one under center.
      if (Object.values(exitedQbsRef.current).some((e) => e.backup === backupName)) {
        backupProjectedRef.current = backupName
        setBackupProjections(projs)
      }
    } catch {
      // Silent: the backup's accumulating live stats still show in the table.
    } finally {
      backupInflightRef.current = false
      setBackupLoading(false)
    }
  }

  // Mid-game QB substitution tracking — fully derived every live poll, for
  // every team, so a returning starter swaps straight back in:
  //  - active QB = whoever's attempts grew since the last poll (sticky).
  //  - EXITED when another QB has held the job 2+ polls AND the starter has
  //    a roster injury flag, or never threw while the backup has 8+ attempts
  //    past Q1 (surprise scratch). Garbage-time mop-up without an injury
  //    flag does NOT trigger — both QBs' live numbers just show.
  //  - swap-back the moment the starter's attempts move again.
  useEffect(() => {
    if (!isLive || !liveBoxScore || sport.toUpperCase() !== 'NFL') return
    const codes = modelTeamCodes()
    const next: Record<string, { backup: string; quarter: number; teamEspn: string }> = { ...exitedQbsRef.current }
    let mutated = false
    for (const slot of effectiveLineup) {
      if (slot.slotPos !== 'QB') continue
      const espnTeam = slot.team === codes.our ? teamAbbr : opponentAbbr
      if (!espnTeam) continue
      const qbs = teamQbs(liveBoxScore, espnTeam)
      if (!qbs.length) continue
      const byName = new Map(qbs.map((q) => [q.name, q]))
      const starter = byName.get(slot.effectiveName)
        ?? qbs.find((q) => namesMatch(q.name, slot.effectiveName)) ?? null
      const starterName = starter?.name ?? slot.effectiveName
      const prevActive = activeQbRef.current.get(espnTeam)
      let mover: string | null = null
      for (const q of qbs) {
        const prev = prevQbAttemptsRef.current.get(q.name) ?? 0
        if (q.attempts > prev) mover = q.name
        prevQbAttemptsRef.current.set(q.name, q.attempts)
      }
      if (mover && mover !== prevActive) {
        activeQbRef.current.set(espnTeam, mover)
      }
      const active = activeQbRef.current.get(espnTeam)
        ?? (starter ? starterName : qbs[0].name)
      if (!activeQbRef.current.get(espnTeam)) activeQbRef.current.set(espnTeam, active)
      stallRef.current.set(starterName, active === starterName ? 0 : (stallRef.current.get(starterName) ?? 0) + 1)
      const stall = stallRef.current.get(starterName) ?? 0

      // Swap-back: the starter is throwing again.
      if (next[starterName] && mover === starterName) {
        delete next[starterName]
        mutated = true
        continue
      }
      if (next[starterName]) continue // still out; backup already handled
      const flag = rosterFlagFor(starterName)
      const starterAtt = starter?.attempts ?? 0
      const activeQb = byName.get(active) ?? qbs.find((q) => namesMatch(q.name, active)) ?? null
      const injuryExit = !!flag && active !== starterName && stall >= 2
      const scratchExit = starterAtt === 0 && (activeQb?.attempts ?? 0) >= 8 && liveQuarters >= 2 && active !== starterName
      if ((injuryExit || scratchExit) && active) {
        next[starterName] = { backup: active, quarter: liveQuarters, teamEspn: espnTeam }
        mutated = true
        const teamCode = slot.team
        const oppCode = slot.opponent
        void runBackupProjection(active, teamCode, oppCode)
      }
    }
    if (mutated) {
      exitedQbsRef.current = next
      setExitedQbs(next)
    }
  }, [isLive, liveBoxScore, rosterInjuries, effectiveLineup, sport, teamAbbr, opponentAbbr])

  // The Odds API line (from /api/props when ODDS_API_KEY is set) — fallback
  // when the Docker scraper has nothing for this player/stat.
  const oddsApiLineFor = (name: string, stat: string): { line: number; book: string; over: number | null; under: number | null; books: number } | null => {
    const pos = props?.projections?.find((x) => x.name === name)?.position ?? ''
    const wantStat = stat === 'tds' ? (pos === 'QB' ? 'passing_tds' : null) : stat
    if (!wantStat) return null
    const want = normalizePlayerName(name)
    const player = props?.players?.find((pl) => normalizePlayerName(pl.name) === want)
    const hit = player?.props.find((x) => x.stat === wantStat && x.over != null && x.under != null)
    return hit ? { line: hit.line, book: props?.bookmaker ?? 'sportsbook', over: hit.over, under: hit.under, books: 1 } : null
  }

  // Scraped prop line for a model row: matches Action Network/Odds API props by
  // normalized player name + exact stat. Only real over/under lines qualify —
  // alternates ("25+ Rushing Yards"), milestones ("2+ Passing Touchdowns"),
  // combo markets ("Pass + Rush Yds") and odds-only markets ("Anytime TD
  // Scorer", "First Touchdown Scorer") carry no O/U odds and are excluded.
  // Prefers the Consensus line, else the median across books.
  const scrapedLineFor = (name: string, stat: string): { line: number; book: string; over: number | null; under: number | null; books: number } | null => {
    const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
    const want = norm(name)
    const all: { line: number; book: string; over: number | null; under: number | null }[] = []
    const results = scraperData?.results
    if (!results || typeof results !== 'object') return oddsApiLineFor(name, stat)
    // Model "tds" is total TDs. The only standard O/U TD market is passing TDs
    // (QBs); for RB/WR/TE there is no O/U total-TD line — anytime/first/last TD
    // are odds-only (line 0.0, no over/under). Map QB tds → passing_tds.
    const pos = props?.projections?.find((x) => x.name === name)?.position ?? ''
    const wantStats: string[] = (() => {
      if (stat === 'tds') return pos === 'QB' ? ['passing_tds'] : []
      if (stat === 'passing_yards') return ['passing_yards', 'pass_yds', 'pass_yards']
      if (stat === 'rushing_yards') return ['rushing_yards', 'rush_yds', 'rush_yards']
      if (stat === 'receiving_yards') return ['receiving_yards', 'rec_yds', 'rec_yards']
      if (stat === 'receptions') return ['receptions']
      return [stat]
    })()
    if (!wantStats.length) return oddsApiLineFor(name, stat)
    for (const b of Object.values(results) as any[]) {
      const list = (b as any)?.props
      if (!Array.isArray(list)) continue
      for (const p of list) {
        const s = (p?.stat ?? '').toLowerCase()
        if (!wantStats.includes(s)) continue
        // Real O/U line only: must carry both sides' odds and a positive line.
        if (typeof p?.line !== 'number' || p.line <= 0) continue
        if (p?.over == null || p?.under == null) continue
        // Belt-and-suspenders: drop alternate/combo/leader markets by name.
        const market = String(p?.market ?? '').toLowerCase()
        if (market.includes('+') || market.includes('most')) continue

        // Match player name. Token-based: every token of one name must appear
        // in the other (suffixes like Jr/Sr/III stripped). This rejects
        // shared-last-name collisions ("Bijan Robinson" vs "Brian Robinson")
        // while accepting "Michael Pittman" vs "Michael Pittman Jr".
        const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'junior', 'senior'])
        const wantToks = norm(name).split(' ').filter(Boolean).filter((w) => !SUFFIX.has(w))
        const scrapedToks = norm(p.player ?? '').split(' ').filter(Boolean).filter((w) => !SUFFIX.has(w))
        const scrapedName = scrapedToks.join(' ')
        const nameMatch = scrapedName === want
          || (wantToks.length > 0 && wantToks.every((w) => scrapedName.includes(w)))
          || (scrapedToks.length > 0 && scrapedToks.every((s) => want.includes(s)))
          // NFL abbrev: "T.Tagovailoa" → "ttagovailoa", drop the first char →
          // "tagovailoa" which matches "tua tagovailoa".
          || (wantToks.length === 1 && want.length > 3 && scrapedName.includes(want.slice(1)))
        if (nameMatch) {
          all.push({ line: p.line, book: p.sportsbook ?? '', over: p.over ?? null, under: p.under ?? null })
        }
      }
    }
    if (!all.length) return oddsApiLineFor(name, stat)
    // All entries are real O/U lines now — prefer Consensus, else the median.
    const cons = all.filter((p) => p.book.toLowerCase().includes('consensus'))
    const pickable = all
    const pick = cons.length ? cons[0] : [...pickable].sort((a, b) => a.line - b.line)[Math.floor(pickable.length / 2)]
    return { ...pick, books: new Set(pickable.map((p) => p.book)).size }
  }

  // Sort model rows QB → RB → WR → TE (same order as the player-lines tables),
  // using the ESPN projection positions the targets were built from, falling
  // back to the lineup slot (covers swapped-in contenders).
  const posFor = (name: string): number => {
    const p = props?.projections?.find((x) => x.name === name)?.position
      ?? effectiveLineup.find((s) => s.effectiveName === name)?.slotPos ?? ''
    const idx = POS_ORDER.indexOf(p.startsWith('WR') ? 'WR' : p)
    return idx === -1 ? 99 : idx
  }
  const sortedModel = [...(modelResults ?? [])].filter((r) => {
    // Only show model results for the effective lineup (Out starters are
    // replaced by their contender before the run).
    return effectiveNames.has(r.player)
  }).sort((a, b) => posFor(a.player) - posFor(b.player) || a.player.localeCompare(b.player))

  // ESPN line coverage per player: how many stats the player has ESPN projections for
  const espnCoverage = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>()
    const markets = ['passing_yards', 'rushing_yards', 'receiving_yards', 'receptions', 'tds']
    for (const p of (props?.projections ?? [])) {
      if (!map.has(p.name)) map.set(p.name, { count: 0, total: markets.length })
      const cov = map.get(p.name)!
      for (const line of p.lines) {
        const hasLine = line.value != null && line.value > 0
        if (markets.includes(line.label.replace(/ /g, '').toLowerCase()) || markets.some(m => line.label.toLowerCase().includes(m.split('_')[0]))) {
          if (hasLine) cov.count++
        }
      }
    }
    return map
  }, [props?.projections])

  // Group by player for the "player + sub-lines" view requested — one player header
  // with its modeled markets (yards / receptions / TDs) as sub-rows.
  const groupedModel: { player: string; rows: ModelProjection[] }[] = (() => {
    if (!sortedModel.length && !(backupProjections ?? []).length) return []
    const map = new Map<string, ModelProjection[]>()
    for (const r of sortedModel) {
      const list = map.get(r.player)
      if (list) list.push(r)
      else map.set(r.player, [r])
    }
    // Preserve the QB→WR sort via first occurrence in sortedModel
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const r of sortedModel) if (!seen.has(r.player)) { seen.add(r.player); ordered.push(r.player) }
    const groups = ordered.map((player) => ({ player, rows: map.get(player)! }))
    // Splice mid-game backup projections directly after the exited starter.
    for (const [starter, exit] of Object.entries(exitedQbs)) {
      const rows = (backupProjections ?? []).filter((r) => r.player === exit.backup)
      if (!rows.length || groups.some((g) => g.player === exit.backup)) continue
      const idx = groups.findIndex((g) => g.player === starter)
      if (idx >= 0) groups.splice(idx + 1, 0, { player: exit.backup, rows })
      else groups.push({ player: exit.backup, rows })
    }
    return groups
  })()

  // Data-vintage stamp from the model (max gameday in its input frame) — the
  // honest freshness signal, not when the run happened.
  const modelDataThrough = (() => {
    const stamps = (modelResults ?? [])
      .map((r) => r.last_updated)
      .filter((v): v is string => !!v)
      .map((v) => v.slice(0, 10))
      .sort()
    const iso = stamps[stamps.length - 1]
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
    return `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`
  })()

  // Only show refresh button when the model's data vintage changed since last run
  const showRefreshButton = modelRunDate != null && modelDataThrough != null && modelDataThrough !== prevModelDataThrough

  const confStyle = (conf: string) =>
    conf === 'high' ? 'text-fs-turf bg-fs-turf/15' : conf === 'medium' ? 'text-fs-gold bg-fs-gold/15' : 'text-fs-red bg-fs-red/15'

  // Pick for every modeled row with a real book line (shared by the table,
  // the "best edges" strip and the final scorecard).
  const pickFor = (r: ModelProjection) => {
    const book = scrapedLineFor(r.player, r.stat)
    if (!book || r.projection == null || r.pred_sd == null) return null
    const edge = computeOverUnderEdge(r.projection, r.pred_sd, book.line)
    return edge ? { book, edge } : null
  }

  const bestEdges = groupedModel
    .flatMap((g) => g.rows)
    .map((r) => ({ r, p: pickFor(r) }))
    .filter((x): x is { r: ModelProjection; p: NonNullable<ReturnType<typeof pickFor>> } => !!x.p && x.p.edge.pick !== 'fair')
    .sort((a, b) => pickConfidencePct(b.p.edge) - pickConfidencePct(a.p.edge))
    .slice(0, 3)

  // Final scorecard: frozen picks graded against the final box score.
  const scorecard = (() => {
    if (!gameFinal || !liveStats) return null
    let picks = 0
    let hits = 0
    let pushes = 0
    const errors: number[] = []
    for (const g of groupedModel) {
      for (const r of g.rows) {
        const actual = liveStats?.[r.player]?.[r.stat]
        if (actual == null || r.projection == null) continue
        errors.push(Math.abs(actual - r.projection))
        const p = pickFor(r)
        if (!p || p.edge.pick === 'fair') continue
        if (actual === p.book.line) { pushes++; continue }
        picks++
        if ((p.edge.pick === 'over') === (actual > p.book.line)) hits++
      }
    }
    if (!errors.length) return null
    return { picks, hits, pushes, graded: errors.length }
  })()

  const heading = phase === 'final' ? 'Model vs Final' : phase === 'live' ? 'Model vs Live' : 'Game Preview'
  const noSnapshot = phase === 'final' && isNfl && ledgerChecked && !ledger?.pre?.rows?.length
  if (hideWhenEmpty && (noSnapshot || (phase === 'final' && !isNfl))) return null

  // Non-NFL projection table: both teams on the team page, one per panel on the game page.
  const projectionTeamList = projectionTeams === 'ours'
    ? [{ abbr: teamAbbr, name: teamName }]
    : [{ abbr: teamAbbr, name: teamName }, { abbr: opponentAbbr, name: opponentName }]

  return (
    <div className="animate-fade-in-up mt-4 pt-3" style={{ borderTop: `1px solid ${teamColor}20` }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="fs-eyebrow" style={{ '--tint': teamColor } as React.CSSProperties}>{heading}</h3>
        {!compact ? (
        <button
          onClick={onBack}
          className="hover-bright text-xs px-2 py-1 rounded text-fs-muted hover:text-fs-text"
          style={{ backgroundColor: `${teamColor}15`, border: `1px solid ${teamColor}25`, '--card-color': teamColor } as React.CSSProperties}
        >
          &larr; Back
        </button>
        ) : null}
      </div>

      <p className="text-sm text-fs-muted mb-4">
        {teamName} <span className="text-fs-muted-2">vs</span> {opponentName}
        {eventDate ? <span className="text-fs-muted-2"> &middot; {eventDate.slice(4, 6)}/{eventDate.slice(6, 8)}/{eventDate.slice(0, 4)}</span> : null}
      </p>

      {/* Game odds: moneyline + spread + total (pre-game only — stale after kickoff) */}
      {!compact && phase === 'pre' && (odds ? (
        <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: `${teamColor}0a`, border: `1px solid ${teamColor}18` }}>
          <p className="fs-eyebrow mb-2" style={{ '--tint': teamColor } as React.CSSProperties}>Game Odds &middot; {odds.sportsbook}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-fs-muted-2 mb-1">Moneyline</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-fs-muted">{odds.our.abbr}</span><span className="font-mono text-fs-text">{formatPrice(odds.our.moneyline)}</span></div>
                <div className="flex justify-between"><span className="text-fs-muted">{odds.opponent.abbr}</span><span className="font-mono text-fs-text">{formatPrice(odds.opponent.moneyline)}</span></div>
              </div>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-fs-muted-2 mb-1">Spread</p>
              <p className="text-sm text-fs-text font-mono">{odds.spread != null ? `${odds.spread > 0 ? '+' : ''}${odds.spread}` : '—'}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-fs-muted-2 mb-1">Total</p>
              <p className="text-sm text-fs-text font-mono">{odds.overUnder != null ? `${odds.overUnder} O/U` : '—'}</p>
            </div>
          </div>
        </div>
      ) : oddsStatus === 'loading' ? (
        <div className="animate-pulse space-y-2 mb-4">
          <div className="fs-skeleton h-4 w-2/3" />
          <div className="fs-skeleton h-4 w-1/3" />
        </div>
      ) : (
        <p className="text-sm text-fs-muted-2 mb-4">
          {oddsStatus === 'no-game'
            ? 'Odds will appear once this game is posted on the board.'
            : oddsStatus === 'error'
              ? 'Odds are temporarily unavailable — check back soon.'
              : 'Odds not yet posted for this game.'}
        </p>
      ))}

      {/* Fantasy updates for star players */}
      {isNfl && !compact && phase === 'pre' && (
        <div>
          <p className="fs-eyebrow mb-2" style={{ '--tint': teamColor } as React.CSSProperties}>Fantasy Updates</p>
          {fantasyError && !ourStarters && !oppStarters ? (
            <p className="text-sm text-fs-muted">{fantasyError}</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 sm:gap-4 min-w-0">
              {[ourStarters, oppStarters].map((starters, si) => (
                <div key={si} className="rounded-lg p-3" style={{ backgroundColor: `${teamColor}0a`, border: `1px solid ${teamColor}16` }}>
                  <p className="text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: si === 0 ? teamColor : undefined, opacity: si === 0 ? 1 : 0.7 }}>
                    {si === 0 ? teamName : opponentName}
                  </p>
                  {!starters ? (
                    <div className="animate-pulse space-y-2">
                      <div className="fs-skeleton h-7" style={{ backgroundColor: `${teamColor}12` }} />
                      <div className="fs-skeleton h-7" style={{ backgroundColor: `${teamColor}12` }} />
                    </div>
                  ) : starters.length === 0 ? (
                    <p className="text-xs text-fs-muted-2">No outlook data</p>
                  ) : (
                    <div className="space-y-1.5">
                      {starters.map((s) => (
                        <div key={s.pos} className="flex items-baseline justify-between gap-2">
                          <div className="flex items-baseline gap-2 min-w-0">
                            <span className="fs-meta shrink-0">{slotLabel(s.pos)}</span>
                            <span className="text-sm text-fs-text/85 truncate">{s.player ? s.player.name : '—'}</span>
                            {s.player && INJURY_LABEL[s.player.injuryTier] && (
                              <span className="text-[11px] font-bold px-1 py-0.5 rounded shrink-0 text-fs-red bg-fs-red/15" title={s.player.injuryDetail}>
                                {INJURY_LABEL[s.player.injuryTier]}
                              </span>
                            )}
                          </div>
                          {s.player && s.player.projectedPoints > 0 && (
                            <span className="text-xs text-fs-muted shrink-0 tabular-nums fs-mono">{s.player.projectedPoints} FP</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!isNfl && (
        <PlayerProjections
          projections={(props?.projections ?? null) as ProjectionRow[] | null}
          bookPlayers={(props?.players ?? null) as BookPlayer[] | null}
          bookmaker={props?.bookmaker}
          teams={projectionTeamList}
          teamColor={teamColor}
          loading={props == null}
          matchup={props?.matchup ?? null}
        />
      )}

      {noSnapshot && (
        <p className="mt-4 text-sm text-fs-muted-2">
          No pre-game model snapshot was saved for this game, so there is nothing to grade. Snapshots are
          locked automatically when a game page is opened before kickoff.
        </p>
      )}

      {/* Prop Model projections (Python pipeline) */}
      {isNfl && !noSnapshot && (ourProjected.length > 0 || oppProjected.length > 0 || (phase !== 'pre' && (modelResults?.length ?? 0) > 0)) && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="fs-eyebrow" style={{ '--tint': teamColor } as React.CSSProperties}>Prop Model</p>
            <div>
            {modelLoading ? (
              <span className="text-xs font-semibold px-4 py-2 rounded-lg shadow-sm" style={{ backgroundColor: `${teamColor}20`, color: teamColor }}>
                Running…
              </span>
            ) : phase !== 'pre' ? (
              ledger?.pre ? <span className="text-xs text-fs-muted-2">Pre-game snapshot</span> : null
            ) : modelResults && showRefreshButton ? (
              <button
                onClick={runModel}
                className="hover-bright text-xs font-semibold px-4 py-2 rounded-lg text-fs-bg shadow-sm"
                style={{ backgroundColor: teamColor, '--card-color': teamColor } as React.CSSProperties}
              >
                ↻ Refresh (new data)
              </button>
            ) : modelResults ? (
              <span className="text-xs text-fs-muted-2">Current</span>
            ) : (
              <button
                onClick={runModel}
                className="hover-bright text-xs font-semibold px-4 py-2 rounded-lg text-fs-bg shadow-sm"
                style={{ backgroundColor: teamColor, '--card-color': teamColor } as React.CSSProperties}
              >
                ▶ Run model
              </button>
            )}
            </div>
          </div>
          
          <p className="text-xs text-fs-muted-2 mb-2">
            {phase === 'pre'
              ? 'Our projection per player (recent form × opponent defense × Vegas game script) against the sportsbook line.'
              : phase === 'live'
                ? 'Pre-game projections, locked before kickoff, against the live box score.'
                : 'Pre-game projections, locked before kickoff, graded against the final box score.'}
            {modelDataThrough ? <> · Data through {modelDataThrough}</> : null}
            {phase === 'live' ? (
              <>
                {' '}·{' '}
                <span className="font-bold text-fs-red">● LIVE{liveQuarters > 0 ? ` Q${liveQuarters}` : ''}</span>
                {liveStatusLabel ? <span> · {liveStatusLabel}</span> : null}
                {!ledger?.pre ? <span> · locking pre-game snapshot…</span> : null}
                {backupLoading ? <span> · projecting backup…</span> : null}
              </>
            ) : null}
          </p>

          {phase === 'pre' && bestEdges.length > 0 && !modelLoading ? (
            <div className="flex flex-wrap gap-2 mb-3" aria-label="Best edges">
              {bestEdges.map(({ r, p }) => {
                const st = EDGE_STYLES[p.edge.pick]
                return (
                  <span key={`${r.player}-${r.stat}`} className="rounded-lg px-2.5 py-1.5 text-xs" style={{ backgroundColor: `${teamColor}0c`, border: `1px solid ${teamColor}1c` }}>
                    <span className={`font-bold ${st.fg}`}>{st.label} {p.book.line}</span>{' '}
                    <span className="text-fs-text/85">{r.player.split(' ').slice(-1)[0]} {r.stat_label}</span>{' '}
                    <span className="text-fs-muted-2">· proj {r.projection} · {pickConfidencePct(p.edge)}%</span>
                  </span>
                )
              })}
            </div>
          ) : null}

          {scorecard ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: `${teamColor}0c`, border: `1px solid ${teamColor}1c` }}>
              <span className="text-fs-text font-semibold">
                Picks {scorecard.hits}/{scorecard.picks}
                {scorecard.picks > 0 ? ` (${Math.round((scorecard.hits / scorecard.picks) * 100)}%)` : ''}
              </span>
              {scorecard.pushes > 0 ? <span className="text-fs-muted">{scorecard.pushes} push{scorecard.pushes === 1 ? '' : 'es'}</span> : null}
              <span className="text-fs-muted">{scorecard.graded} projections graded</span>
            </div>
          ) : null}

          {showLive && !gameFinal ? (
            <p className="text-[11px] text-fs-muted-2 mb-2">
              Live column: stat so far, and how far ahead (+) or behind (−) the projection's pace it is.
            </p>
          ) : null}

          {modelLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="fs-skeleton h-7" style={{ backgroundColor: `${teamColor}12` }} />
              <div className="fs-skeleton h-7" style={{ backgroundColor: `${teamColor}12` }} />
            </div>
          ) : modelError ? (
            <div className="rounded-lg p-3 text-sm text-fs-red" style={{ backgroundColor: `${teamColor}08`, border: `1px solid ${teamColor}14` }}>
              {modelError}
            </div>
          ) : groupedModel.length > 0 ? (
            <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${teamColor}16` }}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-fs-muted-2" style={{ backgroundColor: `${teamColor}08` }}>
                    <th className="text-left px-2.5 py-1.5 font-medium">Player</th>
                    <th className="text-left px-2 py-1.5 font-medium">Stat</th>
                    <th className="text-right px-2 py-1.5 font-medium" title="Projection, with the likely range (25th–75th percentile) underneath">Proj</th>
                    <th className="text-right px-2 py-1.5 font-medium">Line</th>
                    <th className="text-right px-2 py-1.5 font-medium">Pick</th>
                    {showLive ? (
                      <th className="text-right px-2 py-1.5 font-medium">{gameFinal ? 'Final' : 'Live'}</th>
                    ) : null}
                    <th className="text-right px-2.5 py-1.5 font-medium">Conf</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedModel.map((group) =>
                    group.rows.map((r, idx) => {
                      const scraped = scrapedLineFor(r.player, r.stat)
                      const isFirst = idx === 0
                      const pick = pickFor(r)
                      return (
                        <tr
                          key={`${r.player}-${r.stat}`}
                          className="text-fs-text/75"
                          style={{
                            borderTop: isFirst ? `1px solid ${teamColor}16` : `1px solid ${teamColor}0c`,
                            backgroundColor: isFirst ? `${teamColor}04` : undefined,
                          }}
                        >
                          {isFirst ? (
                            <td
                              rowSpan={group.rows.length}
                              className="px-2.5 py-2 align-top whitespace-nowrap border-r"
                              style={{ borderColor: `${teamColor}10`, backgroundColor: `${teamColor}06` }}
                            >
                              <span className="font-medium text-fs-text/90">{group.player}</span>
                              <span className="block text-[10px] text-fs-muted-2">
                                {props?.projections?.find((x) => x.name === group.player)?.position
                                  ?? effectiveLineup.find((s) => s.effectiveName === group.player)?.slotPos
                                  ?? (Object.values(exitedQbs).some((e) => e.backup === group.player) ? 'QB' : '')}
                              </span>
                              {(() => {
                                const isOut = !!exitedQbs[group.player]
                                const isBackup = Object.values(exitedQbs).some((e) => e.backup === group.player)
                                const sub = effectiveLineup.find((s) => s.effectiveName === group.player)?.substituteFor
                                const flag = rosterFlagFor(group.player)
                                if (!isOut && !isBackup && !sub && !flag) return null
                                return (
                                  <span className="mt-0.5 flex flex-wrap gap-1">
                                    {isOut ? (
                                      <span className="px-1.5 py-px rounded text-[10px] font-bold bg-fs-red/15 text-fs-red">EXITED</span>
                                    ) : null}
                                    {isBackup ? (
                                      <span className="px-1.5 py-px rounded text-[10px] font-bold bg-fs-turf/15 text-fs-turf">IN · BACKUP</span>
                                    ) : null}
                                    {sub && !isBackup ? (
                                      <span className="px-1.5 py-px rounded text-[10px] text-fs-gold bg-fs-gold/15" title={`Starting for ${sub} (out)`}>
                                        FOR {sub.split(' ').pop()?.toUpperCase()}
                                      </span>
                                    ) : null}
                                    {flag ? (
                                      <span className="px-1.5 py-px rounded text-[10px] text-fs-muted bg-white/5" title={`${flag.status}${flag.date ? ` · ${flag.date}` : ''}`}>
                                        {flag.status.toUpperCase().slice(0, 4)}
                                      </span>
                                    ) : null}
                                  </span>
                                )
                              })()}
                            </td>
                          ) : null}
                          <td className="px-2 py-1.5 text-fs-muted" title={r.note ?? undefined}>
                            {r.stat_label}
                          </td>
                          <td
                            className="px-2 py-1.5 text-right font-mono tabular-nums text-fs-text"
                            title={[
                              r.p10 != null ? `p10 ${r.p10} · p25 ${r.p25} · p50 ${r.p50} · p75 ${r.p75} · p90 ${r.p90}` : null,
                              r.refused_reason,
                            ].filter(Boolean).join(' · ') || undefined}
                          >
                            {r.projection != null ? r.projection : <span className="text-fs-muted-2" title={r.refused_reason ?? undefined}>n/a</span>}
                            {r.projection != null && (r.p25 != null && r.p75 != null ? (
                              <span className="block text-[10px] text-fs-muted-2">{r.p25}–{r.p75}</span>
                            ) : r.low != null && r.high != null ? (
                              <span className="block text-[10px] text-fs-muted-2">{r.low}–{r.high}</span>
                            ) : null)}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-fs-muted" title={
                            scraped
                              ? `${scraped.book} · over ${scraped.over ?? '—'} / under ${scraped.under ?? '—'} · ${scraped.books} book${scraped.books === 1 ? '' : 's'}`
                              : (!scraperData
                                ? 'Scrape pending…'
                                : (r.stat === 'tds' && (props?.projections?.find((x) => x.name === r.player)?.position ?? '') !== 'QB'
                                  ? 'No O/U total-TD line is posted for non-QBs — books only price anytime/first/last TD as odds.'
                                  : 'No scraped line for this market — the books have no O/U posted for this player/stat.'))
                          }>
                            {scraped != null ? scraped.line : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                            {pick ? (() => {
                              const st = EDGE_STYLES[pick.edge.pick]
                              const pct = pickConfidencePct(pick.edge)
                              return (
                                <span
                                  className={`text-[11px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${pick.edge.strong ? st.strongBg : st.bg} ${pick.edge.strong ? st.strongFg : st.fg}`}
                                  title={`${st.label} vs ${pick.book.book} ${pick.book.line}: ${pct}% · projection ${pick.edge.edge > 0 ? '+' : ''}${pick.edge.edge.toFixed(1)} ${r.unit} vs line`}
                                >
                                  {st.label} {pct}%
                                </span>
                              )
                            })() : <span className="text-fs-muted-2">—</span>}
                          </td>
                          {showLive ? (
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums" title={
                              liveStatusLabel ? `ESPN box score · ${liveStatusLabel}` : 'ESPN box score'
                            }>
                              {(() => {
                                const lv = liveStats?.[r.player]?.[r.stat]
                                if (lv == null) return <span className="text-fs-muted-2">—</span>
                                if (gameFinal) {
                                  // Post-game: final actual, and whether the pick cashed.
                                  const graded = pick && pick.edge.pick !== 'fair'
                                    ? (lv === pick.book.line ? 'PUSH' : (pick.edge.pick === 'over') === (lv > pick.book.line) ? 'HIT' : 'MISS')
                                    : null
                                  return (
                                    <>
                                      <span className="text-fs-text">{lv}</span>
                                      {graded ? (
                                        <span className={`block text-[10px] font-bold ${graded === 'HIT' ? 'text-fs-turf' : graded === 'MISS' ? 'text-fs-red' : 'text-fs-muted'}`}>
                                          {graded}
                                        </span>
                                      ) : null}
                                    </>
                                  )
                                }
                                // Live: accumulated so far + delta vs expected pace
                                // (expected = model × quarters-played/4).
                                const frac = Math.min(Math.max(liveQuarters, 1), 4) / 4
                                const expected = r.projection != null ? r.projection * frac : null
                                const delta = expected != null ? lv - expected : null
                                return (
                                  <>
                                    <span className="text-fs-text">{lv}</span>
                                    {delta != null && (
                                      <span
                                        className={`block text-[10px] tabular-nums ${delta >= 0 ? 'text-fs-turf' : 'text-fs-red'}`}
                                        title={`expected ${expected!.toFixed(1)} by Q${liveQuarters} (model × ${frac.toFixed(2)})`}
                                      >
                                        {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                                      </span>
                                    )}
                                  </>
                                )
                              })()}
                            </td>
                          ) : null}
                          <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                            <span
                              className={`text-[11px] font-bold px-2 py-0.5 rounded ${confStyle(r.confidence)}`}
                              title={[
                                r.reliability != null ? `reliability ${r.reliability}/100` : null,
                                `${r.n_games} games of history`,
                                r.role_factor != null && Math.abs(r.role_factor - 1) > 0.08 ? `role ${r.role_factor > 1 ? '+' : ''}${((r.role_factor - 1) * 100).toFixed(0)}%` : null,
                                ...(Array.isArray(r.warnings) ? r.warnings : []),
                              ].filter(Boolean).join(' · ')}
                            >
                              {r.confidence.toUpperCase()}
                            </span>
                            {Array.isArray(r.warnings) && r.warnings.length > 0 ? (
                              <span className="ml-1 text-fs-gold" title={r.warnings.join('; ')}>⚠</span>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : modelResults && modelResults.length === 0 ? (
            <p className="text-sm text-fs-muted-2">No projections returned.</p>
          ) : null}

          {/* Scraped sportsbook lines — collapsed by default, pre-game only */}
          {phase === 'pre' && (
          <div className="mt-2 rounded-lg overflow-hidden" style={{ border: `1px solid ${teamColor}16` }}>
            <button
              onClick={() => setShowScraper((v) => !v)}
              className="hover-bright w-full flex items-center justify-between gap-2 px-3 py-2 text-xs"
              style={{ backgroundColor: `${teamColor}08`, '--card-color': teamColor } as React.CSSProperties}
            >
              <span className="text-fs-muted">
                {scraperLoading ? (
                  'Scraping lines…'
                ) : scraperData ? (
                  <>Scraped lines · <span className="font-mono text-fs-text">{scraperData.totalProps || 0} props</span> · {Object.keys(scraperData.results || {}).length} books</>
                ) : scraperError ? (
                  <span className="text-fs-red">Scraped lines · failed</span>
                ) : (
                  'Scraped lines'
                )}
              </span>
              <span className="text-fs-muted-2">{showScraper ? '▾' : '▸'}</span>
            </button>
            {showScraper && (
              <div className="px-3 py-2 text-xs" style={{ borderTop: `1px solid ${teamColor}12` }}>
                {scraperLoading ? (
                  <span className="text-fs-muted-2">⏳ Auto-scraping…</span>
                ) : scraperData ? (
                  <>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-fs-green font-medium">✓ Scraped {scraperData.totalProps || 0} props</span>
                      <span className="text-fs-muted-2">
                        {scraperData.scrapeTime ? new Date(scraperData.scrapeTime).toLocaleTimeString() : ''}
                      </span>
                    </div>
                    {Object.entries(scraperData.results || {}).map(([book, data]: [string, any]) => (
                      <div key={book} className="flex items-center gap-2 mb-1">
                        <span className="font-medium capitalize">{book}:</span>
                        <span>{data.count || 0} props</span>
                        {data.error && (
                          <span className="text-fs-muted-2 truncate" title={data.error}>
                            · {data.error}
                          </span>
                        )}
                        {data.timestamp && (
                          <span className="text-fs-muted-2 ml-auto">
                            {new Date(data.timestamp).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    ))}
                    {(scraperData.totalProps ?? 0) === 0 && (
                      <p className="text-fs-muted-2 mt-1">
                        No lines came back — books block datacenter IPs and the free fallback found nothing. Set ODDS_API_KEY for Odds API lines.
                      </p>
                    )}
                  </>
                ) : scraperError ? (
                  <span className="text-fs-red">{scraperError}</span>
                ) : (
                  <span className="text-fs-muted-2">Scraping next game…</span>
                )}
              </div>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  )
}
