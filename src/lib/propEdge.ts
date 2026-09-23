/**
 * Projection-vs-book-line edge (client-safe). Shared by the NFL prop-model
 * table and the NBA/NHL/MLB projection table so every sport's picks are
 * computed and rendered the same way.
 */

/** Standard normal CDF (Abramowitz & Stegun rational approximation). */
export function normalCdf(x: number): number {
  const ax = Math.abs(x)
  const t = 1.0 / (1.0 + 0.2316419 * ax)
  const pdf = 0.3989422804014327 * Math.exp(-ax * ax / 2)
  const cdf = 1.0 - pdf * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x < 0 ? 1.0 - cdf : cdf
}

export type EdgePick = 'over' | 'under' | 'fair'

export interface OverUnderEdge {
  pick: EdgePick
  /** P(result > line) under a normal(projection, sd). */
  prob: number
  /** projection − line, in stat units. */
  edge: number
  strong: boolean
}

/** P(over) and a lean from a projection with spread `sd` against a book line. */
export function computeOverUnderEdge(projection: number | null, sd: number | null, lineArg: unknown): OverUnderEdge | null {
  const line = typeof lineArg === 'number' ? lineArg : NaN
  if (isNaN(line) || line <= 0) return null
  if (projection == null || sd == null || sd <= 0) return { pick: 'fair', prob: 0.5, edge: 0, strong: false }
  const s = Math.max(sd, 0.01)
  const edge = projection - line
  const overProb = 1.0 - normalCdf((line - projection) / s)
  const absZ = Math.abs(edge / s)
  const pick: EdgePick = absZ < 0.3 ? 'fair' : edge > 0 ? 'over' : 'under'
  const strong = absZ >= 0.5 && ((pick === 'over' && overProb >= 0.65) || (pick === 'under' && overProb <= 0.35))
  return { pick, prob: overProb, edge, strong }
}

/** Confidence shown on the badge: the picked side's probability (majority side for fair). */
export function pickConfidencePct(e: OverUnderEdge): number {
  const p = e.pick === 'fair' ? Math.max(e.prob, 1 - e.prob) : e.pick === 'over' ? e.prob : 1 - e.prob
  return Math.round(p * 100)
}

export const EDGE_STYLES: Record<EdgePick, { label: string; bg: string; fg: string; strongBg: string; strongFg: string }> = {
  over: { label: 'OVER', bg: 'bg-fs-turf/15', fg: 'text-fs-turf', strongBg: 'bg-fs-turf', strongFg: 'text-fs-bg' },
  under: { label: 'UNDER', bg: 'bg-fs-red/15', fg: 'text-fs-red', strongBg: 'bg-fs-red', strongFg: 'text-fs-bg' },
  fair: { label: 'FAIR', bg: 'bg-fs-muted-2/10', fg: 'text-fs-muted-2', strongBg: 'bg-fs-muted-2/10', strongFg: 'text-fs-muted-2' },
}

export function formatPrice(p: number | null | undefined): string {
  if (p == null) return '—'
  return p > 0 ? `+${p}` : `${p}`
}

/** Loose player-name match for joining book lines to projections. */
export function normalizePlayerName(n: string): string {
  return n
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
