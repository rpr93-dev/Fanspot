import type { AdpPlatform, AdpSource, FantasyPlayerEnriched, ScoringFormat } from '@/lib/fantasy-types'
import { composeNote, resolveInjuryTier, type InjuryTier, type ResolvedInjury } from './injury-gate'
import { environmentScoreFor, envSignalFor, isSkillPosition, type EnvironmentSignal, type TeamEnvironment } from './environment'
import type { SchemeSignal } from './scheme-news'

const MAX_ADP = 500
const PROJECTION_FLOOR = 50

/**
 * ESPN's kona projection (`appliedTotal`) is Standard scoring — receptions are worth
 * zero. The only scoring-rule difference between NFL Standard / Half-PPR / PPR on ESPN
 * is the receptions-per-point value (0 / 0.5 / 1.0); all yardage, TD and INT values are
 * identical across the three presets. So a per-format projection is the Standard
 * baseline plus the reception bonus, exactly — no re-fetch, no double-count.
 */
function receptionRate(fmt: ScoringFormat | undefined): number {
  if (fmt === 'ppr') return 1
  if (fmt === 'half-ppr') return 0.5
  return 0
}

export function formatPointsFromStats(
  points: number,
  stats: Record<string, number> | undefined,
  fmt: ScoringFormat | undefined,
): number {
  const rec = stats?.['53'] ?? 0
  return points + rec * receptionRate(fmt)
}

/** Per-format projection for a player, applied wherever the board ranks by points. */
export function formatPoints(player: FantasyPlayerEnriched, fmt: ScoringFormat | undefined): number {
  return formatPointsFromStats(player.projection?.points ?? 0, player.projection?.stats, fmt)
}

/** Per-format prior-season points, used by the confidence score so a PPR-stud's track
 *  record earns more credit under PPR than Standard. Absent actuals -> 0. */
function formatPriorPoints(player: FantasyPlayerEnriched, fmt: ScoringFormat | undefined): number {
  if (!player.seasonActuals) return 0
  return formatPointsFromStats(player.seasonActuals.points, player.seasonActuals.stats, fmt)
}

const POSITION_MULTIPLIERS: Record<string, number> = {
  QB: 0.85,
  RB: 1.10,
  WR: 1.00,
  TE: 1.15,
  K: 0.01,
  'D/ST': 0.01,
}

function getPlatformAdp(
  player: FantasyPlayerEnriched,
  config: { adpPlatform?: AdpPlatform; scoringFormat: ScoringFormat },
): { adp: number | undefined; source: AdpSource } {
  const platform = config.adpPlatform ?? 'espn'
  // Sleeper's search_rank is a popularity metric, never a draft rank.
  if (platform === 'sleeper') return { adp: player.sleeper?.search_rank, source: 'popularity_fallback' }

  const source: AdpSource = player.adpSource ?? 'espn'
  if (config.scoringFormat === 'ppr' || config.scoringFormat === 'half-ppr') return { adp: player.pprRank, source }
  if (config.scoringFormat === 'standard') {
    return player.standardRank != null
      ? { adp: player.standardRank, source: 'espn' }
      : { adp: player.pprRank, source }
  }
  return player.pprRank != null ? { adp: player.pprRank, source } : { adp: player.standardRank, source: 'espn' }
}

function isActivePlayer(p: FantasyPlayerEnriched): boolean {
  return p.player?.active !== false
}

function computeExpectedRankings(
  players: FantasyPlayerEnriched[],
  fmt: ScoringFormat | undefined = 'ppr',
): Map<number, number> {
  const withProj = players
    .filter((p) => p.projection?.points != null && formatPoints(p, fmt) >= PROJECTION_FLOOR && p.normalizedPosition)
    .filter(isActivePlayer)
  withProj.sort((a, b) => formatPoints(b, fmt) - formatPoints(a, fmt))
  const ranks = new Map<number, number>()
  for (let i = 0; i < withProj.length; i++) {
    ranks.set(withProj[i].id, i + 1)
  }
  return ranks
}

function missedRecentSeason(player: FantasyPlayerEnriched): boolean {
  const exp = player.sleeper?.years_exp ?? 0
  if (exp <= 2) return false
  if (!player.seasonActuals) return false
  const priorPts = player.seasonActuals?.points ?? 0
  const hasAnyStats = Object.keys(player.seasonActuals.stats ?? {}).length > 0
  if (priorPts > 0 || hasAnyStats) return false
  return player.player.injured || player.player.injuryStatus === 'OUT' || player.player.injuryStatus === 'DOUBTFUL'
}

function computeConfidence(
  player: FantasyPlayerEnriched,
  envScore = 50,
  fmt: ScoringFormat | undefined = 'ppr',
): number {
  const priorPts = formatPriorPoints(player, fmt)
  const hasPrior = priorPts > 0
  const exp = player.sleeper?.years_exp ?? 0

  const priorScore = hasPrior ? Math.min(100, Math.round(priorPts / 3)) : 15
  const expScore = Math.min(100, exp * 12)
  let modelAgreement = Math.round(priorScore * 0.6 + expScore * 0.4)

  if (missedRecentSeason(player)) {
    modelAgreement = Math.round(modelAgreement * 0.25)
  }

  const opp = computeOpportunityValue(player)
  const roleCertainty = opp > 200 ? 90 : opp > 100 ? 75 : opp > 50 ? 55 : opp > 0 ? 35 : 10

  const injuryScore = player.player.injured ? 15 : 85

  const owned = player.player.ownership?.percentOwned ?? 0
  const marketScore = owned > 80 ? 95 : owned > 50 ? 70 : owned > 20 ? 50 : owned > 5 ? 30 : 10

  // Env carries 20%: scheme/offense quality decides how much the projection can be
  // believed, so it belongs beside the other trust signals, not inside the projection.
  const score = modelAgreement * 0.30 + roleCertainty * 0.25 + injuryScore * 0.15 + marketScore * 0.10 + envScore * 0.20
  return Math.max(0, Math.min(100, Math.round(score)))
}

function computeAdpDiscount(adp: number, expectedRank: number): number {
  const gap = Math.max(0, adp - expectedRank)
  return Math.min(60, Math.round(gap / 2))
}

function computeOpportunityValue(player: FantasyPlayerEnriched): number {
  const pos = player.normalizedPosition
  const stats = player.projection?.stats ?? {}
  if (pos === 'QB') return (stats['0'] ?? 0) + (stats['23'] ?? 0)
  if (pos === 'RB') return (stats['23'] ?? 0) + (stats['47'] ?? 0)
  if (pos === 'WR' || pos === 'TE') return stats['47'] ?? 0
  return 0
}

function getPosKey(p: FantasyPlayerEnriched): string {
  return p.normalizedPosition ?? ''
}

export const BOARD_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'] as const
export type BoardPosition = (typeof BOARD_POSITIONS)[number]

export interface StealRow {
  playerId: number
  name: string
  pos: string
  team: string
  /** Projected rank within position. */
  posRank: number
  /** ADP rank within position. */
  adpRank: number
  /** adpRank - posRank. Positive = falling past its value. */
  gap: number
  adpSource: AdpSource
  conf: number
  ownedPct: number
  note: string
  posPoolSize: number
  projectedPoints: number
  overallAdp: number
  impliedTeamTotal?: number
  injuryTier: InjuryTier
  injuryStatus: string
  injuryDetail?: string
  injurySource?: ResolvedInjury['source']
  /** False when no provider reported a designation — an absent report, not a clearance. */
  injuryDesignationKnown?: boolean
  /** True only when the headline cross-check ran and came back clean. */
  injuryChecked?: boolean
  /** Suspended players are unavailable regardless of health, so this is tracked apart. */
  suspended?: boolean
  /** True when the injury gate moved this row off its earned rank. */
  gateApplied: boolean
  gateReason?: 'severe-injury' | 'suspended' | 'doubtful-rank-floor'
  /** Rank by the requested sort before the gate ran, for the note text. */
  rankByGap?: number
  /** The prior-production fact behind `conf`, used when composing the note. */
  confidenceDriver: string
  /** 0-100 team offense environment (Vegas implied points, per-position weighted). */
  envScore: number
  envSignal: EnvironmentSignal
  /** 1-based rank of the team's Vegas implied points, for the note/badge. */
  envRank?: number
  /** How many teams had odds, so `envRank` reads in context. */
  envTeamCount?: number
  /** Applied scheme narrative shift (positive = favorable), absent when none. */
  schemeDelta?: number
  /** First headline behind the scheme signal, for the tooltip. */
  schemeHeadline?: string
}

export interface BoardConfig {
  scoringFormat: ScoringFormat
  adpPlatform?: AdpPlatform
}

/**
 * Minimum share of real leagues rostering a player for them to count as part of their
 * position's draftable pool. ESPN assigns a draft rank to literally every player on a
 * depth chart, so without this the pool fills with third-string QBs projected for 9
 * points whose "ADP" is filler — they'd distort the field bar's scale and top the gap
 * sort with noise. Ownership is a measured signal, so the pool size stays a real count
 * rather than a hardcoded per-position guess.
 */
const ROSTER_RELEVANCE_PCT = 1

/**
 * Ranks projection against ADP *within each position*, so a QB is never compared to a
 * kicker. Both ranks are computed over the same per-position pool, which is what makes
 * the gap meaningful and gives the field bar a real scale.
 */
export function buildStealBoard(
  players: FantasyPlayerEnriched[],
  config: BoardConfig,
  environment?: Map<string, TeamEnvironment>,
  schemeSignals?: Map<string, SchemeSignal>,
): StealRow[] {
  const boardPositions = new Set<string>(BOARD_POSITIONS)

  const eligible: { player: FantasyPlayerEnriched; adp: number; adpSource: AdpSource }[] = []
  for (const p of players) {
    if (!isActivePlayer(p)) continue
    if (p.syntheticEspnId === true) continue
    const pos = getPosKey(p)
    if (!boardPositions.has(pos)) continue
    if (formatPoints(p, config.scoringFormat) <= 0) continue
    if ((p.player.ownership?.percentOwned ?? 0) < ROSTER_RELEVANCE_PCT) continue

    const { adp, source } = getPlatformAdp(p, config)
    if (adp == null || adp <= 0) continue

    eligible.push({ player: p, adp, adpSource: source })
  }

  const byPos = new Map<string, typeof eligible>()
  for (const e of eligible) {
    const pos = getPosKey(e.player)
    const bucket = byPos.get(pos)
    if (bucket) bucket.push(e)
    else byPos.set(pos, [e])
  }

  const rows: StealRow[] = []

  for (const [pos, group] of byPos) {
    const posPoolSize = group.length

    const posRanks = new Map<number, number>()
    ;[...group]
      .sort((a, b) => formatPoints(b.player, config.scoringFormat) - formatPoints(a.player, config.scoringFormat))
      .forEach((e, i) => posRanks.set(e.player.id, i + 1))

    const adpRanks = new Map<number, number>()
    ;[...group]
      .sort((a, b) => a.adp - b.adp)
      .forEach((e, i) => adpRanks.set(e.player.id, i + 1))

    for (const e of group) {
      const posRank = posRanks.get(e.player.id) as number
      const adpRank = adpRanks.get(e.player.id) as number
      const pos = getPosKey(e.player)
      const team = e.player.proTeamAbbr || 'FA'
      const env = environment?.get(team.toUpperCase())
      const vegasEnv = environmentScoreFor(env, pos)
      const scheme = isSkillPosition(pos) ? schemeSignals?.get(team.toUpperCase()) : undefined
      const schemeDelta = scheme?.hasSignal ? scheme.delta : 0
      const envScore = Math.max(0, Math.min(100, vegasEnv + schemeDelta))
      const sleeper = e.player.sleeper as Record<string, unknown> | undefined
      const injury = resolveInjuryTier({
        espnStatus: e.player.player.injuryStatus,
        espnInjured: e.player.player.injured,
        sleeperStatus: typeof sleeper?.injury_status === 'string' ? sleeper.injury_status : undefined,
        rosterStatus: typeof sleeper?.status === 'string' ? sleeper.status : undefined,
        bodyPart: typeof sleeper?.injury_body_part === 'string' ? sleeper.injury_body_part : undefined,
        notes: typeof sleeper?.injury_notes === 'string' ? sleeper.injury_notes : undefined,
      })
      const row: StealRow = {
        playerId: e.player.id,
        name: e.player.player.fullName,
        pos,
        team: e.player.proTeamAbbr || 'FA',
        posRank,
        adpRank,
        gap: adpRank - posRank,
        adpSource: e.adpSource,
        conf: computeConfidence(e.player, envScore, config.scoringFormat),
        ownedPct: Math.round(e.player.player.ownership?.percentOwned ?? 0),
        note: '',
        posPoolSize,
        projectedPoints: Math.round(formatPoints(e.player, config.scoringFormat)),
        overallAdp: e.adp,
        impliedTeamTotal: e.player.vegas?.teamImpliedPoints,
        envScore,
        envSignal: envSignalFor(envScore),
        envRank: env?.envRank,
        envTeamCount: env?.teamCount,
        schemeDelta: schemeDelta !== 0 ? schemeDelta : undefined,
        schemeHeadline: scheme?.hasSignal ? scheme.headlines[0] : undefined,
        injuryTier: injury.tier,
        injuryStatus: e.player.player.injuryStatus || 'UNKNOWN',
        injuryDetail: injury.detail || undefined,
        injurySource: injury.source,
        injuryDesignationKnown: injury.designationKnown,
        injuryChecked: false,
        suspended: injury.suspended,
        gateApplied: false,
        confidenceDriver: buildConfidenceDriver(e.player),
      }
      row.note = composeNote(row)
      rows.push(row)
    }
  }

  rows.sort((a, b) => b.gap - a.gap || b.projectedPoints - a.projectedPoints)

  return rows
}

/**
 * The gap re-ranked by environment: a player on a top-tier offense is worth a little
 * more than the raw market-vs-projection math says, one on a bottom-tier offense a
 * little less. Range is ±5, so it re-orders borderline rows without letting scheme
 * dwarf the actual value math. Used only by the `scheme` sort — `gap` stays pure.
 */
export function envAdjustedGap(row: StealRow): number {
  return row.gap + Math.round((row.envScore - 50) / 10)
}

/** The prior-production fact behind the confidence score, phrased for the note. */
function buildConfidenceDriver(p: FantasyPlayerEnriched): string {
  if (missedRecentSeason(p)) return 'No production last season'

  const priorPts = p.seasonActuals?.points ?? 0
  if (priorPts > 0) return `${Math.round(priorPts)} FP last season`

  const exp = p.sleeper?.years_exp ?? 0
  if (exp === 0) return 'Rookie with no prior production'
  if (p.seasonActuals) return 'No production last season'
  return 'Limited prior-season data'
}

function computeLeagueWinnerPct(player: FantasyPlayerEnriched, allPlayers: FantasyPlayerEnriched[]): number {
  const pos = player.normalizedPosition ?? ''
  const pts = player.projection?.points ?? 0
  if (!pos || pts <= 0) return 0

  const posPlayers = allPlayers.filter((p) => p.normalizedPosition === pos)
  const maxProj = Math.max(...posPlayers.map((p) => p.projection?.points ?? 0), 1)
  const ceiling = Math.min(1, pts / maxProj)

  const age = player.sleeper?.age ?? 26
  const youthFactor = age < 24 ? 1.25 : age < 27 ? 1.0 : age < 30 ? 0.85 : 0.6

  const opp = computeOpportunityValue(player)
  const posMaxOpp = Math.max(...posPlayers.map((p) => computeOpportunityValue(p)), 1)
  const oppCeiling = Math.min(1, opp / posMaxOpp)

  const score = ceiling * 0.5 + oppCeiling * 0.3 + youthFactor * 0.2
  return Math.round(Math.min(100, Math.max(0, score * 100)))
}

export interface OutlookInputs {
  confidence: number
  adpDiscount: number
  leagueWinnerPct: number
  injured: boolean
  age?: number
  missedSeason: boolean
  /** Season the missed-year line should name. Omitted when the pipeline didn't report one. */
  missedSeasonYear?: number
}

export function buildOutlook(i: OutlookInputs): string {
  const { confidence, adpDiscount, leagueWinnerPct, injured, age, missedSeason } = i
  if (missedSeason) {
    const season = i.missedSeasonYear != null ? `the ${i.missedSeasonYear} season` : 'the most recent season'
    return `Missed ${season} - major red flag. Worth only a last-round flier.`
  }
  if (injured) return 'Currently injured - monitor preseason. Elite value if healthy by Week 1.'
  if (confidence >= 70 && leagueWinnerPct >= 80) return 'Proven producer with league-winning upside. One of the safest value picks in the draft.'
  if (confidence >= 60 && adpDiscount >= 40) return 'Strong track record at a significant ADP discount. High-confidence value target.'
  if (adpDiscount >= 50) return 'Extreme ADP discount - market has not priced in the projected role. High breakout potential.'
  if (confidence < 40 && adpDiscount >= 40) return 'High-risk, high-reward deep sleeper. Huge upside if the projection is close.'
  if (confidence < 40) return 'Significant uncertainty in projection. Volume or role questions limit conviction.'
  if (age && age > 30) return 'Veteran with proven production. Age caps ceiling but consistent value at this ADP.'
  return 'Solid value at current ADP. Projection and ADP align for a dependable contributor.'
}

/**
 * Outlook for a single player, assembled from the same inputs the steals board uses so
 * the team dashboard and the board can never disagree about a player.
 */
export function buildPlayerOutlook(
  player: FantasyPlayerEnriched,
  allPlayers: FantasyPlayerEnriched[],
  config: BoardConfig = { scoringFormat: 'ppr' },
): string {
  const expectedRanks = computeExpectedRankings(allPlayers, config.scoringFormat)
  const expectedRank = expectedRanks.get(player.id) ?? allPlayers.length
  const { adp } = getPlatformAdp(player, config)

  return buildOutlook({
    confidence: computeConfidence(player, 50, config.scoringFormat),
    adpDiscount: computeAdpDiscount(adp ?? MAX_ADP, expectedRank),
    leagueWinnerPct: computeLeagueWinnerPct(player, allPlayers),
    injured: player.player.injured,
    age: player.sleeper?.age,
    missedSeason: missedRecentSeason(player),
    missedSeasonYear: player.seasonActualsYear,
  })
}

// ESPN projection stat ids. Ids 5-14 and 44-51 are yardage-milestone bucket counts,
// not the totals they look like — reading 5 as interceptions reported Mahomes at 798.
const STAT_PASS_YDS = '3'
const STAT_PASS_TD = '4'
const STAT_INT = '20'
const STAT_RUSH_ATT = '23'
const STAT_RUSH_YDS = '24'
const STAT_RUSH_TD = '25'
const STAT_REC_YDS = '42'
const STAT_REC_TD = '43'
const STAT_RECEPTIONS = '53'
const STAT_TARGETS = '58'

export function formatProjStats(player: FantasyPlayerEnriched): string {
  const pos = player.normalizedPosition
  const stats = player.projection?.stats ?? {}
  const pts = player.projection?.points ?? 0
  if (!pos || pts <= 0) return ''

  if (pos === 'RB') {
    const rushAtt = Math.round(stats[STAT_RUSH_ATT] ?? 0)
    const rushYds = Math.round(stats[STAT_RUSH_YDS] ?? 0)
    const rushTD = Math.round(stats[STAT_RUSH_TD] ?? 0)
    const rec = Math.round(stats[STAT_RECEPTIONS] ?? 0)
    const recYds = Math.round(stats[STAT_REC_YDS] ?? 0)
    return `${rushAtt} rush, ${rushYds.toLocaleString()} yds, ${rushTD} TD | ${rec} rec, ${recYds.toLocaleString()} yds`
  }
  if (pos === 'WR' || pos === 'TE') {
    const tgt = Math.round(stats[STAT_TARGETS] ?? 0)
    const rec = Math.round(stats[STAT_RECEPTIONS] ?? 0)
    const recYds = Math.round(stats[STAT_REC_YDS] ?? 0)
    const recTD = Math.round(stats[STAT_REC_TD] ?? 0)
    return `${tgt} tgt, ${rec} rec, ${recYds.toLocaleString()} yds, ${recTD} TD`
  }
  if (pos === 'QB') {
    const passYds = Math.round(stats[STAT_PASS_YDS] ?? 0)
    const passTD = Math.round(stats[STAT_PASS_TD] ?? 0)
    const ints = Math.round(stats[STAT_INT] ?? 0)
    const rushYds = Math.round(stats[STAT_RUSH_YDS] ?? 0)
    const rushTD = Math.round(stats[STAT_RUSH_TD] ?? 0)
    let s = `${passYds.toLocaleString()} yds, ${passTD} TD, ${ints} INT`
    if (rushYds > 0 || rushTD > 0) s += ` | ${rushYds} rush yds, ${rushTD} rush TD`
    return s
  }
  return `${Math.round(pts)} FP`
}

export function getPositionMultipliers(): Record<string, number> {
  return { ...POSITION_MULTIPLIERS }
}
