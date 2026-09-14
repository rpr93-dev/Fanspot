'use client'

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
 * fabricated. For football the priority list above leads; for other sports
 * (or leftover stats) ESPN order is preserved after the prioritized ones.
 */
export function buildComparisonRows(
  awayStats: { name: string; displayValue: string }[] | undefined,
  homeStats: { name: string; displayValue: string }[] | undefined,
): StatComparisonInput[] {
  const awayByName = new Map((awayStats ?? []).map((s) => [s.name, s.displayValue]))
  const homeByName = new Map((homeStats ?? []).map((s) => [s.name, s.displayValue]))
  const orderedNames: string[] = []
  const seen = new Set<string>()
  for (const name of FOOTBALL_PRIORITY) {
    if ((awayByName.has(name) || homeByName.has(name)) && !seen.has(name)) {
      seen.add(name)
      orderedNames.push(name)
    }
  }
  for (const s of awayStats ?? []) {
    if (!seen.has(s.name)) {
      seen.add(s.name)
      orderedNames.push(s.name)
    }
  }
  for (const s of homeStats ?? []) {
    if (!seen.has(s.name)) {
      seen.add(s.name)
      orderedNames.push(s.name)
    }
  }
  return orderedNames.map((name) => {
    const awayValue = awayByName.get(name) ?? null
    const homeValue = homeByName.get(name) ?? null
    return {
      label: statLabel(name),
      awayValue,
      homeValue,
      awayNumericValue: numericForStat(name, awayValue),
      homeNumericValue: numericForStat(name, homeValue),
    }
  })
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
      className="relative h-1 w-full overflow-hidden rounded-full"
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
    <div className="border-t border-[rgba(242,245,241,0.06)] py-2">
      <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 sm:gap-3">
        <span
          className="min-w-0 truncate text-left text-lg font-bold tabular-nums text-fs-text sm:text-xl"
          title={row.awayValue ?? ''}
        >
          {row.awayValue ?? '–'}
        </span>
        <span className="max-w-36 truncate px-1 text-center text-[11px] font-medium uppercase tracking-wider text-fs-muted sm:max-w-48 sm:text-xs">
          {row.label}
        </span>
        <span
          className="min-w-0 truncate text-right text-lg font-bold tabular-nums text-fs-text sm:text-xl"
          title={row.homeValue ?? ''}
        >
          {row.homeValue ?? '–'}
        </span>
      </div>
      <div className="mt-1.5">
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
  const rows = buildComparisonRows(away.statistics, home.statistics)
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
        <div data-testid="boxscore-stats" className="mt-5 md:grid md:grid-cols-2 md:gap-x-10">
          {rows.map((row) => (
            <StatComparisonRow
              key={row.label}
              row={row}
              awayColor={awayColor}
              homeColor={homeColor}
            />
          ))}
        </div>
      ) : (
        <p className="mt-6 text-center text-sm text-fs-muted">Team stats not yet available</p>
      )}
    </div>
  )
}
