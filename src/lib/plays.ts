/**
 * Play-by-play normalization. ESPN summary shapes differ per sport:
 *  - NFL: drives.current / drives.previous[].plays (full plays)
 *  - NBA/NHL: details[] scoring/event entries (when the feed carries them)
 * Anything absent yields an empty list — the UI hides the Plays tab rather
 * than faking content.
 */

import { periodLabelFor, type SportKey } from './models'

export interface NormalizedPlay {
  id: string
  period: number | null
  periodLabel: string | null
  clock: string | null
  teamAbbr: string | null
  text: string
  scoring: boolean
  /** Big moments (TD, INT, HR, goal, ejection...) rendered distinctly. */
  highlight: boolean
  /** Extra context, e.g. "2nd & 7" or "KC 27". */
  detail: string | null
}

const HIGHLIGHT_RE =
  /touchdown|pick-?six|intercept|fumble(?! recovery)|sack|eject|home run|grand slam|walk-?off|goal|hat trick|three-?point|no-?hitter|triple-?double|technical foul|flagrant/i

export function classifyHighlight(text: string, scoring: boolean): boolean {
  if (scoring) return true
  return HIGHLIGHT_RE.test(text)
}

function clockOf(play: any): string | null {
  const c = play?.clock?.displayValue ?? play?.clock
  if (typeof c === 'string' && c.trim() !== '') return c.trim()
  if (typeof c === 'number' && Number.isFinite(c) && c >= 0) {
    return `${Math.floor(c / 60)}:${String(Math.floor(c % 60)).padStart(2, '0')}`
  }
  if (typeof play?.time === 'string' && play.time.trim() !== '') return play.time.trim()
  return null
}

function periodOf(play: any): number | null {
  const p = play?.period?.number ?? play?.period
  return typeof p === 'number' && Number.isFinite(p) && p >= 1 ? p : null
}

function teamOf(play: any, fallback: string | null): string | null {
  const t =
    play?.team?.abbreviation ?? play?.team?.abbrev ?? play?.teamAbbreviation ?? fallback
  return typeof t === 'string' && t ? t.toUpperCase() : null
}

function nflDetail(play: any): string | null {
  const parts: string[] = []
  const down = play?.start?.down
  const dist = play?.start?.distance
  if (typeof down === 'number' && down >= 1 && down <= 4 && typeof dist === 'number') {
    parts.push(`${['1st', '2nd', '3rd', '4th'][down - 1]} & ${dist}`)
  }
  const spot = play?.start?.possessionText
  if (typeof spot === 'string' && spot.trim() !== '') parts.push(spot.trim())
  return parts.length > 0 ? parts.join(' · ') : null
}

function fromNflDrives(sport: SportKey, drives: any): NormalizedPlay[] {
  if (!drives || typeof drives !== 'object') return []
  const out: NormalizedPlay[] = []
  const push = (play: any, possessionAbbr: string | null, key: string) => {
    const text = typeof play?.text === 'string' ? play.text.trim() : ''
    if (!text) return
    const scoring = play?.scoringPlay === true
    const period = periodOf(play)
    out.push({
      id: String(play?.id ?? `${key}-${out.length}`),
      period,
      periodLabel: periodLabelFor(sport, period),
      clock: clockOf(play),
      teamAbbr: teamOf(play, possessionAbbr),
      text,
      scoring,
      highlight: classifyHighlight(text, scoring),
      detail: nflDetail(play),
    })
  }
  const prev = drives.previous
  if (Array.isArray(prev)) {
    prev.forEach((d: any, di: number) => {
      const poss = typeof d?.team?.abbreviation === 'string' ? d.team.abbreviation : null
      const plays = d?.plays
      if (Array.isArray(plays)) plays.forEach((p: any, pi: number) => push(p, poss, `prev-${di}-${pi}`))
    })
  }
  const cur = drives.current
  const curPoss = typeof cur?.team?.abbreviation === 'string' ? cur.team.abbreviation : null
  if (Array.isArray(cur?.plays)) cur.plays.forEach((p: any, pi: number) => push(p, curPoss, `cur-${pi}`))
  return out
}

function fromDetails(sport: SportKey, details: any[]): NormalizedPlay[] {
  const out: NormalizedPlay[] = []
  details.forEach((d: any, i: number) => {
    const text = typeof d?.text === 'string' && d.text.trim() !== ''
      ? d.text.trim()
      : typeof d?.type?.text === 'string'
        ? d.type.text.trim()
        : ''
    if (!text) return
    const scoring = d?.scoringPlay === true || d?.scoreValue === true
    const period = periodOf(d)
    out.push({
      id: String(d?.id ?? `detail-${i}`),
      period,
      periodLabel: periodLabelFor(sport, period),
      clock: clockOf(d),
      teamAbbr: teamOf(d, null),
      text,
      scoring,
      highlight: classifyHighlight(text, scoring),
      detail: null,
    })
  })
  return out
}

/**
 * Chronological plays for a game, oldest first. Empty when the provider
 * carries no usable play-by-play (pre-game, unsupported shape) — never throws.
 */
export function normalizePlays(sport: SportKey, summary: any): NormalizedPlay[] {
  if (!summary || typeof summary !== 'object') return []
  if (sport === 'NFL' && summary.drives) return fromNflDrives(sport, summary.drives)
  if (Array.isArray(summary.details) && summary.details.length > 0) {
    return fromDetails(sport, summary.details)
  }
  if (Array.isArray(summary.plays) && summary.plays.length > 0) {
    return fromDetails(sport, summary.plays)
  }
  if (sport === 'NFL') return fromNflDrives(sport, summary.drives)
  return []
}
