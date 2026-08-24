import type { AuctionRow, AuctionSettings, StarterSlots } from '@/lib/fantasy/auction-engine'
import { buildAuctionBoard } from '@/lib/fantasy/auction-engine'
import { buildUnifiedDatabase, unifiedToFantasyPlayerEnriched } from '@/lib/fantasy/unified-db'
import { getPositionMultipliers } from '@/lib/fantasy/steal-engine'
import type { FantasyPlayerEnriched } from '@/lib/fantasy-types'
import { normalizeName, abbrFromTeamName } from '../names'
import {
  computeFantasyProsValues,
  fetchFantasyProsRankings,
  perPositionCurves,
} from './fantasypros'
import type { BotValue, PricedRow, ValueIndex, ValueSource } from './types'

/**
 * The bot's player-pricing brain. Builds Fanspot's unified player database
 * (Sleeper master list joined to ESPN projections/ADP/ownership plus Vegas team
 * environments) once, then prices the pool with the configured source:
 *
 * - 'fanspot': the web app's auction board (ESPN projections -> VORP dollars),
 *   plus a fallback index so players sitting at the replacement line (mid-round
 *   RBs, most kickers, below-average D/STs) still get a consistent $1-2 value.
 * - 'fantasypros': expert consensus ECR ranks (503 players, complete) converted
 *   to dollars via the same VORP math, using real prior-season scoring curves.
 *   Unmatched names fall back to the Fanspot board.
 * - 'blend': average of the two when both have a real price.
 */

const AUCTION_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'])
const POSITION_WEIGHT = getPositionMultipliers()

export interface BuildValuesOptions {
  season?: number
  source?: ValueSource
}

export async function buildValues(
  settings: AuctionSettings,
  starters: StarterSlots,
  opts: BuildValuesOptions = {},
): Promise<ValueIndex> {
  const source = opts.source ?? 'fanspot'
  const { players } = await buildUnifiedDatabase({ season: opts.season })
  const enriched = players.map((u) => unifiedToFantasyPlayerEnriched(u) as unknown as FantasyPlayerEnriched)
  const board = buildAuctionBoard(enriched, settings, starters)

  // The Fanspot index is the fallback/overlay in every mode: injury status, market
  // reference, and pricing for names FantasyPros doesn't cover.
  const fanspotIndex = buildFanspotIndex(enriched, settings, starters, board)

  if (source === 'fanspot') {
    return {
      rows: board.rows.map(toPricedRow),
      injuryWatch: board.injuryWatch.map(toPricedRow),
      byKey: fanspotIndex,
      assumptions: board.assumptions,
      builtAtMs: Date.now(),
      source,
    }
  }

  // FantasyPros ECR -> dollars (fetch once, cached 6h).
  const fpPlayers = await fetchFantasyProsRankings()
  const curves = perPositionCurves(enriched, settings.scoringFormat)
  const fp = computeFantasyProsValues(fpPlayers, settings, starters, curves)
  const fpByKey = new Map<string, BotValue>()

  const unavailable = new Map<string, string>()
  for (const r of board.injuryWatch) {
    const reason = r.suspended ? 'suspended' : r.injuryDetail || r.injuryTier
    unavailable.set(normalizeName(r.name), reason)
  }

  for (const e of fp.entries) {
    const key = normalizeName(e.player.name)
    const fanspotHit = fanspotIndex.get(key)
    const market = fanspotHit?.market ?? null
    const value = source === 'blend' && fanspotHit && fanspotHit.source === 'board'
      ? Math.round(((fanspotHit.value + e.value) / 2) * 10) / 10
      : e.value
    const reason = unavailable.get(key)
    fpByKey.set(key, {
      name: e.player.name,
      pos: e.player.pos,
      team: e.player.team,
      value,
      market,
      surplus: market != null ? Math.round((value - market) * 10) / 10 : null,
      unavailable: reason != null,
      unavailableReason: reason,
      source: source === 'blend' && fanspotHit && fanspotHit.source === 'board' ? 'blend' : 'fantasypros',
      fp: {
        ecr: e.player.ecr,
        posEcr: e.player.posEcr,
        tier: e.player.tier,
        owned: e.player.owned,
      },
    })
  }

  // Players Fanspot prices that FantasyPros doesn't cover stay available.
  if (source === 'blend') {
    for (const [key, v] of fanspotIndex) {
      if (!fpByKey.has(key)) fpByKey.set(key, v)
    }
  }

  const rows: PricedRow[] = [...fpByKey.values()]
    .filter((v) => !v.unavailable)
    .map((v) => ({ name: v.name, pos: v.pos, team: v.team, value: v.value, surplus: v.surplus }))
    .sort((a, b) => {
      const sa = a.surplus ?? -Infinity
      const sb = b.surplus ?? -Infinity
      return sb - sa || b.value - a.value
    })

  return {
    rows,
    injuryWatch: board.injuryWatch.map(toPricedRow),
    byKey: fpByKey,
    assumptions: fp.assumptions,
    builtAtMs: Date.now(),
    source,
  }
}

function toPricedRow(r: AuctionRow): PricedRow {
  return { name: r.name, pos: r.pos, team: r.team, value: r.value, surplus: r.surplus }
}

/** Fanspot board rows + fallback pricing, keyed by normalized name. */
function buildFanspotIndex(
  enriched: FantasyPlayerEnriched[],
  settings: AuctionSettings,
  starters: StarterSlots,
  board: ReturnType<typeof buildAuctionBoard>,
): Map<string, BotValue> {
  const byKey = new Map<string, BotValue>()

  const boardRowToValue = (r: AuctionRow, unavailable: boolean, reason?: string): BotValue => ({
    name: r.name,
    pos: r.pos,
    team: r.team,
    value: r.value,
    market: r.market,
    surplus: r.surplus,
    unavailable,
    unavailableReason: reason,
    source: 'board',
  })

  for (const r of board.rows) byKey.set(normalizeName(r.name), boardRowToValue(r, false))
  for (const r of board.injuryWatch) {
    const reason = r.suspended ? 'suspended' : r.injuryDetail || r.injuryTier
    byKey.set(normalizeName(r.name), boardRowToValue(r, true, reason))
  }

  // Fallback: every projected player in an auction position, priced at the board's
  // replacement levels and dollars-per-point rate.
  const scale = marketScale(enriched, board.assumptions.totalMoney)
  for (const p of enriched) {
    const pos = p.normalizedPosition ?? ''
    if (!AUCTION_POSITIONS.has(pos)) continue
    const proj = p.projection?.points ?? 0
    if (proj <= 0) continue
    const key = normalizeName(p.player.fullName)
    if (byKey.has(key)) continue

    const repl = board.assumptions.replacementLevels[pos] ?? 0
    const vorp = Math.max(0, (proj - repl) * (POSITION_WEIGHT[pos] ?? 1))
    const value = Math.max(1, Math.round((1 + vorp * board.assumptions.dollarsPerPoint) * 10) / 10)
    const published = p.player.ownership?.auctionValueAverage ?? 0
    const market = scale != null && published > 0 ? Math.round(published * scale * 10) / 10 : null

    byKey.set(key, {
      name: p.player.fullName,
      pos,
      team: p.proTeamAbbr || 'FA',
      value,
      market,
      surplus: market != null ? Math.round((value - market) * 10) / 10 : null,
      unavailable: false,
      source: 'fallback',
    })
  }
  return byKey
}

/** Same rescale the auction engine applies to ESPN's published averages. */
function marketScale(players: FantasyPlayerEnriched[], totalMoney: number): number | null {
  const publishedTotal = players.reduce(
    (sum, p) => sum + Math.max(0, p.player.ownership?.auctionValueAverage ?? 0),
    0,
  )
  if (publishedTotal <= 0) return null
  return totalMoney / publishedTotal
}

/** Look up a Yahoo-displayed player name in the value index (board rows first, fallback second). */
export function lookup(values: ValueIndex, rawName: string, posHint?: string): BotValue | null {
  const key = normalizeName(rawName)
  if (key.length === 0) return null

  // D/ST nominations arrive as team names ("49ers Defense"); the slash in "D/ST" is
  // stripped by normalization, so test both raw and key.
  const isDefense = /def|dst|d\/st/i.test(rawName) || /\bd st\b|dst|def/i.test(key)
  if (isDefense) {
    const abbr = abbrFromTeamName(rawName)
    const byTeam: BotValue[] = []
    for (const v of values.byKey.values()) {
      if (v.pos === 'D/ST' && (abbr == null || v.team === abbr)) byTeam.push(v)
    }
    if (byTeam.length > 0) {
      // Prefer a priced board row over the $1 fallback.
      return byTeam.find((v) => v.source === 'board') ?? byTeam[0] ?? null
    }
  }

  const direct = values.byKey.get(key)
  if (direct) return direct

  // Loose fallback for Yahoo name variants we didn't normalize exactly.
  if (key.length >= 3) {
    const first = key.split(' ')[0] ?? ''
    for (const [k, v] of values.byKey) {
      if (k.includes(key) && k.startsWith(first)) return v
    }
  }
  return null
}

export type { BotValue, PricedRow, ValueIndex, ValueSource } from './types'
