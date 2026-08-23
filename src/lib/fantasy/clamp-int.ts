/**
 * Parses an optional numeric setting against a sane [min, max] range.
 *
 * A missing value (null / undefined / empty string) means "use the documented
 * default" — NOT zero. Number(null) and Number('') are both 0, so a naive
 * Number-first parse silently clamps an omitted query param to the minimum
 * (e.g. a 12-team mock room becoming a 2-team room). Non-numeric garbage and
 * out-of-range values fall back / clamp respectively.
 */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (value == null) return fallback
  if (typeof value === 'string' && value.trim() === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}
