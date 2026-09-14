/**
 * Shared parsing + comparison-bar math for head-to-head team stat rows.
 *
 * The displayed value (e.g. "7:26", "4/10", "67%") is kept separate from the
 * numeric value used to size the comparison bar. Every parser here is
 * defensive: null / missing / malformed input yields null (unknown) or 0,
 * never NaN or Infinity.
 */

export interface StatComparisonInput {
  /** Centered, muted label (e.g. "Total Yards"). */
  label: string;
  /** Raw display strings, exactly as they come from the data source. */
  awayValue: string | null;
  homeValue: string | null;
  /** Numeric magnitudes used for the comparison bar. Null = unknown. */
  awayNumericValue: number | null;
  homeNumericValue: number | null;
}

function toFinite(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

/** "1,234" -> 1234, "67%" -> 67, "-3.5" -> -3.5. Returns null when unparsable. */
export function parsePlainNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '--') return null;
  // Trailing % is a plain magnitude (a 67% efficiency beats 40%).
  const pct = cleaned.endsWith('%') ? cleaned.slice(0, -1) : cleaned;
  if (!/^[-+]?(\d+(\.\d+)?|\.\d+)$/.test(pct.trim())) return null;
  return toFinite(parseFloat(pct));
}

/** "7:26" -> 446 seconds. Returns null when unparsable. */
export function parseClockToSeconds(raw: string): number | null {
  const m = raw.trim().match(/^(\d+):([0-5]?\d)$/);
  if (!m) return null;
  const secs = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return toFinite(secs);
}

/**
 * "4/10" style ratios. Uses efficiency (made/att) scaled to a 0-100 range so
 * it stays comparable with percentage stats, falling back to `made` when
 * attempts are 0/missing. Returns null when unparsable.
 */
export function parseRatio(raw: string): number | null {
  const m = raw.trim().match(/^([-+]?[\d.]+)\s*\/\s*([-+]?[\d.]+)$/);
  if (!m) return null;
  const made = parseFloat(m[1]);
  const att = parseFloat(m[2]);
  if (!Number.isFinite(made) || !Number.isFinite(att)) return null;
  if (att > 0) return toFinite((made / att) * 100);
  return toFinite(made);
}

/**
 * Best-effort numeric magnitude for any team-stat display string.
 * Order matters: clock ("7:26") before plain numbers, ratio ("4/10",
 * "4-10", "4 of 10") before plain numbers, percentages handled inside
 * parsePlainNumber.
 */
export function parseStatNumeric(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '' || s === '-' || s === '--' || s.toLowerCase() === 'n/a') return null;

  // Clock takes precedence ("7:26" must not parse as 7).
  if (/^\d+:[0-5]?\d$/.test(s)) return parseClockToSeconds(s);

  // Ratio forms: "4/10", "4-10" (football downs), "4 of 10".
  const ofMatch = s.match(/^([-+]?[\d.]+)\s+of\s+([-+]?[\d.]+)$/i);
  if (ofMatch) return parseRatio(`${ofMatch[1]}/${ofMatch[2]}`);
  if (/^[-+]?[\d.]+\s*\/\s*[-+]?[\d.]+$/.test(s)) return parseRatio(s);
  const dashRatio = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (dashRatio) {
    const r = parseRatio(`${dashRatio[1]}/${dashRatio[2]}`);
    if (r != null) return r;
  }

  return parsePlainNumber(s);
}

/**
 * Numeric magnitude of one side of a compound "A-B" / "A/B" display value
 * (e.g. sacks "1-8" -> sack count with 'first', penalty "5-60" -> yards
 * with 'second'). Returns null when unparsable — never NaN.
 */
export function parseCompoundPart(raw: string, part: 'first' | 'second'): number | null {
  const m = raw.trim().match(/^([-+]?[\d.,]+)\s*[-/]\s*([-+]?[\d.,]+)$/)
  if (!m) return null
  const n = parseFloat(m[part === 'first' ? 1 : 2].replace(/,/g, ''))
  return toFinite(n)
}

/**
 * Shared-bar split as fractions [awayShare, homeShare] summing to 1.
 * - null/unknown values are treated as 0 magnitude.
 * - negative magnitudes are clamped to 0 for sizing (rare, e.g. negative
 *   return yards); the displayed value is untouched.
 * - 0 vs 0 (or both unknown) -> even 50/50 with no winner.
 * - a minimum visible share keeps a shutout (e.g. 0 vs 14) from vanishing.
 */
const MIN_SHARE = 0.06;

export function barShares(
  away: number | null,
  home: number | null,
): { awayShare: number; homeShare: number } {
  const a = away == null || !Number.isFinite(away) ? 0 : Math.max(0, away);
  const h = home == null || !Number.isFinite(home) ? 0 : Math.max(0, home);
  const total = a + h;
  if (total <= 0) return { awayShare: 0.5, homeShare: 0.5 };

  let awayShare = a / total;
  let homeShare = h / total;
  // Enforce a minimum sliver for the trailing side only when it actually
  // has 0 magnitude but the leader doesn't (0 vs 14 -> 6/94, not 0/100).
  // Uneven-but-nonzero splits (10 vs 90) pass through untouched.
  if (a === 0 && h > 0) {
    awayShare = MIN_SHARE;
    homeShare = 1 - MIN_SHARE;
  } else if (h === 0 && a > 0) {
    homeShare = MIN_SHARE;
    awayShare = 1 - MIN_SHARE;
  }
  return { awayShare, homeShare };
}

/** True when both sides have no displayable value at all. */
export function isMissingRow(awayValue: string | null, homeValue: string | null): boolean {
  const empty = (v: string | null) =>
    v == null || v.trim() === '' || v.trim() === '-' || v.trim() === '--';
  return empty(awayValue) && empty(homeValue);
}

export const MIN_BAR_SHARE = MIN_SHARE;
