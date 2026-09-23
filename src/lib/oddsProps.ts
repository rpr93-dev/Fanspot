/**
 * Parsing for The Odds API player-prop markets (event odds endpoint).
 *
 * Player-prop outcomes look like
 *   { name: "Over", description: "Jalen Brunson", point: 26.5, price: -115 }
 * — the SIDE is in `name`, the PLAYER in `description`. Single-sided markets
 * (anytime TD / goal scorer) use `name: "Yes"` or put the player in `name`.
 */

export interface MarketInfo {
  label: string
  /** Implied position (NFL grouping); null when the market spans positions. */
  position: string | null
  /** Projection stat id this market lines up with (for the edge column). */
  stat: string | null
}

export interface PropOutcome {
  name: string
  description?: string
  point?: number | string
  price?: number
}

export interface PropMarket {
  key: string
  outcomes?: PropOutcome[]
}

export interface NormalizedProp {
  market: string
  label: string
  position: string | null
  stat: string | null
  line: number
  over: number | null
  under: number | null
}

export interface NormalizedPlayer {
  name: string
  position: string | null
  team?: string | null
  props: NormalizedProp[]
}

export function parseLine(val: unknown): number | null {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const n = parseFloat(val)
    if (!isNaN(n)) return n
  }
  return null
}

function sideAndPlayer(o: PropOutcome): { side: 'over' | 'under' | 'yes' | null; player: string | null } {
  const name = (o.name ?? '').trim()
  const lower = name.toLowerCase()
  if (lower === 'over' || lower === 'under' || lower === 'yes') {
    return { side: lower, player: o.description?.trim() || null }
  }
  // Older / single-sided shape: player in `name`, side (if any) in `description`.
  const desc = (o.description ?? '').toLowerCase()
  const side = desc.includes('over') ? 'over' : desc.includes('under') ? 'under' : null
  return { side, player: name || null }
}

/** One market → one normalized prop per (player, line), with both sides' prices. */
export function normalizeMarket(market: PropMarket, infoByKey: Record<string, MarketInfo>): { player: string; prop: NormalizedProp }[] {
  const info = infoByKey[market.key]
  if (!info || !market.outcomes?.length) return []

  const byKey = new Map<string, { player: string; point: number; over: number | null; under: number | null; unsided: number[] }>()
  for (const o of market.outcomes) {
    const point = parseLine(o.point)
    const { side, player } = sideAndPlayer(o)
    if (point == null || !player) continue
    const k = `${player}::${point}`
    const entry = byKey.get(k) ?? { player, point, over: null, under: null, unsided: [] }
    const price = o.price ?? null
    if (side === 'over' || side === 'yes') entry.over = price
    else if (side === 'under') entry.under = price
    else if (price != null) entry.unsided.push(price)
    byKey.set(k, entry)
  }

  const out: { player: string; prop: NormalizedProp }[] = []
  for (const e of byKey.values()) {
    // No explicit sides: first price is the over, second the under.
    const over = e.over ?? e.unsided[0] ?? null
    const under = e.under ?? (e.over == null ? e.unsided[1] : e.unsided[0]) ?? null
    out.push({
      player: e.player,
      prop: { market: market.key, label: info.label, position: info.position, stat: info.stat, line: e.point, over, under },
    })
  }
  return out
}

export function groupByPlayer(markets: PropMarket[], infoByKey: Record<string, MarketInfo>): NormalizedPlayer[] {
  const result = new Map<string, NormalizedPlayer>()
  for (const m of markets) {
    for (const { player, prop } of normalizeMarket(m, infoByKey)) {
      const existing = result.get(player) ?? { name: player, position: prop.position, props: [] }
      if (!existing.position) existing.position = prop.position
      existing.props.push(prop)
      result.set(player, existing)
    }
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name))
}
