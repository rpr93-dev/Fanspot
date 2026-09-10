/**
 * Injury awareness for the prop model (client-safe, pure helpers).
 *
 * Two signals:
 *  - Pre-game: fantasy outlook `injuryTier` per starter (…/team-outlook).
 *  - Mid-game: ESPN roster feed `injuries[]` (timestamped, e.g. Darnold
 *    "Questionable" 2026-09-10T00:47Z) + live box-score QB activity.
 *
 * Only QB substitutions are auto-swapped mid-game: exactly one QB plays at a
 * time, so a stalled starter + a throwing backup is a clean signal. RB/WR/TE
 * rotate normally — their live values just show in the table.
 */

export interface RosterInjury {
  name: string
  status: string
  date: string | null
}

export interface LiveQb {
  name: string
  attempts: number
  yards: number | null
}

/** Outlook tiers that auto-swap the starter for his contender pre-game. */
export const OUT_TIERS = new Set(['out'])

/** ESPN roster injury statuses treated as "out" (lowercased). */
export const ROSTER_OUT_STATUSES = new Set([
  'out',
  'ir',
  'injured reserve',
  'injured-reserve',
  'suspended',
  'suspension',
  'doubtful',
])

const normStatus = (s: unknown): string => String(s ?? '').trim().toLowerCase()

export function isOutTier(tier: unknown): boolean {
  return OUT_TIERS.has(normStatus(tier))
}

export function isRosterOut(status: unknown): boolean {
  return ROSTER_OUT_STATUSES.has(normStatus(status))
}

/** Flatten an /api/roster payload to its injury entries. */
export function parseRosterInjuries(roster: any): RosterInjury[] {
  const out: RosterInjury[] = []
  const athletes = roster?.athletes
  if (!Array.isArray(athletes)) return out
  for (const a of athletes) {
    const name = a?.displayName ?? a?.fullName ?? a?.shortName
    if (typeof name !== 'string' || !name) continue
    const injuries = a?.injuries
    if (!Array.isArray(injuries)) continue
    for (const inj of injuries) {
      const status = inj?.status ?? inj?.type ?? inj?.designation
      if (status == null || status === '') continue
      out.push({ name, status: String(status), date: inj?.date ?? null })
    }
  }
  return out
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && v !== '--') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** Parse "17/32" (C/ATT) → attempts; plain numbers pass through. */
export function parseAttempts(v: unknown): number | null {
  if (typeof v === 'string' && v.includes('/')) {
    const parts = v.split('/')
    const att = toNum(parts[parts.length - 1])
    return att == null ? null : Math.max(0, Math.floor(att))
  }
  const n = toNum(v)
  return n == null ? null : Math.max(0, Math.floor(n))
}

/**
 * QBs for one team (ESPN abbr) from a /api/box-score payload, with pass
 * attempts parsed out of the Passing category's C/ATT label.
 */
export function teamQbs(boxScore: any, espnAbbr: string): LiveQb[] {
  const want = String(espnAbbr ?? '').toUpperCase()
  const groups: any[] = []
  for (const t of boxScore?.playerStats ?? []) {
    if (String(t?.teamAbbr ?? '').toUpperCase() !== want) continue
    if (Array.isArray(t?.categories)) groups.push(t.categories)
  }
  const cats = groups.flat()
  const pass = cats.find((c: any) => String(c?.label ?? '').toLowerCase() === 'passing')
  const athletes = pass?.athletes
  if (!Array.isArray(athletes)) return []
  const out: LiveQb[] = []
  for (const a of athletes) {
    if (typeof a?.displayName !== 'string' || !a.displayName) continue
    const stats = (a.stats ?? {}) as Record<string, unknown>
    const attempts = parseAttempts(stats['C/ATT'] ?? stats['ATT'])
    if (attempts == null) continue
    out.push({ name: a.displayName, yards: toNum(stats['YDS']), attempts })
  }
  return out.sort((x, y) => y.attempts - x.attempts)
}
