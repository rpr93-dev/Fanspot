/**
 * Shared helpers for the game-day prop ledger (see prop-model/propmodel/ledger.py):
 * parsing live per-player stats out of the /api/box-score payload.
 *
 * The box-score route flattens ESPN's NFL categories to
 * { label: 'Passing'|'Rushing'|'Receiving', athletes: [{ displayName, stats }] }
 * where stats is keyed by ESPN's short column LABELS (verified against a real
 * summary payload):
 *   Passing:   C/ATT, YDS, AVG, TD, INT, SACKS, QBR, RTG
 *   Rushing:   CAR, YDS, AVG, TD, LONG
 *   Receiving: REC, YDS, AVG, TD, LONG, TGTS
 */

export const MODEL_STATS = [  'passing_yards',
  'rushing_yards',
  'receiving_yards',
  'receptions',
  'tds',
] as const

export type ModelStat = (typeof MODEL_STATS)[number]

export type LiveStatMap = Record<string, number | null>

/** Panel event date ("YYYYMMDD" or ISO) -> the CLI's --as-of form. Pure/client-safe. */
export function eventDateToAsOf(eventDate?: string | null): string | null {
  if (!eventDate) return null
  if (/^\d{8}$/.test(eventDate)) {
    return `${eventDate.slice(0, 4)}-${eventDate.slice(4, 6)}-${eventDate.slice(6, 8)}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(eventDate)) return eventDate.slice(0, 10)
  return null
}

/** Token-based name match (same semantics as the panel's scraped-line matcher). */
export function namesMatch(a: string, b: string): boolean {
  const norm = (n: string) =>
    n.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'junior', 'senior'])
  const want = norm(a)
  const wantToks = want.split(' ').filter(Boolean).filter((w) => !SUFFIX.has(w))
  const otherToks = norm(b).split(' ').filter(Boolean).filter((w) => !SUFFIX.has(w))
  const other = otherToks.join(' ')
  return other === want
    || (wantToks.length > 0 && wantToks.every((w) => other.includes(w)))
    || (otherToks.length > 0 && otherToks.every((s) => want.includes(s)))
    || (wantToks.length === 1 && want.length > 3 && other.includes(want.slice(1)))
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && v !== '--') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function athleteValues(categories: any[] | undefined, name: string): Record<string, number | null> {
  const out: Record<string, number | null> = {
    passing_yards: null, rushing_yards: null, receiving_yards: null,
    receptions: null, passing_tds: null, rushing_tds: null, receiving_tds: null,
  }
  if (!Array.isArray(categories)) return out
  for (const cat of categories) {
    const label = String(cat?.label ?? '').toLowerCase()
    const athletes = cat?.athletes
    if (!Array.isArray(athletes)) continue
    const a = athletes.find((x: any) => typeof x?.displayName === 'string' && namesMatch(name, x.displayName))
    if (!a || typeof a.stats !== 'object' || a.stats == null) continue
    const s = a.stats as Record<string, unknown>
    if (label === 'passing') {
      const y = toNum(s['YDS']); if (y != null) out.passing_yards = (out.passing_yards ?? 0) + y
      const t = toNum(s['TD']); if (t != null) out.passing_tds = (out.passing_tds ?? 0) + t
    } else if (label === 'rushing') {
      const y = toNum(s['YDS']); if (y != null) out.rushing_yards = (out.rushing_yards ?? 0) + y
      const t = toNum(s['TD']); if (t != null) out.rushing_tds = (out.rushing_tds ?? 0) + t
    } else if (label === 'receiving') {
      const y = toNum(s['YDS']); if (y != null) out.receiving_yards = (out.receiving_yards ?? 0) + y
      const r = toNum(s['REC']); if (r != null) out.receptions = (out.receptions ?? 0) + r
      const t = toNum(s['TD']); if (t != null) out.receiving_tds = (out.receiving_tds ?? 0) + t
    }
  }
  return out
}

function tdTotal(v: Record<string, number | null>): number | null {
  const parts = [v.passing_tds, v.rushing_tds, v.receiving_tds].filter((n): n is number => n != null)
  if (parts.length === 0) return null
  return parts.reduce((a, b) => a + b, 0)
}

/**
 * Map model target names -> per-stat live values from a /api/box-score payload.
 * A name absent from the box score yields nulls (hasn't played / DNP).
 */
export function extractLiveStats(
  boxScore: any,
  players: { name: string }[],
): Record<string, LiveStatMap> {
  const teams: any[] = boxScore?.playerStats ?? boxScore?.teams ?? []
  // playerStats entries hold { teamAbbr, categories }; fall back to scanning
  // anything with a `categories` array.
  const groups: any[][] = []
  if (Array.isArray(teams)) {
    for (const t of teams) {
      if (Array.isArray(t?.categories)) groups.push(t.categories)
      else if (Array.isArray(t?.playerStats)) {
        for (const ps of t.playerStats) if (Array.isArray(ps?.categories)) groups.push(ps.categories)
      }
    }
  }
  const merged: any[] = groups.flat()
  const out: Record<string, LiveStatMap> = {}
  for (const p of players) {
    const v = athleteValues(merged, p.name)
    const found = Object.values(v).some((x) => x != null)
    out[p.name] = {
      passing_yards: found ? v.passing_yards : null,
      rushing_yards: found ? v.rushing_yards : null,
      receiving_yards: found ? v.receiving_yards : null,
      receptions: found ? v.receptions : null,
      tds: found ? tdTotal(v) : null,
    }
  }
  return out
}

/** Quarters completed/in-progress from team linescores (NFL). 0 = no data. */
export function quartersPlayed(boxScore: any): number {
  const teams = boxScore?.teams
  if (!Array.isArray(teams)) return 0
  let q = 0
  for (const t of teams) {
    const ls = t?.linescores
    if (Array.isArray(ls)) q = Math.max(q, ls.length)
  }
  return q
}

export function isGameComplete(boxScore: any): boolean {
  const state = boxScore?.status?.state
  if (state === 'post') return true
  const d = `${boxScore?.status?.description ?? ''} ${boxScore?.status?.shortDetail ?? ''}`
  return /final|ended|game over/i.test(d)
}
