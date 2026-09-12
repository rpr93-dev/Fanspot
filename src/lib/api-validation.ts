import { NextResponse } from 'next/server'

/**
 * Shared GET/POST param validation for the API routes. Every upstream URL
 * interpolation of a client-supplied value must pass through one of these
 * shape checks first (and encodeURIComponent when building the URL), so a
 * stray token can never smuggle path segments or query params upstream.
 */

export const TEAM_RE = /^[A-Z0-9]{2,4}$/
export const SEASON_RE = /^\d{4}$/
export const DATE_RE = /^\d{8}$/
export const EVENT_ID_RE = /^\d+$/

export const SPORT_ALLOWLIST = ['nfl', 'nba', 'nhl', 'mlb'] as const
export type Sport = (typeof SPORT_ALLOWLIST)[number]

/** Sport path segments ESPN knows beyond the four primary leagues. */
const EXTRA_ESPN_SPORTS = ['nba_summer']

export function isValidTeam(value: unknown): boolean {
  return typeof value === 'string' && TEAM_RE.test(value.toUpperCase())
}

export function isValidSeason(value: unknown): boolean {
  return typeof value === 'string' && SEASON_RE.test(value)
}

export function isValidDate(value: unknown): boolean {
  return typeof value === 'string' && DATE_RE.test(value)
}

export function isValidEventId(value: unknown): boolean {
  return typeof value === 'string' && EVENT_ID_RE.test(value)
}

export function isAllowedSport(value: unknown): boolean {
  return typeof value === 'string' && SPORT_ALLOWLIST.includes(value.toLowerCase() as Sport)
}

/** Sport key accepted by espnSportMap (primary allowlist + internal extras). */
export function isKnownEspnSport(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const v = value.toUpperCase()
  return SPORT_ALLOWLIST.includes(v.toLowerCase() as Sport) || EXTRA_ESPN_SPORTS.includes(v.toLowerCase())
}

/**
 * ESPN `dates` param: YYYYMM (month) or YYYYMMDD, optionally as an explicit
 * start-end range. ESPN's scoreboard endpoint accepts both granularities and
 * espn.ts fans out month queries (fetchScoreboard), so YYYYMM must stay valid.
 */
const DATE_PART = String.raw`\d{6}(?:\d{2})?`
export function isValidDateRange(value: unknown): boolean {
  return typeof value === 'string' && new RegExp(`^${DATE_PART}(?:-${DATE_PART})?$`).test(value)
}

export const INVALID_PARAM = 'INVALID_PARAM'

export function invalidParam(message: string): NextResponse {
  return NextResponse.json({ error: INVALID_PARAM, message }, { status: 400 })
}
