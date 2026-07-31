import { teams } from '@/data/teams'

export interface TeamTheme {
  name: string
  accent: string
  accentSoft: string
  glow: string
}

function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return [h / 6, s, l]
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255]
}

/** Relative luminance, sRGB, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => c / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/**
 * Board background sits near #0B0F0D, so a dark brand color (Giants navy, Raiders
 * black) disappears against it. Anything below this gets lightened until it reads.
 */
const MIN_ACCENT_LUMINANCE = 0.18
/** Ceiling for near-white brand colors, which glare on the dark panel. */
const MAX_ACCENT_LUMINANCE = 0.75

/**
 * Nudges a brand hex into a band that stays legible on the dark board. Lightness moves
 * in HSL so the hue survives — mixing toward white turned Giants navy into grey.
 */
export function adjustForDarkTheme(hex: string): string {
  const [h, s0, l0] = rgbToHsl(toRgb(hex))
  // A pure black or white brand color has no hue to preserve; give it a usable grey.
  const s = s0 === 0 ? 0 : Math.max(s0, 0.35)
  let l = l0
  let out = toHex(hslToRgb([h, s, l]))

  let guard = 0
  while (luminance(out) < MIN_ACCENT_LUMINANCE && l < 0.95 && guard++ < 40) {
    l += 0.02
    out = toHex(hslToRgb([h, s, l]))
  }
  guard = 0
  while (luminance(out) > MAX_ACCENT_LUMINANCE && l > 0.05 && guard++ < 40) {
    l -= 0.02
    out = toHex(hslToRgb([h, s, l]))
  }
  return out
}

/** Lightness shift used to separate a mono palette's two accents. */
function shiftLightness(hex: string, delta: number): string {
  const [h, s, l] = rgbToHsl(toRgb(hex))
  return toHex(hslToRgb([h, s, Math.max(0, Math.min(1, l + delta))]))
}


/**
 * Resolves a `?theme=` team code to accent tokens. Returns null for an unknown code so
 * the board keeps its neutral palette rather than falling back to an arbitrary team.
 */
export function resolveTeamTheme(sport: string, code: string | null): TeamTheme | null {
  if (!code) return null
  const upperSport = sport.toUpperCase()
  const wanted = code.toUpperCase()
  const team = teams.find(
    (t) => t.sport === upperSport && (t.abbreviation.toUpperCase() === wanted || t.id.toUpperCase() === wanted),
  )
  if (!team) return null

  const primary = adjustForDarkTheme(team.colors.primary)
  const secondary = adjustForDarkTheme(team.colors.secondary)
  // Two near-identical colors (e.g. a mono palette) would flatten the accent pair.
  const accentSoft =
    Math.abs(luminance(primary) - luminance(secondary)) < 0.05 ? shiftLightness(primary, 0.18) : secondary

  return { name: team.name, accent: primary, accentSoft, glow: `${primary}22` }
}

/**
 * Only chrome tokens are themed. `--turf` and `--red` encode value vs. reach on the
 * field bar and must mean the same thing on every team's board.
 */
export function themeVars(theme: TeamTheme | null): React.CSSProperties {
  if (!theme) return {}
  return {
    '--accent': theme.accent,
    '--accent-soft': theme.accentSoft,
    '--accent-glow': theme.glow,
  } as React.CSSProperties
}
