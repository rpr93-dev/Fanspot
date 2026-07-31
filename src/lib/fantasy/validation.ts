import type { UnifiedPlayer, CanonicalPlayer } from './player-types'
import { VALID_POSITIONS_NFL, FANTASY_POSITIONS_NFL } from './player-types'

export interface ValidationReport {
  valid: boolean
  totalPlayers: number
  issues: string[]
  duplicates: number
  multipleTeams: string[]
  missingIds: string[]
  invalidPositions: string[]
  missingProjections: string[]
  teamConflicts: string[]
}

export function validateUnifiedDatabase(players: UnifiedPlayer[]): ValidationReport {
  const issues: string[] = []
  const multipleTeams: string[] = []
  const missingIds: string[] = []
  const invalidPositions: string[] = []
  const missingProjections: string[] = []
  const teamConflicts: string[] = []

  const sleeperIds = new Map<string, UnifiedPlayer>()
  const espnIds = new Map<number, UnifiedPlayer>()
  const teamPositionMap = new Map<string, Set<string>>()

  for (const p of players) {
    const c = p.canonical

    if (!c.sleeperId) {
      missingIds.push(`${c.fullName}: missing sleeperId`)
    }
    if (c.espnId == null || c.espnId === 0) {
      missingIds.push(`${c.fullName}: missing espnId`)
    }
    if (c.gsisId == null) {
      missingIds.push(`${c.fullName}: missing gsisId`)
    }

    if (sleeperIds.has(c.sleeperId)) {
      issues.push(`DUPLICATE: ${c.fullName} (sleeperId: ${c.sleeperId})`)
    }
    sleeperIds.set(c.sleeperId, p)

    if (c.espnId != null && c.espnId > 0) {
      if (espnIds.has(c.espnId)) {
        const existing = espnIds.get(c.espnId)!
        issues.push(`DUPLICATE ESPN ID ${c.espnId}: ${existing.canonical.fullName} vs ${c.fullName}`)
      }
      espnIds.set(c.espnId, p)
    }

    if (!VALID_POSITIONS_NFL.has(c.position)) {
      invalidPositions.push(`${c.fullName}: invalid position "${c.position}"`)
    }

    if (!FANTASY_POSITIONS_NFL.has(c.position)) continue

    if (!p.projection || p.projection.points <= 0) {
      missingProjections.push(`${c.fullName} (${c.position} - ${c.team})`)
    }

    const teamPosKey = c.team || 'FA'
    if (!teamPositionMap.has(teamPosKey)) {
      teamPositionMap.set(teamPosKey, new Set())
    }
    teamPositionMap.get(teamPosKey)!.add(c.sleeperId)
  }

  for (const [, entries] of teamPositionMap) {
    if (entries.size > 1) {
      const playerNames = entries.size
      const firstTwo = Array.from(entries).slice(0, 3).join(', ')
      if (playerNames > 1) {
        issues.push(`Multiple players share same team code: ${playerNames} players`)
      }
    }
  }

  return {
    valid: issues.length === 0,
    totalPlayers: players.length,
    issues,
    duplicates: issues.filter((i) => i.startsWith('DUPLICATE')).length,
    multipleTeams,
    missingIds,
    invalidPositions,
    missingProjections,
    teamConflicts,
  }
}

export function validateCanonicalPlayer(p: CanonicalPlayer): string[] {
  const errors: string[] = []
  if (!p.sleeperId) errors.push('Missing sleeperId')
  if (!p.fullName) errors.push('Missing fullName')
  if (!p.position) errors.push('Missing position')
  if (!p.team) errors.push('Missing team')
  if (p.position && !VALID_POSITIONS_NFL.has(p.position)) {
    errors.push(`Invalid position: ${p.position}`)
  }
  return errors
}
