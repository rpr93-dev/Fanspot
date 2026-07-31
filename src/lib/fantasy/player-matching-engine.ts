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

const FUZZY_THRESHOLD = 0.85

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim()
}

function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (na === nb) return 1.0
  if (na.includes(nb) || nb.includes(na)) return 0.9
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

export interface MatchContext {
  master: {
    bySleeperId: Map<string, CanonicalPlayer>
    byEspnId: Map<number, CanonicalPlayer>
    byGsisId: Map<string, CanonicalPlayer>
    byPfrId: Map<string, CanonicalPlayer>
    byNamePosition: Map<string, CanonicalPlayer>
    byNameTeam: Map<string, CanonicalPlayer>
  }
}

export function buildMatchContext(master: {
  bySleeperId: Map<string, CanonicalPlayer>
  byEspnId: Map<number, CanonicalPlayer>
  byGsisId: Map<string, CanonicalPlayer>
  byPfrId: Map<string, CanonicalPlayer>
  players: CanonicalPlayer[]
}): MatchContext {
  const byNamePosition = new Map<string, CanonicalPlayer>()
  const byNameTeam = new Map<string, CanonicalPlayer>()

  for (const p of master.players) {
    const npKey = `${normalizeName(p.fullName)}|${p.position}`
    if (!byNamePosition.has(npKey)) {
      byNamePosition.set(npKey, p)
    }
    const ntKey = `${normalizeName(p.fullName)}|${p.team}`
    if (!byNameTeam.has(ntKey)) {
      byNameTeam.set(ntKey, p)
    }
  }

  return {
    master: {
      bySleeperId: master.bySleeperId,
      byEspnId: master.byEspnId,
      byGsisId: master.byGsisId,
      byPfrId: master.byPfrId,
      byNamePosition,
      byNameTeam,
    },
  }
}

export function matchCanonicalToEspn(
  canonical: CanonicalPlayer,
  espnPlayer: UnmatchedEspnPlayer,
  ctx: MatchContext,
): PlayerMatchResult {
  const strategies: Array<{
    name: PlayerMatchResult['strategy']
    match: boolean
    confidence: number
  }> = []

  if (canonical.espnId != null && canonical.espnId === espnPlayer.espnId) {
    return {
      canonical,
      strategy: 'espn-id',
      confidence: 1.0,
    }
  }

  const npKey = `${normalizeName(espnPlayer.fullName)}|${espnPlayer.position}`
  const existingNp = ctx.master.byNamePosition.get(npKey)
  if (existingNp) {
    return {
      canonical: existingNp,
      strategy: 'name-position',
      confidence: 0.95,
    }
  }

  const ntKey = `${normalizeName(espnPlayer.fullName)}|${espnPlayer.team}`
  const existingNt = ctx.master.byNameTeam.get(ntKey)
  if (existingNt) {
    return {
      canonical: existingNt,
      strategy: 'name-team',
      confidence: 0.9,
    }
  }

  let bestFuzzy: { player: CanonicalPlayer; score: number } | null = null
  for (const p of ctx.master.bySleeperId.values()) {
    if (!FANTASY_POSITIONS_NFL.has(p.position)) continue
    const sim = nameSimilarity(espnPlayer.fullName, p.fullName)
    if (sim > FUZZY_THRESHOLD && sim > (bestFuzzy?.score ?? 0)) {
      bestFuzzy = { player: p, score: sim }
    }
  }
  if (bestFuzzy) {
    return {
      canonical: bestFuzzy.player,
      strategy: 'fuzzy',
      confidence: bestFuzzy.score,
    }
  }

  return {
    canonical,
    strategy: 'new',
    confidence: 0.1,
  }
}

export function matchEspnPlayerToMaster(
  espnPlayer: UnmatchedEspnPlayer,
  ctx: MatchContext,
): PlayerMatchResult | null {
  const existing = ctx.master.byEspnId.get(espnPlayer.espnId)
  if (existing) {
    return { canonical: existing, strategy: 'espn-id', confidence: 1.0 }
  }

  const npKey = `${normalizeName(espnPlayer.fullName)}|${espnPlayer.position}`
  const npMatch = ctx.master.byNamePosition.get(npKey)
  if (npMatch) {
    return { canonical: npMatch, strategy: 'name-position', confidence: 0.95 }
  }

  const ntKey = `${normalizeName(espnPlayer.fullName)}|${espnPlayer.team}`
  const ntMatch = ctx.master.byNameTeam.get(ntKey)
  if (ntMatch) {
    return { canonical: ntMatch, strategy: 'name-team', confidence: 0.9 }
  }

  let bestFuzzy: { player: CanonicalPlayer; score: number } | null = null
  for (const p of ctx.master.bySleeperId.values()) {
    if (!FANTASY_POSITIONS_NFL.has(p.position)) continue
    const sim = nameSimilarity(espnPlayer.fullName, p.fullName)
    if (sim > FUZZY_THRESHOLD && sim > (bestFuzzy?.score ?? 0)) {
      bestFuzzy = { player: p, score: sim }
    }
  }
  if (bestFuzzy) {
    return { canonical: bestFuzzy.player, strategy: 'fuzzy', confidence: bestFuzzy.score }
  }

  return null
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
