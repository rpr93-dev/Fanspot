'use client'

import { Fragment } from 'react'
import { teams } from '@/data/teams'
import { teamStatLabels } from '@/lib/roster-stats'
import { adjustForDarkTheme } from '@/lib/fantasy/team-theme'
import { formatDownDistance, formatLastPlayMeta, type LastPlay } from '@/lib/lastPlay'
import {
  barShares,
  isMissingRow,
  parseCompoundPart,
  parseStatNumeric,
  type StatComparisonInput,
} from './stat-value'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface BoxScoreTeam {
  abbreviation: string
  displayName?: string
  logo?: string
  homeAway?: string
  score?: { displayValue?: string } | string
  linescores?: number[]
  statistics?: { name: string; displayValue: string; abbreviation?: string }[]
}

export interface BoxScoreStatus {
  state?: string
  completed?: boolean
  description?: string
  detail?: string
  shortDetail?: string
}

function scoreText(score: BoxScoreTeam['score']): string | null {
  if (score == null) return null
  if (typeof score === 'object') {
    const v = score.displayValue
    return v == null || v === '' ? null : String(v)
  }
  return String(score) === '' ? null : String(score)
}

/** Brand color for a team abbr, lightened for the dark theme. Falls back to neutral. */
export function teamAccent(sport: string, abbr: string, slot: 'primary' | 'secondary'): string {
  const team = teams.find(
    (t) =>
      t.sport === sport.toUpperCase() &&
      (t.abbreviation.toUpperCase() === abbr.toUpperCase() || t.id.toUpperCase() === abbr.toUpperCase()),
  )
  const hex = slot === 'primary' ? team?.colors.primary : team?.colors.secondary
  if (!hex) return slot === 'primary' ? '#8a9990' : '#5e6c63'
  try {
    return adjustForDarkTheme(hex)
  } catch {
    return hex
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  if (!Number.isFinite(n) || full.length !== 6) return [138, 153, 144]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Euclidean RGB distance, 0 (identical) to ~441 (black vs white). */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

/** Below this the two bars read as the same color (e.g. NE navy vs SEA navy). */
export const MIN_BAR_COLOR_DISTANCE = 100

/**
 * Bar colors for a matchup. Prefers each team's primary, but when the
 * primaries clash the away side falls back to its secondary (the common
 * same-color case); if that still clashes, the best-separated of the four
 * primary/secondary pairings wins so the two sides are always tellable apart.
 */
export function resolveBarColors(
  sport: string,
  awayAbbr: string,
  homeAbbr: string,
): { awayColor: string; homeColor: string } {
  const awayPrimary = teamAccent(sport, awayAbbr, 'primary')
  const awaySecondary = teamAccent(sport, awayAbbr, 'secondary')
  const homePrimary = teamAccent(sport, homeAbbr, 'primary')
  const homeSecondary = teamAccent(sport, homeAbbr, 'secondary')

  const pairings: { awayColor: string; homeColor: string }[] = [
    { awayColor: awayPrimary, homeColor: homePrimary },
    { awayColor: awaySecondary, homeColor: homePrimary },
    { awayColor: awayPrimary, homeColor: homeSecondary },
    { awayColor: awaySecondary, homeColor: homeSecondary },
  ]
  const clear = pairings.find(
    (p) => colorDistance(p.awayColor, p.homeColor) >= MIN_BAR_COLOR_DISTANCE,
  )
  if (clear) return clear
  // Best effort: the most-separated pairing available.
  let best = pairings[0]
  let bestDist = -1
  for (const p of pairings) {
    const d = colorDistance(p.awayColor, p.homeColor)
    if (d > bestDist) {
      bestDist = d
      best = p
    }
  }
  return best
}

function prettifyName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()
}

export function statLabel(name: string): string {
  return teamStatLabels[name] ?? prettifyName(name)
}

/* ------------------------------------------------------------------ */
/* Sport-aware shaping: order, short labels, clean compound values     */
/* ------------------------------------------------------------------ */

/**
 * ESPN compound team-stat keys whose "A-B" display should read as "A–B"
 * (shooting splits, sacks+yards, penalties+yards). `part` also decides
 * which side of the compound sizes the comparison bar.
 */
const COMPOUND_META: Record<string, { label: string; part: 'first' | 'second' }> = {
  'fieldGoalsMade-fieldGoalsAttempted': { label: 'FG', part: 'first' },
  'threePointFieldGoalsMade-threePointFieldGoalsAttempted': { label: '3PT', part: 'first' },
  'freeThrowsMade-freeThrowsAttempted': { label: 'FT', part: 'first' },
  completionAttempts: { label: 'C/ATT', part: 'first' },
  sacksYardsLost: { label: 'Sacks-Yds', part: 'first' },
  totalPenaltiesYards: { label: 'Pen-Yds', part: 'second' },
  penaltyYards: { label: 'Pen Yds', part: 'second' },
}

/** Short label for a team-stat key when one is known; null falls through. */
function compoundLabel(name: string): string | null {
  return COMPOUND_META[name]?.label ?? null
}

/**
 * Short, lowercase-friendly stat labels for the compact head-to-head table.
 * Basketball compound keys resolve here; the rest use teamStatLabels.
 */
function shortStatLabel(name: string): string {
  return compoundLabel(name) ?? teamStatLabels[name] ?? prettifyName(name)
}

/** "13-16" -> "13–16" (en dash) for compound shooting/penalty displays. */
function compoundDisplay(name: string, display: string): string {
  if (!COMPOUND_META[name]) return display
  return display.includes('–') ? display : display.replace(/(\d+)\s*-\s*(\d+)/, '$1–$2')
}

/** Basketball-first row order for the compact comparison table. */
const BASKETBALL_PRIORITY = [
  'fieldGoalsMade-fieldGoalsAttempted',
  'fieldGoalPct',
  'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
  'threePointFieldGoalPct',
  'freeThrowsMade-freeThrowsAttempted',
  'freeThrowPct',
  'totalRebounds',
  'offensiveRebounds',
  'defensiveRebounds',
  'assists',
  'steals',
  'blocks',
  'turnovers',
  'fouls',
  'pointsInPaint',
  'fastBreakPoints',
  'secondChancePoints',
  'largestLead',
]

/**
 * Team-turnover/technical bookkeeping the per-sport rows already cover (TO,
 * Fouls) — ESPN reports both raw and "total" variants for basketball, and
 * listing both only pads the compact table with 0-vs-0 noise.
 */
const BASKETBALL_SKIP = new Set([
  'teamTurnovers',
  'totalTurnovers',
  'technicalFouls',
  'totalTechnicalFouls',
  'flagrantFouls',
  'leadChanges',
  'leadPercentage',
  'turnoverPoints',
])

/* ------------------------------------------------------------------ */
/* Stat ordering: football-first priority, everything else passthrough */
/* ------------------------------------------------------------------ */

/* ESPN site-v2 football team-stat keys, most useful first. */
const FOOTBALL_PRIORITY = [
  'totalYards',
  'possessionTime',
  'firstDowns',
  'totalFirstDowns',
  'thirdDownEff',
  'thirdDownEfficiency',
  'fourthDownEff',
  'fourthDownEfficiency',
  'redZoneAttempts',
  'redZoneEfficiency',
  'turnovers',
  'rushingYards',
  'netPassingYards',
  'passingYards',
  'grossPassingYards',
  'yardsPerRushAttempt',
  'yardsPerPass',
  'yardsPerPassAttempt',
  'completionAttempts',
  'completions',
  'passingAttempts',
  'completionPct',
  'sacksYardsLost',
  'sacks',
  'sacksAllowed',
  'totalPenaltiesYards',
  'penalties',
  'penaltyYards',
  'interceptions',
  'interceptionsThrown',
  'fumblesLost',
  'lostFumbles',
  'firstDownsRushing',
  'firstDownRushing',
  'firstDownsPassing',
  'firstDownPassing',
  'firstDownsPenalty',
  'firstDownPenalty',
  'totalOffensivePlays',
  'yardsPerPlay',
  'rushingAttempts',
  'totalDrives',
  'defensiveTouchdowns',
]

/**
 * Compound display values whose bar magnitude should come from one side:
 * penalty "5-60" compares yards (second), sacks "1-8" compares sack count
 * (first). Efficiency forms ("7-14", "17/32") use the generic ratio parser.
 */
const COMPOUND_PART: Record<string, 'first' | 'second'> = {
  totalPenaltiesYards: 'second',
  penaltyYards: 'second',
  sacksYardsLost: 'first',
  sacks: 'first',
}

export function numericForStat(name: string, display: string | null): number | null {
  if (display == null) return null
  const part = COMPOUND_PART[name]
  if (part) {
    const v = parseCompoundPart(display, part)
    if (v != null) return v
  }
  return parseStatNumeric(display)
}

/**
 * Builds ordered head-to-head rows from the two teams' ESPN `statistics`
 * arrays. Only stats actually present in the data are returned — nothing is
 * fabricated. For football the priority list above leads; basketball gets its
 * own order with short labels (FG, 3PT, FT, REB …); compound shooting values
 * are formatted en-dash ("13–16"). For other sports (or leftover stats) ESPN
 * order is preserved after the prioritized ones.
 */
export function buildComparisonRows(
  awayStats: { name: string; displayValue: string }[] | undefined,
  homeStats: { name: string; displayValue: string }[] | undefined,
  sport?: string,
): StatComparisonInput[] {
  const shaped = (name: string, display: string | null) =>
    display == null ? null : compoundDisplay(name, display)
  const awayByName = new Map((awayStats ?? []).map((s) => [s.name, shaped(s.name, s.displayValue)]))
  const homeByName = new Map((homeStats ?? []).map((s) => [s.name, shaped(s.name, s.displayValue)]))
  const priority =
    sport?.toUpperCase() === 'NBA' || sport?.toUpperCase() === 'NCAAMB' ? BASKETBALL_PRIORITY : FOOTBALL_PRIORITY
  const basketball = priority !== FOOTBALL_PRIORITY
  const orderedNames: string[] = []
  const seen = new Set<string>()
  for (const name of priority) {
    if ((awayByName.has(name) || homeByName.has(name)) && !seen.has(name)) {
      seen.add(name)
      orderedNames.push(name)
    }
  }
  for (const s of awayStats ?? []) {
    if (basketball && BASKETBALL_SKIP.has(s.name)) continue
    if (!seen.has(s.name)) {
      seen.add(s.name)
      orderedNames.push(s.name)
    }
  }
  for (const s of homeStats ?? []) {
    if (basketball && BASKETBALL_SKIP.has(s.name)) continue
    if (!seen.has(s.name)) {
      seen.add(s.name)
      orderedNames.push(s.name)
    }
  }
  return orderedNames.map((name) => {
    const awayValue = awayByName.get(name) ?? null
    const homeValue = homeByName.get(name) ?? null
    // Compound magnitudes come from the configured side (FG "13–16" -> makes;
    // penalties "5-60" -> yards); everything else uses the generic parser.
    const part = COMPOUND_META[name]?.part
    const numeric = (v: string | null) =>
      part ? parseCompoundPart(v ?? '', part) : parseStatNumeric(v)
    return {
      label: shortStatLabel(name),
      awayValue,
      homeValue,
      awayNumericValue: numeric(awayValue),
      homeNumericValue: numeric(homeValue),
    }
  })
}

/* ------------------------------------------------------------------ */
/* HeadToHeadTable — compact away | label | home table for narrow sides */
/* ------------------------------------------------------------------ */

/**
 * One statistic per row in a real 3-column table: away value (right-aligned,
 * hugging the label), centered short label, home value (left-aligned). A thin
 * comparison bar sits under each row. Everything is sized for narrow sidebars
 * (multiview stats column ~22rem) — no truncation, no horizontal clipping:
 * values never wrap and stay compact, labels may wrap within their middle
 * column. Reuses buildComparisonRows for ordering/labels/compound shaping.
 */
export function HeadToHeadTable({
  away,
  home,
  sport,
  className = '',
  maxRows,
}: {
  away: BoxScoreTeam
  home: BoxScoreTeam
  sport: string
  className?: string
  /** Compact displays may cap visible rows; priority rows lead. */
  maxRows?: number
}) {
  const rows = buildComparisonRows(away.statistics, home.statistics, sport).filter(
    (r) => !isMissingRow(r.awayValue, r.homeValue),
  )
  const visible = maxRows ? rows.slice(0, maxRows) : rows
  if (visible.length === 0) {
    return <p className="text-sm text-fs-muted">Team stats not yet available.</p>
  }
  const { awayColor, homeColor } = resolveBarColors(sport, away.abbreviation, home.abbreviation)
  return (
    <div data-testid="head-to-head-table" className={`min-w-0 ${className}`}>
      <table className="w-full table-fixed border-collapse text-[13px]">
        {/* fixed shares: values stay identical width, label flexes mildly */}
        <colgroup>
          <col className="w-[30%]" />
          <col className="w-[40%]" />
          <col className="w-[30%]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="pb-1 text-right text-xs font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: awayColor }}>
              {away.abbreviation}
            </th>
            <th scope="col" aria-hidden="true" className="pb-1" />
            <th scope="col" className="pb-1 text-left text-xs font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: homeColor }}>
              {home.abbreviation}
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <Fragment key={row.label}>
              <tr className="border-t border-[rgba(242,245,241,0.07)]">
                <td className="py-1.5 pl-1 text-right font-mono font-semibold tabular-nums text-fs-text whitespace-nowrap">
                  {row.awayValue ?? '–'}
                </td>
                <td className="px-1.5 py-1.5 text-center text-[10px] font-medium uppercase leading-tight tracking-wider text-fs-muted hyphens-auto">
                  {row.label}
                </td>
                <td className="py-1.5 pr-1 text-left font-mono font-semibold tabular-nums text-fs-text whitespace-nowrap">
                  {row.homeValue ?? '–'}
                </td>
              </tr>
              <tr aria-hidden="true">
                <td colSpan={3} className="px-1 pb-1.5">
                  <StatComparisonBar
                    awayNumericValue={row.awayNumericValue}
                    homeNumericValue={row.homeNumericValue}
                    awayColor={awayColor}
                    homeColor={homeColor}
                  />
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* StatComparisonBar — ONE shared head-to-head bar                     */
/* ------------------------------------------------------------------ */

export function StatComparisonBar({
  awayNumericValue,
  homeNumericValue,
  awayColor,
  homeColor,
}: {
  awayNumericValue: number | null
  homeNumericValue: number | null
  awayColor: string
  homeColor: string
}) {
  const { awayShare } = barShares(awayNumericValue, homeNumericValue)
  const awayPct = Math.max(0, Math.min(100, awayShare * 100))
  return (
    <div
      className="relative h-1.5 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: 'rgba(242,245,241,0.08)' }}
      role="presentation"
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${awayPct}%`, backgroundColor: awayColor, opacity: 0.85 }}
      />
      <div
        className="absolute inset-y-0 right-0 rounded-full"
        style={{ width: `${100 - awayPct}%`, backgroundColor: homeColor, opacity: 0.85 }}
      />
      {/* subtle divider where the two portions meet */}
      <div
        className="absolute inset-y-0 w-px"
        style={{ left: `calc(${awayPct}% - 0.5px)`, backgroundColor: 'rgba(11,15,13,0.9)' }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* StatComparisonRow — value / label / value + shared bar              */
/* ------------------------------------------------------------------ */

/**
 * One head-to-head stat: away value, label, home value, comparison bar.
 *
 * No value or label is ever truncated (the earlier `truncate` + `max-w-*`
 * clipped real numbers like "12-19" on narrow sidebars). Instead the layout
 * reflows: phones stack the label on its own full-width line above the two
 * values, and from `sm` up the label sits between them, wrapping within a
 * bounded middle column so the two values always keep their space.
 */
export function StatComparisonRow({
  row,
  awayColor,
  homeColor,
}: {
  row: StatComparisonInput
  awayColor: string
  homeColor: string
}) {
  if (isMissingRow(row.awayValue, row.homeValue)) return null
  return (
    <div className="group border-t border-[rgba(242,245,241,0.06)] px-1 py-2.5 first:border-t-0 hover:bg-[rgba(242,245,241,0.03)]">
      <div className="grid grid-cols-2 items-center gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,1fr)] sm:gap-x-4">
        <span className="order-2 whitespace-nowrap text-left text-lg font-bold leading-tight tabular-nums text-fs-text sm:order-1 sm:text-xl">
          {row.awayValue ?? '–'}
        </span>
        <span className="order-1 col-span-2 min-w-0 break-words text-center text-[11px] font-medium uppercase leading-tight tracking-wider text-fs-muted sm:order-2 sm:col-span-1 sm:px-2 sm:text-xs">
          {row.label}
        </span>
        <span className="order-3 whitespace-nowrap text-right text-lg font-bold leading-tight tabular-nums text-fs-text sm:text-xl">
          {row.homeValue ?? '–'}
        </span>
      </div>
      <div className="mt-2">
        <StatComparisonBar
          awayNumericValue={row.awayNumericValue}
          homeNumericValue={row.homeNumericValue}
          awayColor={awayColor}
          homeColor={homeColor}
        />
      </div>
    </div>
  )
}

/**
 * A bare head-to-head table (no score header / last-play block), reused by
 * GameStatsSection and by the Command workspace's statistics strip. Values,
 * ordering, colours and the comparison bars all come from the same helpers as
 * the classic Team Stats tab, so nothing is duplicated or re-implemented.
 */
export function StatComparisonTable({
  away,
  home,
  sport,
  columns = 2,
  className = '',
  testId = 'stat-comparison-table',
}: {
  away: BoxScoreTeam
  home: BoxScoreTeam
  sport: string
  columns?: 1 | 2
  className?: string
  testId?: string
}) {
  const rows = buildComparisonRows(away.statistics, home.statistics, sport).filter(
    (r) => !isMissingRow(r.awayValue, r.homeValue),
  )
  if (rows.length === 0) {
    return <p className="text-sm text-fs-muted">Team stats not yet available.</p>
  }
  const { awayColor, homeColor } = resolveBarColors(sport, away.abbreviation, home.abbreviation)
  return (
    <div
      data-testid={testId}
      className={`grid gap-x-8 ${columns === 2 ? 'md:grid-cols-2' : ''} ${className}`}
    >
      {rows.map((row) => (
        <StatComparisonRow key={row.label} row={row} awayColor={awayColor} homeColor={homeColor} />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* LastPlayBlock — latest play under the score, keeps live games fresh */
/* ------------------------------------------------------------------ */

const PERIOD_PREFIX: Record<string, string> = { NFL: 'Q', NBA: 'Q', NHL: 'P', MLB: 'Inn' }

export function LastPlayBlock({ play, sport, defenseAbbr, ballColor }: { play: LastPlay; sport: string; defenseAbbr?: string | null; ballColor?: string | null }) {
  const meta = formatLastPlayMeta(play, PERIOD_PREFIX[sport.toUpperCase()] ?? 'Q')
  return (
    <div className="mt-3 border-t border-[rgba(242,245,241,0.08)] pt-3">
      <p className="fs-meta mb-1 flex items-center justify-center gap-1.5">
        {play.scoringPlay ? (
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-fs-turf" />
        ) : null}
        Last play{meta ? ` · ${meta}` : ''}
      </p>
      <p className="mx-auto max-w-2xl text-center text-sm leading-snug text-fs-text/85">
        {play.text}
      </p>
      <FieldPosition
        yardLine={play.yardLine}
        spot={play.spot}
        down={play.down}
        distance={play.distance}
        possessionAbbr={play.possessionAbbr}
        defenseAbbr={defenseAbbr}
        ballColor={ballColor}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* FieldPosition — where the ball is, under the last play              */
/* ------------------------------------------------------------------ */

export function FieldPosition({
  yardLine,
  spot,
  down,
  distance,
  possessionAbbr,
  defenseAbbr,
  ballColor,
}: {
  yardLine?: number | null
  spot?: string | null
  down?: number | null
  distance?: number | null
  possessionAbbr?: string | null
  defenseAbbr?: string | null
  ballColor?: string | null
}) {
  // Only football feeds carry yards-to-go; anything else hides the viz.
  if (yardLine == null) return null
  // Bar runs from the possessing team's own goal (left) to the end zone
  // they're attacking (right); the ball sits `yardLine` yards from the right.
  const ballPct = Math.max(1.5, Math.min(98.5, 100 - yardLine))
  const redZone = yardLine <= 20
  const goalToGo = yardLine > 0 && distance != null && distance >= yardLine
  return (
    <div className="mx-auto mt-3 w-full max-w-xl">
      <div className="mb-1.5 flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
        {down != null && down >= 1 && down <= 4 ? (
          <span className="font-mono font-semibold tabular-nums text-fs-text/85">
            {formatDownDistance(down, distance ?? null)}
          </span>
        ) : null}
        {spot ? (
          <span className="font-mono tabular-nums text-fs-muted">at {spot}</span>
        ) : null}
        {goalToGo ? (
          <span className="rounded bg-fs-gold/15 px-1.5 py-px text-[10px] font-bold tracking-wider text-fs-gold">
            GOAL TO GO
          </span>
        ) : redZone ? (
          <span className="rounded bg-fs-red/15 px-1.5 py-px text-[10px] font-bold tracking-wider text-fs-red">
            RED ZONE
          </span>
        ) : null}
      </div>
      <div
        className="relative h-9 overflow-hidden rounded-md"
        style={{ backgroundColor: 'rgba(139,197,63,0.07)', border: '1px solid rgba(242,245,241,0.10)' }}
        role="img"
        aria-label={spot ? `Ball at ${spot}` : 'Ball position'}
      >
        {/* yard ticks every 10 yards */}
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((x) => (
          <span
            key={x}
            className="absolute inset-y-1 w-px"
            style={{ left: `${x}%`, backgroundColor: x === 50 ? 'rgba(242,245,241,0.35)' : 'rgba(242,245,241,0.14)' }}
          />
        ))}
        {/* red-zone tint over the final 20 yards */}
        <span className="absolute inset-y-0 right-0" style={{ width: '20%', backgroundColor: 'rgba(232,93,76,0.08)' }} />
        {/* the ball */}
        <span
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${ballPct}%`,
            backgroundColor: ballColor ?? '#F2F5F1',
            boxShadow: '0 0 0 3px rgba(11,15,13,0.85), 0 0 12px 2px rgba(242,245,241,0.35)',
          }}
          title={spot ? `Ball at ${spot}` : 'Ball'}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-fs-muted-2">
        <span>{possessionAbbr ?? 'Own goal'}</span>
        <span>{defenseAbbr ?? 'Opp goal'}</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* TeamComparisonHeader — away left, home right, score dominant        */
/* ------------------------------------------------------------------ */

export function TeamComparisonHeader({
  away,
  home,
  awayScore,
  homeScore,
  statusText,
  live,
  awayColor,
  homeColor,
  lastPlay,
  sport,
}: {
  away: BoxScoreTeam
  home: BoxScoreTeam
  awayScore: string | null
  homeScore: string | null
  statusText: string | null
  live?: boolean
  awayColor?: string
  homeColor?: string
  lastPlay?: LastPlay | null
  sport?: string
}) {
  // Which end zone is under threat: the side NOT in possession defends the
  // right end of the field-position bar.
  const upper = (v: unknown) => (typeof v === 'string' ? v.toUpperCase() : '')
  const possessionIsAway = !!lastPlay?.possessionAbbr && upper(lastPlay.possessionAbbr) === upper(away.abbreviation)
  const possessionIsHome = !!lastPlay?.possessionAbbr && upper(lastPlay.possessionAbbr) === upper(home.abbreviation)
  const defenseAbbr = possessionIsAway ? home.abbreviation : possessionIsHome ? away.abbreviation : null
  const possessionBallColor = possessionIsAway ? (awayColor ?? null) : possessionIsHome ? (homeColor ?? null) : null
  return (
    <div data-testid="boxscore-header">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-6">
        {/* Away — left column (top-left on mobile) */}
        <div className="order-1 flex min-w-0 flex-col items-start gap-2 md:flex-row md:items-center md:gap-3">
          {away.logo ? (
            <img src={away.logo} alt="" className="h-14 w-14 shrink-0 object-contain sm:h-16 sm:w-16" />
          ) : null}
          <div className="min-w-0">
            <span
              className="block text-xs font-semibold uppercase tracking-wider text-fs-muted"
              style={awayColor ? { color: awayColor } : undefined}
            >
              {away.abbreviation}
            </span>
            {away.displayName ? (
              <span className="block truncate text-xs text-fs-muted-2">{away.displayName}</span>
            ) : null}
          </div>
        </div>
        {/* Home — right column on mobile, far right on desktop */}
        <div className="order-2 flex min-w-0 flex-col items-end gap-2 text-right md:order-3 md:flex-row-reverse md:items-center md:gap-3">
          {home.logo ? (
            <img src={home.logo} alt="" className="h-14 w-14 shrink-0 object-contain sm:h-16 sm:w-16" />
          ) : null}
          <div className="min-w-0">
            <span
              className="block text-xs font-semibold uppercase tracking-wider text-fs-muted"
              style={homeColor ? { color: homeColor } : undefined}
            >
              {home.abbreviation}
            </span>
            {home.displayName ? (
              <span className="block truncate text-xs text-fs-muted-2">{home.displayName}</span>
            ) : null}
          </div>
        </div>

        {/* Score — full-width row below the teams on mobile, center column on desktop */}
        {awayScore != null && homeScore != null ? (
          <div className="order-3 col-span-2 flex flex-col items-center md:order-2 md:col-span-1 md:min-w-64">
            <div className="flex items-center justify-center gap-4 sm:gap-6">
              <span className="text-4xl font-extrabold tabular-nums text-fs-text sm:text-5xl">
                {awayScore}
              </span>
              <span className="text-2xl font-light text-fs-muted-2">–</span>
              <span className="text-4xl font-extrabold tabular-nums text-fs-text sm:text-5xl">
                {homeScore}
              </span>
            </div>
            {statusText ? (
              <div className="mt-2 flex items-center justify-center gap-2">
                {live ? (
                  <span className="inline-flex items-center gap-1.5 rounded bg-fs-red/15 px-1.5 py-0.5 text-xs font-bold tracking-wider text-fs-red">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fs-red" />
                    LIVE
                  </span>
                ) : null}
                <span className="text-center text-xs text-fs-muted sm:text-sm">{statusText}</span>
              </div>
            ) : null}
          </div>
        ) : statusText ? (
          <div className="order-3 col-span-2 flex items-center justify-center gap-2 md:order-2 md:col-span-1">
            {live ? (
              <span className="inline-flex items-center gap-1.5 rounded bg-fs-red/15 px-1.5 py-0.5 text-xs font-bold tracking-wider text-fs-red">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fs-red" />
                LIVE
              </span>
            ) : null}
            <span className="text-center text-xs text-fs-muted sm:text-sm">{statusText}</span>
          </div>
        ) : null}
      </div>

      {lastPlay && sport ? (
        <LastPlayBlock
          play={lastPlay}
          sport={sport}
          defenseAbbr={defenseAbbr}
          ballColor={possessionBallColor}
        />
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* GameStatsSection — header + head-to-head rows, sport-agnostic       */
/* ------------------------------------------------------------------ */

function gameState(status: BoxScoreStatus | null): 'final' | 'live' | 'upcoming' {
  if (!status) return 'upcoming'
  if (status.completed) return 'final'
  if (status.state === 'in') return 'live'
  if (status.state === 'pre') return 'upcoming'
  return 'upcoming'
}

export function GameStatsSection({
  away,
  home,
  status,
  sport,
  lastPlay,
}: {
  away: BoxScoreTeam
  home: BoxScoreTeam
  status: BoxScoreStatus | null
  sport: string
  lastPlay?: LastPlay | null
}) {
  const state = gameState(status)
  const awayScore = scoreText(away.score)
  const homeScore = scoreText(home.score)
  const rows = buildComparisonRows(away.statistics, home.statistics, sport)
  const hasStats = rows.some((r) => !isMissingRow(r.awayValue, r.homeValue))

  const { awayColor, homeColor } = resolveBarColors(sport, away.abbreviation, home.abbreviation)

  const statusText =
    state === 'final'
      ? 'FINAL'
      : (status?.detail ?? status?.shortDetail ?? status?.description ?? null)

  // Upcoming with nothing to compare yet: show start time, not zeroed rows.
  if (state === 'upcoming' && !hasStats) {
    return (
      <div className="mx-auto w-full max-w-none">
        <TeamComparisonHeader
          away={away}
          home={home}
          awayScore={awayScore}
          homeScore={homeScore}
          statusText={statusText ?? 'Scheduled'}
          awayColor={awayColor}
          homeColor={homeColor}
        />
        <p className="mt-6 text-center text-sm text-fs-muted">
          Team stats will appear here once the game begins.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-none">
      <TeamComparisonHeader
        away={away}
        home={home}
        awayScore={awayScore}
        homeScore={homeScore}
        statusText={statusText}
        live={state === 'live'}
        awayColor={awayColor}
        homeColor={homeColor}
        lastPlay={lastPlay}
        sport={sport}
      />

      {hasStats ? (
        <StatComparisonTable
          away={away}
          home={home}
          sport={sport}
          className="mt-5"
          testId="boxscore-stats"
        />
      ) : (
        <p className="mt-6 text-center text-sm text-fs-muted">Team stats not yet available</p>
      )}
    </div>
  )
}
