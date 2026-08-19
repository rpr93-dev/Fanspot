'use client'

import { useEffect, useState } from 'react'

interface PropLine {
  market: string
  label: string
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
  lines: { label: string; value: number }[]
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
  confidence: string
  n_games: number
  opponent_factor: number | null
  script_factor: number | null
  refused_reason: string | null
  note: string | null
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

function formatPrice(p: number | null): string {
  if (p == null) return '—'
  return p > 0 ? `+${p}` : `${p}`
}

/** Stat columns shown per position group in the projected-lines tables. */
const PROJ_COLUMNS: Record<string, { label: string; stat: string }[]> = {
  QB: [
    { label: 'Pass Yds', stat: 'Pass Yds' },
    { label: 'Pass TDs', stat: 'Pass TDs' },
    { label: 'Rush Yds', stat: 'Rush Yds' },
  ],
  RB: [
    { label: 'Rush Yds', stat: 'Rush Yds' },
    { label: 'Rush Att', stat: 'Rush Att' },
    { label: 'Rec Yds', stat: 'Rec Yds' },
    { label: 'Rec', stat: 'Receptions' },
  ],
  WR: [
    { label: 'Rec Yds', stat: 'Rec Yds' },
    { label: 'Rec', stat: 'Receptions' },
    { label: 'Rec TDs', stat: 'Rec TDs' },
  ],
  TE: [
    { label: 'Rec Yds', stat: 'Rec Yds' },
    { label: 'Rec', stat: 'Receptions' },
    { label: 'Rec TDs', stat: 'Rec TDs' },
  ],
}

const POS_ORDER = ['QB', 'RB', 'WR', 'TE']

/** Split (already position-sorted) players into QB/RB/WR/TE groups (betting-props
 *  positions like "WR/TE" normalize to WR; unknown positions land in "Other"). */
function groupByPos<T extends { position: string | null }>(players: T[]): { pos: string; players: T[] }[] {
  const map = new Map<string, T[]>()
  for (const p of players) {
    let key = p.position || 'Other'
    if (key.startsWith('WR')) key = 'WR'
    if (!POS_ORDER.includes(key)) key = 'Other'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(p)
  }
  const order = [...POS_ORDER]
  if (map.has('Other')) order.push('Other')
  return order.filter((o) => map.has(o)).map((o) => ({ pos: o, players: map.get(o)! }))
}

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
  isPreseason,
  onBack,
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
  isPreseason?: boolean
  onBack: () => void
}) {
  const [props, setProps] = useState<PropsResponse | null>(null)
  const [propsLoading, setPropsLoading] = useState(true)
  const [ourStarters, setOurStarters] = useState<Starter[] | null>(null)
  const [oppStarters, setOppStarters] = useState<Starter[] | null>(null)
  const [fantasyError, setFantasyError] = useState<string | null>(null)

  // Matchup context from the game odds the dashboard already fetched: pass the Vegas
  // total + spread along so the API can make the projected lines matchup-aware.
  const total = typeof odds?.overUnder === 'number' ? odds.overUnder : null
  const spread = typeof odds?.spread === 'number' ? odds.spread : null

  useEffect(() => {
    let cancelled = false
    setPropsLoading(true)
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
      .finally(() => { if (!cancelled) setPropsLoading(false) })
    return () => { cancelled = true }
  }, [sport, teamAbbr, opponentAbbr, eventId, eventDate, isPreseason, total, spread])

  // Fantasy updates for both teams' star players (starters at each position).
  useEffect(() => {
    if (sport.toUpperCase() !== 'NFL') return
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
  }, [sport, teamFantasyAbbr, opponentFantasyAbbr])

  const ourProps = props?.players?.filter((p) => p.team === teamAbbr) ?? []
  const oppProps = props?.players?.filter((p) => p.team === opponentAbbr) ?? []
  const ungrouped = props?.players?.filter((p) => !p.team) ?? []
  const ourProjected = props?.projections?.filter((p) => p.team === teamAbbr) ?? []
  const oppProjected = props?.projections?.filter((p) => p.team === opponentAbbr) ?? []
  const showBettingProps = props?.available === true && (ourProps.length > 0 || oppProps.length > 0)
  const showProjected = !showBettingProps && (ourProjected.length > 0 || oppProjected.length > 0)

  // ---- Prop Model (Python pipeline) ----
  const [modelResults, setModelResults] = useState<ModelProjection[] | null>(null)
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)

  const statForPos = (pos: string | null): string => {
    const p = (pos ?? '').toUpperCase()
    if (p === 'QB') return 'passing_yards'
    if (p === 'RB') return 'rushing_yards'
    if (p === 'WR' || p === 'TE') return 'receiving_yards'
    return ''
  }

  const modelTeamCodes = () => ({
    our: (teamFantasyAbbr || teamAbbr || '').toUpperCase(),
    opp: (opponentFantasyAbbr || opponentAbbr || '').toUpperCase(),
  })

  const buildTargets = (): { player: string; stat: string; team: string; opponent: string; prior?: number }[] => {
    const codes = modelTeamCodes()
    const out: { player: string; stat: string; team: string; opponent: string; prior?: number }[] = []
    const add = (players: { name: string; position: string }[], team: string, opponent: string) => {
      for (const p of players.slice(0, 6)) {
        const stat = statForPos(p.position)
        if (!stat) continue
        // ESPN projected line as a prior: lets rookies / thin-history players
        // project instead of refusing (the model still wins when it has data).
        const prior = espnLineFor(p.name, stat)
        out.push({ player: p.name, stat, team, opponent, prior: prior ?? undefined })
      }
    }
    add(ourProjected, codes.our, codes.opp)
    add(oppProjected, codes.opp, codes.our)
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
        body: JSON.stringify({ targets, lines: buildLines(), preseason: !!isPreseason }),
        signal: AbortSignal.timeout(180000),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Model API returned ${res.status}`)
      setModelResults(Array.isArray(json.projections) ? json.projections : [])
    } catch (e: any) {
      setModelError(e?.message ?? 'Model run failed')
    } finally {
      setModelLoading(false)
    }
  }

  const espnLineFor = (name: string, stat: string): number | null => {
    const label = { passing_yards: 'Pass Yds', rushing_yards: 'Rush Yds', receiving_yards: 'Rec Yds' }[stat]
    if (!label) return null
    const p = props?.projections?.find((x) => x.name === name)
    return p?.lines.find((l) => l.label === label)?.value ?? null
  }

  // Sort model rows QB → RB → WR → TE (same order as the player-lines tables),
  // using the ESPN projection positions the targets were built from.
  const posFor = (name: string): number => {
    const p = props?.projections?.find((x) => x.name === name)?.position ?? ''
    const idx = POS_ORDER.indexOf(p.startsWith('WR') ? 'WR' : p)
    return idx === -1 ? 99 : idx
  }
  const sortedModel = [...(modelResults ?? [])].sort((a, b) => posFor(a.player) - posFor(b.player) || a.player.localeCompare(b.player))

  const confBadge = (conf: string) => {
    if (conf === 'high') return 'text-fs-turf bg-fs-turf/15'
    if (conf === 'medium') return 'text-fs-gold bg-fs-gold/15'
    return 'text-fs-red bg-fs-red/15'
  }

  return (
    <div className="animate-fade-in-up mt-4 pt-3" style={{ borderTop: `1px solid ${teamColor}20` }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="fs-eyebrow" style={{ '--tint': teamColor } as React.CSSProperties}>Next Game Preview</h3>
        <div className="flex items-center gap-2">
          {sport.toUpperCase() === 'NFL' && (ourProjected.length > 0 || oppProjected.length > 0) && (
            <button
              onClick={runModel}
              disabled={modelLoading}
              className="hover-bright text-xs font-semibold px-4 py-2 rounded-lg text-fs-bg disabled:opacity-50 shadow-sm"
              style={{ backgroundColor: teamColor, '--card-color': teamColor } as React.CSSProperties}
            >
              {modelLoading ? 'Running…' : modelResults ? '↻ Re-run model' : '▶ Run model'}
            </button>
          )}
          <button
            onClick={onBack}
            className="hover-bright text-xs px-2 py-1 rounded text-fs-muted hover:text-fs-text"
            style={{ backgroundColor: `${teamColor}15`, border: `1px solid ${teamColor}25`, '--card-color': teamColor } as React.CSSProperties}
          >
            &larr; Back
          </button>
        </div>
      </div>

      <p className="text-sm text-fs-muted mb-4">
        {teamName} <span className="text-fs-muted-2">vs</span> {opponentName}
        {eventDate ? <span className="text-fs-muted-2"> &middot; {eventDate.slice(4, 6)}/{eventDate.slice(6, 8)}/{eventDate.slice(0, 4)}</span> : null}
      </p>

      {/* Game odds: moneyline + spread + total */}
      {odds ? (
        <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: `${teamColor}0a`, border: `1px solid ${teamColor}18` }}>
          <p className="text-xs font-medium uppercase tracking-wider text-fs-muted mb-2">Game Odds &middot; {odds.sportsbook}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
      ) : (
        <p className="text-sm text-fs-muted-2 mb-4">Odds not yet posted for this game.</p>
      )}

      {/* Player props */}
      <div className="mb-4">
        <p className="fs-eyebrow mb-2" style={{ '--tint': teamColor } as React.CSSProperties}>Player Lines</p>
        {propsLoading ? (
          <div className="animate-pulse space-y-2">
            <div className="fs-skeleton h-8" style={{ backgroundColor: `${teamColor}14` }} />
            <div className="fs-skeleton h-8" style={{ backgroundColor: `${teamColor}14` }} />
          </div>
        ) : showProjected ? (
          <>
            <p className="text-xs text-fs-muted-2 mb-2">
              {isPreseason ? 'Preseason-adjusted' : 'Projected'} per-game lines from ESPN fantasy projections
              {props?.matchup ? (
                <> &middot; matchup-adjusted via Vegas total {props.matchup.total} ({teamName} {props.matchup.ourTotal} pts, {opponentName} {props.matchup.oppTotal} pts implied)</>
              ) : null}
              &nbsp;(betting props not posted).
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[ourProjected, oppProjected].map((group, gi) => {
                if (!group.length) return null
                const posGroups = groupByPos(group)
                return (
                  <div key={gi}>
                    <p className="text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: gi === 0 ? teamColor : undefined, opacity: gi === 0 ? 1 : 0.7 }}>
                      {gi === 0 ? teamName : opponentName}
                    </p>
                    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${teamColor}16` }}>
                      {posGroups.map((g) => {
                        const cols = PROJ_COLUMNS[g.pos] ?? []
                        return (
                          <div key={g.pos} className="border-t first:border-t-0" style={{ borderColor: `${teamColor}12` }}>
                            <div className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-fs-muted-2" style={{ backgroundColor: `${teamColor}0a` }}>
                              {g.pos === 'Other' ? 'Other' : `${g.pos}s`}
                            </div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-fs-muted-2">
                                  <th className="text-left px-2.5 py-1.5 font-medium">Player</th>
                                  {cols.map((c) => (
                                    <th key={c.stat} className="text-right px-2 py-1.5 font-medium tabular-nums">{c.label}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {g.players.map((p) => (
                                  <tr key={p.name} className="text-fs-text/75" style={{ borderTop: `1px solid ${teamColor}0c` }}>
                                    <td className="px-2.5 py-1.5 font-medium text-fs-text/90 whitespace-nowrap">{p.name}</td>
                                    {cols.map((c) => {
                                      const v = p.lines.find((l) => l.label === c.stat)?.value
                                      return (
                                        <td key={c.stat} className="px-2 py-1.5 text-right font-mono tabular-nums">
                                          {v != null && v > 0 ? v : '—'}
                                        </td>
                                      )
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        ) : !props?.available ? (
          <div className="rounded-lg p-4 text-sm text-fs-muted" style={{ backgroundColor: `${teamColor}08`, border: `1px solid ${teamColor}14` }}>
            {props?.reason === 'no-api-key'
              ? 'Player prop lines are not configured yet (ODDS_API_KEY missing).'
              : props?.reason === 'no-props'
                ? 'Player props not posted for this game yet — check back closer to kickoff.'
                : 'Player prop lines are unavailable for this game.'}
          </div>
        ) : (
          <div className="space-y-4">
            {[ourProps, oppProps, ungrouped].map((group, gi) => {
              if (!group.length) return null
              const isOur = gi === 0
              const isOpp = gi === 1
              const label = isOur ? teamName : isOpp ? opponentName : 'Other'
              const posGroups = groupByPos(group)
              return (
                <div key={gi}>
                  <p className="text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: isOur ? teamColor : undefined, opacity: isOur || isOpp ? 1 : 0.6 }}>
                    {label} {props?.bookmaker ? <span className="text-fs-muted-2 normal-case">· {props.bookmaker}</span> : null}
                  </p>
                  <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${teamColor}16` }}>
                    {posGroups.map((g) => (
                      <div key={g.pos} className="border-t first:border-t-0" style={{ borderColor: `${teamColor}12` }}>
                        <div className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-fs-muted-2" style={{ backgroundColor: `${teamColor}0a` }}>
                          {g.pos === 'Other' ? 'Other' : `${g.pos}s`}
                        </div>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-fs-muted-2">
                              <th className="text-left px-2.5 py-1.5 font-medium">Player</th>
                              <th className="text-left px-2 py-1.5 font-medium">Line</th>
                              <th className="text-right px-2 py-1.5 font-medium">Over</th>
                              <th className="text-right px-2.5 py-1.5 font-medium">Under</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.players.map((p) =>
                              p.props.map((prop, pi) => (
                                <tr key={`${p.name}-${prop.market}`} className="text-fs-text/75" style={pi % 2 === 1 ? { backgroundColor: `${teamColor}05` } : undefined}>
                                  {pi === 0 ? (
                                    <td className="px-2.5 py-1 font-medium text-fs-text/90 whitespace-nowrap" rowSpan={p.props.length}>
                                      {p.name}
                                    </td>
                                  ) : null}
                                  <td className="px-2 py-1 whitespace-nowrap">
                                    {prop.label} <span className="font-mono text-fs-text">{prop.line}</span>
                                  </td>
                                  <td className="px-2 py-1 text-right font-mono tabular-nums">{formatPrice(prop.over)}</td>
                                  <td className="px-2.5 py-1 text-right font-mono tabular-nums">{formatPrice(prop.under)}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Fantasy updates for star players */}
      {sport.toUpperCase() === 'NFL' && (
        <div>
          <p className="fs-eyebrow mb-2" style={{ '--tint': teamColor } as React.CSSProperties}>Fantasy Updates</p>
          {fantasyError && !ourStarters && !oppStarters ? (
            <p className="text-sm text-fs-muted">{fantasyError}</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

      {/* Prop Model projections (Python pipeline) */}
      {sport.toUpperCase() === 'NFL' && (ourProjected.length > 0 || oppProjected.length > 0) && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="fs-eyebrow" style={{ '--tint': teamColor } as React.CSSProperties}>Prop Model</p>
            {modelResults && modelResults.length > 0 && (
              <button
                onClick={runModel}
                disabled={modelLoading}
                className="hover-bright text-[11px] font-semibold px-3 py-1.5 rounded-lg text-fs-bg disabled:opacity-50"
                style={{ backgroundColor: teamColor, '--card-color': teamColor } as React.CSSProperties}
              >
                {modelLoading ? 'Running…' : '↻ Re-run'}
              </button>
            )}
          </div>
          <p className="text-xs text-fs-muted-2 mb-2">
            {modelResults
              ? 'Our own projection from the Python model: recent games × opponent defense × game script (nflverse weekly stats).'
              : 'Own projection from recent games, opponent defense, and the Vegas game script — compare against the ESPN lines above.'}
          </p>

          {modelLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="fs-skeleton h-7" style={{ backgroundColor: `${teamColor}12` }} />
              <div className="fs-skeleton h-7" style={{ backgroundColor: `${teamColor}12` }} />
            </div>
          ) : modelError ? (
            <div className="rounded-lg p-3 text-sm text-fs-red" style={{ backgroundColor: `${teamColor}08`, border: `1px solid ${teamColor}14` }}>
              {modelError}
            </div>
          ) : sortedModel && sortedModel.length > 0 ? (
            <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${teamColor}16` }}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-fs-muted-2" style={{ backgroundColor: `${teamColor}08` }}>
                    <th className="text-left px-2.5 py-1.5 font-medium">Player</th>
                    <th className="text-left px-2 py-1.5 font-medium">Stat</th>
                    <th className="text-right px-2 py-1.5 font-medium">Model</th>
                    <th className="text-right px-2 py-1.5 font-medium">ESPN line</th>
                    <th className="text-right px-2 py-1.5 font-medium">68% Range</th>
                    <th className="text-right px-2.5 py-1.5 font-medium">Conf</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedModel.map((r) => {
                    const espnLine = espnLineFor(r.player, r.stat)
                    return (
                      <tr key={`${r.player}-${r.stat}`} className="text-fs-text/75" style={{ borderTop: `1px solid ${teamColor}0c` }}>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">
                          <span className="font-medium text-fs-text/90">{r.player}</span>
                          {r.note ? (
                            <span className="block text-[10px] text-fs-muted-2" title={r.note}>{r.note}</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-fs-muted">{r.stat_label}</td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-fs-text">
                          {r.projection != null ? r.projection : <span className="text-fs-muted-2">refused</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-fs-muted">
                          {espnLine != null ? espnLine : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-fs-muted">
                          {r.low != null && r.high != null ? `${r.low}–${r.high}` : '—'}
                        </td>
                        <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                          <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${confBadge(r.confidence)}`}>
                            {r.confidence.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : modelResults && modelResults.length === 0 ? (
            <p className="text-sm text-fs-muted-2">No projections returned.</p>
          ) : null}
        </div>
      )}
    </div>
  )
}
