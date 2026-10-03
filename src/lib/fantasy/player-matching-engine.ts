import type { CanonicalPlayer, PlayerMatchResult } from './player-types'
import { FANTASY_POSITIONS_NFL } from './player-types'

export interface UnmatchedEspnPlayer {
  espnId: number
  fullName: string
  firstName: string
  lastName: string
  position: string
  team: string
}

const FUZZY_THRESHOLD = 0.88
/** Best fuzzy candidate must beat the runner-up by this much, else ambiguous. */
const FUZZY_MARGIN = 0.05
/** An ESPN-id hit whose names disagree this badly is a bad id join, not a match. */
const ID_NAME_SANITY = 0.5

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[.'’`-]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !NAME_SUFFIXES.has(t))
}

/** Lowercase, accent/punctuation-free, generational suffixes dropped. */
export function normalizeName(name: string): string {
  return nameTokens(name).join('')
}

function lastNameKey(name: string): string {
  const t = nameTokens(name)
  return t[t.length - 1] ?? ''
}

export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (na === nb) return 1.0
  const longer = na.length >= nb.length ? na : nb
  const shorter = na.length < nb.length ? na : nb
  const maxLen = longer.length
  if (maxLen === 0) return 1.0
  const distance = levenshteinDistance(longer, shorter)
  return 1.0 - distance / maxLen
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

const FREE_AGENT = new Set(['', 'FA', 'NONE'])
const isFreeAgent = (team: string | undefined) => FREE_AGENT.has((team ?? '').toUpperCase())

/**
 * Team agreement between an ESPN row and a master row. Unknown/free-agent on
 * either side is "compatible" (offseason moves); a real mismatch is not.
 */
function teamCompatible(a: string, b: string): boolean {
  if (isFreeAgent(a) || isFreeAgent(b)) return true
  return a.toUpperCase() === b.toUpperCase()
}

export interface MatchContext {
  master: {
    bySleeperId: Map<string, CanonicalPlayer>
    byEspnId: Map<number, CanonicalPlayer>
    byGsisId: Map<string, CanonicalPlayer>
    byPfrId: Map<string, CanonicalPlayer>
    /** Unique name|position keys only; namesakes live in `byName`. */
    byNamePosition: Map<string, CanonicalPlayer>
    byNameTeam: Map<string, CanonicalPlayer>
    /** Every master player sharing a normalized name (namesake detection). */
    byName: Map<string, CanonicalPlayer[]>
  }
}

export function buildMatchContext(master: {
  bySleeperId: Map<string, CanonicalPlayer>
  byEspnId: Map<number, CanonicalPlayer>
  byGsisId: Map<string, CanonicalPlayer>
  byPfrId: Map<string, CanonicalPlayer>
  players: CanonicalPlayer[]
}): MatchContext {
  const byName = new Map<string, CanonicalPlayer[]>()
  for (const p of master.players) {
    const key = normalizeName(p.fullName)
    if (!key) continue
    const list = byName.get(key)
    if (!list) byName.set(key, [p])
    else if (!list.some((q) => q.sleeperId === p.sleeperId)) list.push(p)
  }

  // Name-keyed maps only hold keys that resolve to exactly one player. A
  // first-wins map would silently hand a namesake's projection to whichever
  // player happened to load first.
  const byNamePosition = new Map<string, CanonicalPlayer>()
  const byNameTeam = new Map<string, CanonicalPlayer>()
  const dupNp = new Set<string>()
  const dupNt = new Set<string>()
  for (const [name, list] of byName) {
    for (const p of list) {
      const np = `${name}|${p.position}`
      if (byNamePosition.has(np)) dupNp.add(np)
      else byNamePosition.set(np, p)
      const nt = `${name}|${p.team}`
      if (byNameTeam.has(nt)) dupNt.add(nt)
      else byNameTeam.set(nt, p)
    }
  }
  for (const k of dupNp) byNamePosition.delete(k)
  for (const k of dupNt) byNameTeam.delete(k)

  return {
    master: {
      bySleeperId: master.bySleeperId,
      byEspnId: master.byEspnId,
      byGsisId: master.byGsisId,
      byPfrId: master.byPfrId,
      byNamePosition,
      byNameTeam,
      byName,
    },
  }
}

export function matchEspnPlayerToMaster(
  espnPlayer: UnmatchedEspnPlayer,
  ctx: MatchContext,
): PlayerMatchResult | null {
  const existing = ctx.master.byEspnId.get(espnPlayer.espnId)
  if (existing) {
    // Trust the id join, but not blindly: a stale/mis-keyed espn_id on the
    // Sleeper side would otherwise attach a different player. D/ST names
    // differ by convention ("Bills D/ST" vs "Buffalo Bills").
    const dst = existing.position === 'D/ST' || espnPlayer.position === 'D/ST'
    const sameLast = lastNameKey(espnPlayer.fullName) === lastNameKey(existing.fullName)
    if (dst || sameLast || nameSimilarity(espnPlayer.fullName, existing.fullName) >= ID_NAME_SANITY) {
      return { canonical: existing, strategy: 'espn-id', confidence: 1.0 }
    }
    console.warn(
      `[matching-engine] espn-id ${espnPlayer.espnId} name mismatch: ESPN "${espnPlayer.fullName}" vs master "${existing.fullName}"; falling back to name match`,
    )
  }

  const name = normalizeName(espnPlayer.fullName)
  if (!name) return null
  const namesakes = ctx.master.byName.get(name) ?? []

  if (namesakes.length > 0) {
    const espnTeam = espnPlayer.team.toUpperCase()
    // Exact name + position + team agreement is the strongest name signal.
    const samePos = namesakes.filter(
      (p) => p.position === espnPlayer.position && teamCompatible(p.team, espnPlayer.team),
    )
    const samePosTeam = samePos.filter((p) => p.team.toUpperCase() === espnTeam)
    if (samePosTeam.length === 1) {
      return { canonical: samePosTeam[0], strategy: 'name-position', confidence: 0.97 }
    }
    if (samePos.length === 1) {
      return { canonical: samePos[0], strategy: 'name-position', confidence: 0.95 }
    }

    // Position labels drift between providers (TE/QB hybrids), so allow a
    // cross-position match only when the team pins it to exactly one player.
    if (!isFreeAgent(espnPlayer.team)) {
      const sameTeam = namesakes.filter((p) => p.team.toUpperCase() === espnTeam)
      if (sameTeam.length === 1) {
        return { canonical: sameTeam[0], strategy: 'name-team', confidence: 0.9 }
      }
    }
    // Exact-name hits exist but none (or several) agree on position/team:
    // ambiguous or a different person. Never guess.
    return null
  }

  // Fuzzy covers spelling variants only: same position, compatible team,
  // same/near last name, and a clear winner over the runner-up.
  const lastKey = lastNameKey(espnPlayer.fullName)
  const scored: { player: CanonicalPlayer; score: number }[] = []
  for (const p of ctx.master.bySleeperId.values()) {
    if (!FANTASY_POSITIONS_NFL.has(p.position)) continue
    if (p.position !== espnPlayer.position) continue
    if (!teamCompatible(p.team, espnPlayer.team)) continue
    const pLast = lastNameKey(p.fullName)
    if (pLast !== lastKey && levenshteinDistance(pLast, lastKey) > 1) continue
    const sim = nameSimilarity(espnPlayer.fullName, p.fullName)
    if (sim >= FUZZY_THRESHOLD) scored.push({ player: p, score: sim })
  }
  if (scored.length === 0) return null
  scored.sort((a, b) => b.score - a.score)
  if (scored.length > 1 && scored[0].score - scored[1].score < FUZZY_MARGIN) return null
  // Capped below every exact strategy so a later exact match for the same
  // master player always wins the enricher's highest-confidence tie-break.
  return { canonical: scored[0].player, strategy: 'fuzzy', confidence: Math.min(0.89, scored[0].score) }
}

export function logUnmatchedPlayers(unmatched: UnmatchedEspnPlayer[]): void {
  if (unmatched.length === 0) return
  console.warn(`[matching-engine] ${unmatched.length} ESPN players could not be matched to master list:`)
  for (const u of unmatched.slice(0, 20)) {
    console.warn(`  UNMATCHED: [${u.espnId}] ${u.fullName} (${u.position} - ${u.team})`)
  }
  if (unmatched.length > 20) {
    console.warn(`  ... and ${unmatched.length - 20} more`)
  }
}
