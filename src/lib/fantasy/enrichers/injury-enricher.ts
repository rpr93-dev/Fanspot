import type { CanonicalPlayer, PlayerInjury, IntegrationLog } from '../player-types'

const logs: IntegrationLog[] = []

function log(level: IntegrationLog['level'], source: string, message: string, details?: Record<string, unknown>) {
  const entry: IntegrationLog = { timestamp: Date.now(), level, source, message, details }
  logs.push(entry)
}

export interface InjuryEnrichmentResult {
  injuries: Map<string, PlayerInjury>
  source: string
}

export async function enrichInjuries(
  players: CanonicalPlayer[],
  espnInjuryMap: Map<number, { injured: boolean; injuryStatus: string }>,
): Promise<InjuryEnrichmentResult> {
  const injuries = new Map<string, PlayerInjury>()

  for (const p of players) {
    const sleeperId = p.sleeperId
    const espnEntry = p.espnId != null ? espnInjuryMap.get(p.espnId) : undefined

    if (espnEntry) {
      injuries.set(sleeperId, {
        status: mapInjuryStatus(espnEntry.injuryStatus),
        injured: espnEntry.injured,
      })
    } else {
      injuries.set(sleeperId, {
        status: 'unknown',
        injured: false,
      })
    }
  }

  log('info', 'injury', `Processed injuries for ${players.length} players`)

  return { injuries, source: 'espn' }
}

export function mapInjuryStatus(status: string | undefined): PlayerInjury['status'] {
  const upper = (status ?? '').toUpperCase()
  if (upper === 'ACTIVE') return 'ACTIVE'
  if (upper === 'QUESTIONABLE') return 'QUESTIONABLE'
  if (upper === 'DOUBTFUL') return 'DOUBTFUL'
  if (upper === 'OUT') return 'OUT'
  if (upper === 'IR') return 'IR'
  if (upper === 'PUP') return 'PUP'
  if (upper === 'SUSPENDED' || upper === 'SUSP') return 'SUSPENDED'
  return 'unknown'
}
