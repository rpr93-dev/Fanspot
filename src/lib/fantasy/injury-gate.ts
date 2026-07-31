import type { StealRow } from './steal-engine'

export type InjuryTier = 'healthy' | 'probable' | 'questionable' | 'doubtful' | 'out' | 'severe'

const TIER_RANK: Record<InjuryTier, number> = {
  healthy: 0,
  probable: 1,
  questionable: 2,
  doubtful: 3,
  out: 4,
  severe: 5,
}

export function moreSevere(a: InjuryTier, b: InjuryTier): InjuryTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b
}

/** Doubtful players stay on the board but can never occupy a top-10 slot. */
export const DOUBTFUL_RANK_FLOOR = 10

/** Rows scanned for severity language in headlines. Each one costs a network call. */
export const DEFAULT_CROSS_CHECK_TOP = 30

/**
 * Structural damage — a tear, a season-ending designation or an IR placement is severe
 * no matter how upbeat the surrounding coverage is.
 */
const STRUCTURAL_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bacl\b/i, label: 'ACL' },
  { re: /achilles/i, label: 'Achilles' },
  { re: /\btorn\b|\btear\b|ruptur/i, label: 'tear' },
  { re: /season[-\s]ending|out for (the )?season|miss(es|ed)? the (rest of the )?season/i, label: 'season-ending' },
  { re: /injured reserve|\b(placed on|on the|to the) ir\b|\bpup list\b|non-football injury/i, label: 'IR' },
  { re: /fractur|broken (leg|foot|ankle|arm|collarbone|hand)/i, label: 'fracture' },
]

/** Severe on their own, but recovery coverage can legitimately clear them. */
const SOFT_SEVERE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /surger|operat(ed|ion)/i, label: 'surgery' },
  { re: /no (return )?time(table|line)|time(table|line) (is )?unclear|out indefinitely|indefinite/i, label: 'no return timeline' },
]

const RECOVERY_RE =
  /cleared|activated off|returns? to (practice|action)|back (at|in) practice|full participant|no restrictions|ahead of schedule|expected to (play|suit up)|fully recovered/i

/**
 * Returns the severity label when the text describes a long-term injury, or null.
 * Recovery language only clears the soft signals — it never overrides a torn ligament.
 */
export function detectSevereLanguage(text: string | undefined): string | null {
  if (!text) return null
  for (const { re, label } of STRUCTURAL_PATTERNS) {
    if (re.test(text)) return label
  }
  if (RECOVERY_RE.test(text)) return null
  for (const { re, label } of SOFT_SEVERE_PATTERNS) {
    if (re.test(text)) return label
  }
  return null
}

function tierFromDesignation(status: string | undefined): InjuryTier {
  const s = (status ?? '').toUpperCase().replace(/[\s-]+/g, '_')
  if (s === '' || s === 'ACTIVE' || s === 'NORMAL' || s === 'HEALTHY') return 'healthy'
  if (s === 'PROBABLE' || s === 'DAY_TO_DAY' || s === 'DTD') return 'probable'
  if (s === 'QUESTIONABLE') return 'questionable'
  if (s === 'DOUBTFUL') return 'doubtful'
  if (s === 'OUT') return 'out'
  if (s.includes('IR') || s.includes('INJURY_RESERVE') || s === 'PUP' || s === 'NFI' || s.includes('SEASON')) {
    return 'severe'
  }
  return 'healthy'
}

export interface InjurySignals {
  /** ESPN's designation — the primary source, but it lags real severity. */
  espnStatus?: string
  espnInjured?: boolean
  sleeperStatus?: string
  /** Sleeper's structured detail, e.g. `Knee - ACL`. */
  bodyPart?: string
  /** Sleeper's free-text note, e.g. `Surgery`. */
  notes?: string
}

export interface ResolvedInjury {
  tier: InjuryTier
  /** Human-readable cause, e.g. `Knee - ACL`, `torn ACL`. Empty when healthy. */
  detail: string
  source: 'espn' | 'sleeper-detail' | 'headlines' | 'none'
}

/**
 * ESPN listed Tyreek Hill as merely Questionable while Sleeper carried
 * `Knee - ACL` / `Surgery`, so the structured detail fields are scanned for severity
 * language too. This costs nothing — it is already in memory — unlike the headline check.
 */
export function resolveInjuryTier(signals: InjurySignals): ResolvedInjury {
  const espnTier = tierFromDesignation(signals.espnStatus)
  let tier = moreSevere(espnTier, tierFromDesignation(signals.sleeperStatus))
  let source: ResolvedInjury['source'] = tier === 'healthy' ? 'none' : 'espn'

  if (tier === 'healthy' && signals.espnInjured) {
    tier = 'questionable'
    source = 'espn'
  }

  const detailText = [signals.bodyPart, signals.notes].filter(Boolean).join(' — ')
  const severeLabel = detectSevereLanguage(detailText)
  if (severeLabel && TIER_RANK[tier] < TIER_RANK.severe) {
    tier = 'severe'
    source = 'sleeper-detail'
  }

  return { tier, detail: tier === 'healthy' ? '' : detailText, source }
}

export interface GateOptions {
  sport: string
  crossCheckTop?: number
  /** Injected so tests and the widget path can skip the network entirely. */
  fetchHeadlines?: (name: string, team: string, sport: string) => Promise<string[]>
}

export interface GateResult {
  board: StealRow[]
  injuryWatch: StealRow[]
}

/**
 * Post-processing gate. Runs on an already-ranked list and never feeds back into the
 * score — a severe injury removes a player from the board outright rather than being
 * averaged away by a large ADP gap.
 */
export async function applyInjuryGate(ranked: StealRow[], opts: GateOptions): Promise<GateResult> {
  const rows = ranked.map((r, i) => ({ ...r, rankByGap: i + 1 }))

  const crossCheckTop = opts.crossCheckTop ?? DEFAULT_CROSS_CHECK_TOP
  if (opts.fetchHeadlines) {
    const candidates = rows.slice(0, crossCheckTop).filter((r) => r.injuryTier !== 'severe')
    await Promise.all(
      candidates.map(async (row) => {
        let headlines: string[]
        try {
          headlines = await opts.fetchHeadlines!(row.name, row.team, opts.sport)
        } catch {
          return
        }
        for (const h of headlines) {
          const label = detectSevereLanguage(h)
          if (label) {
            row.injuryTier = 'severe'
            row.injuryDetail = row.injuryDetail || label
            row.injurySource = 'headlines'
            return
          }
        }
      }),
    )
  }

  const board: StealRow[] = []
  const injuryWatch: StealRow[] = []
  const demoted: StealRow[] = []

  for (const row of rows) {
    if (row.injuryTier === 'severe') {
      row.gateApplied = true
      row.gateReason = 'severe-injury'
      injuryWatch.push(row)
    } else if (row.injuryTier === 'doubtful' && board.length < DOUBTFUL_RANK_FLOOR) {
      row.gateApplied = true
      row.gateReason = 'doubtful-rank-floor'
      demoted.push(row)
    } else {
      board.push(row)
      // A demoted player is only held until the floor is filled by healthier rows.
      while (demoted.length > 0 && board.length >= DOUBTFUL_RANK_FLOOR) {
        board.push(demoted.shift() as StealRow)
      }
    }
  }
  board.push(...demoted)

  for (const row of board) row.note = composeNote(row)
  for (const row of injuryWatch) row.note = composeNote(row)

  return { board, injuryWatch }
}

function gapClause(row: StealRow): string {
  const projected = `${row.pos}${row.posRank}`
  const priced = `${row.pos}${row.adpRank}`
  if (row.gap > 0) return `Falling past projected value — ${projected} projection at ${priced} price`
  if (row.gap < 0) return `Going ahead of projection — drafted ${priced} for ${projected} production`
  return `Priced about right — ${projected} projection at ${priced}`
}

/** Composed from whatever actually drove the outcome: injury > ADP gap > confidence. */
export function composeNote(row: StealRow): string {
  const detail = row.injuryDetail ? ` (${row.injuryDetail})` : ''

  if (row.injuryTier === 'severe') {
    return `Severe injury${detail} — excluded from main board, moved to Injury Watch.`
  }
  if (row.injuryTier === 'doubtful') {
    const rank = row.rankByGap ? `Ranked #${row.rankByGap} by ADP-gap, but ` : ''
    return `${rank}tagged Doubtful${detail} — treat as a hold, not a steal.`
  }
  if (row.injuryTier === 'out') {
    const rank = row.rankByGap ? `Ranked #${row.rankByGap} by ADP-gap, but ` : ''
    return `${rank}listed Out${detail} — a week-specific absence, not a season-long write-off.`
  }
  if (row.injuryTier === 'questionable' || row.injuryTier === 'probable') {
    const tag = row.injuryTier === 'questionable' ? 'Questionable' : 'Probable'
    return `${gapClause(row)}, though tagged ${tag}${detail}.`
  }
  return `${gapClause(row)} with no injury concerns. ${row.confidenceDriver}.`
}
