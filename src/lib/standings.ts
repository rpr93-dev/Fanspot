/**
 * League standings normalization. ESPN v2 standings shapes vary per sport;
 * this module translates entries into StandingRow (see models.ts) and groups
 * them by conference/division using the static teams table.
 */

import { teams } from '@/data/teams'
import { getEspnAbbr } from '@/lib/providers/espn'
import type { SportKey, StandingRow } from '@/lib/models'

/** ESPN abbreviation (+sport) -> static team record. */
function teamLookup(): Map<string, (typeof teams)[number]> {
  const m = new Map<string, (typeof teams)[number]>()
  for (const t of teams) {
    m.set(`${t.sport}:${getEspnAbbr(t.id, t.abbreviation).toUpperCase()}`, t)
  }
  return m
}

let lookupCache: Map<string, (typeof teams)[number]> | null = null
function lookup(): Map<string, (typeof teams)[number]> {
  if (!lookupCache) lookupCache = teamLookup()
  return lookupCache
}

export function statMapOf(stats: any[]): Record<string, string> {
  const m: Record<string, string> = {}
  if (!Array.isArray(stats)) return m
  for (const s of stats) {
    if (s?.name != null && s?.displayValue != null) m[String(s.name)] = String(s.displayValue)
  }
  return m
}

function numOrNull(v: string | undefined): number | null {
  if (v == null || v === '' || v === '-') return null
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function recordOf(sport: SportKey, stats: Record<string, string>): string {
  const w = stats.wins ?? ''
  const l = stats.losses ?? ''
  if (sport === 'NFL') {
    const t = stats.ties ?? '0'
    return `${w}-${l}${t !== '0' ? `-${t}` : ''}`
  }
  if (sport === 'NHL') {
    const otl = stats.overtimeLosses ?? stats.otLosses ?? '0'
    return `${w}-${l}-${otl}`
  }
  return `${w}-${l}`
}

/**
 * Translate ESPN v2 `children` (conference groups with entries) into flat
 * normalized rows. Unknown abbreviations still produce a row (graceful) but
 * without conference/division grouping keys.
 */
export function normalizeStandingsChildren(children: any[], sport: SportKey): StandingRow[] {
  const rows: StandingRow[] = []
  const lk = lookup()
  for (const child of Array.isArray(children) ? children : []) {
    const entries: any[] = child?.standings?.entries ?? []
    for (const entry of entries) {
      const team = entry?.team ?? {}
      const abbr = String(team.abbreviation ?? '').toUpperCase()
      if (!abbr) continue
      const stats = statMapOf(entry?.stats)
      const match = lk.get(`${sport}:${abbr}`)
      const wins = numOrNull(stats.wins) != null ? parseInt(stats.wins, 10) : null
      const losses = numOrNull(stats.losses) != null ? parseInt(stats.losses, 10) : null
      const ties = stats.ties != null && stats.ties !== '' ? parseInt(stats.ties, 10) : null
      rows.push({
        abbr,
        name: String(team.displayName ?? abbr),
        logo: String(team.logos?.[0]?.href ?? ''),
        teamId: match?.id ?? '',
        conference: match?.conference ?? '',
        division: match?.division ?? '',
        wins: Number.isFinite(wins) ? wins : null,
        losses: Number.isFinite(losses) ? losses : null,
        ties: ties != null && Number.isFinite(ties) ? ties : null,
        pct: numOrNull(stats.winPercent),
        extra: { ...stats, record: recordOf(sport, stats) },
      })
    }
  }
  return rows
}

export interface StandingGroup {
  name: string
  divisions: { name: string; teams: StandingRow[] }[]
}

function pctOf(r: StandingRow): number {
  return r.pct ?? (r.wins != null && r.losses != null && r.wins + r.losses > 0
    ? r.wins / (r.wins + r.losses)
    : 0)
}

/** Group rows by conference/division, sorted by pct descending. */
export function groupStandingsRows(rows: StandingRow[]): StandingGroup[] {
  const sorted = [...rows].sort((a, b) => pctOf(b) - pctOf(a))
  const conferences = [...new Set(sorted.map((r) => r.conference).filter(Boolean))].sort()
  const groups = conferences.map((conf) => {
    const confTeams = sorted.filter((r) => r.conference === conf)
    const divisions = [...new Set(confTeams.map((r) => r.division).filter(Boolean))].sort()
    return {
      name: conf,
      divisions: divisions.map((div) => ({
        name: div,
        teams: confTeams.filter((r) => r.division === div),
      })),
    }
  })
  // Rows without grouping keys (unknown teams) still surface, ungrouped.
  const orphans = sorted.filter((r) => !r.conference)
  if (orphans.length > 0) groups.push({ name: '', divisions: [{ name: '', teams: orphans }] })
  return groups
}

export interface StandingColumn {
  key: string
  label: string
}

/**
 * Per-sport table columns. Keys resolve against StandingRow.extra
 * ('record' is the computed W-L[-T]); missing values render as '–'.
 */
export const STANDINGS_COLUMNS: Record<SportKey, StandingColumn[]> = {
  NFL: [
    { key: 'record', label: 'W-L-T' },
    { key: 'winPercent', label: 'PCT' },
    { key: 'pointsFor', label: 'PF' },
    { key: 'pointsAgainst', label: 'PA' },
    { key: 'streak', label: 'STRK' },
  ],
  NBA: [
    { key: 'record', label: 'W-L' },
    { key: 'winPercent', label: 'PCT' },
    { key: 'gamesBehind', label: 'GB' },
    { key: 'streak', label: 'STRK' },
  ],
  NHL: [
    { key: 'record', label: 'W-L-OTL' },
    { key: 'points', label: 'PTS' },
    { key: 'gamesPlayed', label: 'GP' },
    { key: 'pointsFor', label: 'GF' },
    { key: 'pointsAgainst', label: 'GA' },
    { key: 'streak', label: 'STRK' },
  ],
  MLB: [
    { key: 'record', label: 'W-L' },
    { key: 'winPercent', label: 'PCT' },
    { key: 'gamesBehind', label: 'GB' },
    { key: 'streak', label: 'STRK' },
    { key: 'Last Ten Games', label: 'L10' },
  ],
}
