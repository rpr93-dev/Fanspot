import type { SportKey } from '@/lib/models'
import { teams } from '@/data/teams'

/**
 * Per-sport visual identity. Each league gets its own accent pair, signature
 * motif, and copy so the hubs read as five distinct destinations rather than
 * one recoloured template. `accent` drives the eyebrow dot, section markers,
 * and progress bars; `glow` is the soft page background; `motif` selects the
 * hero SVG.
 */
export interface SportTheme {
  key: SportKey
  label: string
  fullName: string
  /** Primary accent used for markers, links, and chips. */
  accent: string
  /** Secondary livery colour used in gradients and motifs. */
  accent2: string
  /** Very low-alpha wash for the page background glow. */
  glow: string
  /** Short line under the hub title. */
  tagline: string
  /** Noun for the roster of teams ("teams" / "constructors"). */
  teamsNoun: string
  motif: 'gridiron' | 'hardwood' | 'ice' | 'diamond' | 'circuit'
}

const THEMES: Record<SportKey, SportTheme> = {
  NFL: {
    key: 'NFL',
    label: 'NFL',
    fullName: 'National Football League',
    accent: '#8bc53f',
    accent2: '#013369',
    glow: '#8bc53f',
    tagline: '32 teams · 2 conferences · 8 divisions · 18 weeks',
    teamsNoun: 'teams',
    motif: 'gridiron',
  },
  NBA: {
    key: 'NBA',
    label: 'NBA',
    fullName: 'National Basketball Association',
    accent: '#f97316',
    accent2: '#c9082a',
    glow: '#f97316',
    tagline: '30 teams · 2 conferences · 6 divisions · 82 games',
    teamsNoun: 'teams',
    motif: 'hardwood',
  },
  NHL: {
    key: 'NHL',
    label: 'NHL',
    fullName: 'National Hockey League',
    accent: '#38bdf8',
    accent2: '#003e7e',
    glow: '#38bdf8',
    tagline: '32 teams · 2 conferences · 4 divisions · 82 games',
    teamsNoun: 'teams',
    motif: 'ice',
  },
  MLB: {
    key: 'MLB',
    label: 'MLB',
    fullName: 'Major League Baseball',
    accent: '#f43f5e',
    accent2: '#002d72',
    glow: '#f43f5e',
    tagline: '30 teams · 2 leagues · 6 divisions · 162 games',
    teamsNoun: 'teams',
    motif: 'diamond',
  },
  F1: {
    key: 'F1',
    label: 'F1',
    fullName: 'Formula 1',
    accent: '#e10600',
    accent2: '#00d7b6',
    glow: '#e10600',
    tagline: `${teams.filter((t) => t.sport === 'F1').length || 11} constructors · ${(teams.filter((t) => t.sport === 'F1').length || 11) * 2} drivers · 24 grands prix`,
    teamsNoun: 'constructors',
    motif: 'circuit',
  },
}

export function sportTheme(sport: string | null | undefined): SportTheme {
  const key = (sport ?? '').toUpperCase() as SportKey
  return THEMES[key] ?? THEMES.NFL
}

export const SPORT_THEME = THEMES
