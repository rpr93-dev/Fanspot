/**
 * "Last play" extraction for live/final games.
 *
 * ESPN football summaries carry full play-by-play under `drives.current.plays`
 * (ongoing drive) and `drives.previous[].plays` (completed drives). Other
 * sports don't expose this shape, so extraction returns null and the UI hides
 * the block — the LastPlay type itself stays sport-agnostic (text + period +
 * clock) so other sources can feed it later.
 */

export interface LastPlay {
  text: string
  period: number | null
  clock: string | null
  scoringPlay: boolean
  down: number | null
  distance: number | null
  possessionAbbr: string | null
  /** Yards to the end zone being attacked (0-100), when the feed provides it. */
  yardLine?: number | null
  /** Human spot from the feed, e.g. "NE 27". */
  spot?: string | null
}

function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Latest play: last play of the ongoing drive when it has any, otherwise the
 * last play of the most recent completed drive with plays. Null when the
 * summary carries no usable play-by-play — never throws on odd shapes.
 */
export function extractLastPlay(summary: any): LastPlay | null {
  try {
    const drives = summary?.drives
    if (!drives || typeof drives !== 'object') return null

    const current = drives.current
    let play: any = null
    let possessionAbbr: string | null =
      typeof current?.team?.abbreviation === 'string' ? current.team.abbreviation : null

    const curPlays = current?.plays
    if (Array.isArray(curPlays) && curPlays.length > 0) {
      play = curPlays[curPlays.length - 1]
    } else {
      const prev = drives.previous
      if (Array.isArray(prev)) {
        for (let i = prev.length - 1; i >= 0; i--) {
          const pls = prev[i]?.plays
          if (Array.isArray(pls) && pls.length > 0) {
            play = pls[pls.length - 1]
            if (typeof prev[i]?.team?.abbreviation === 'string') {
              possessionAbbr = prev[i].team.abbreviation
            }
            break
          }
        }
      }
    }

    const text = typeof play?.text === 'string' ? play.text.trim() : ''
    if (!text) return null

    const clock =
      typeof play?.clock?.displayValue === 'string' ? play.clock.displayValue : null

    // Field position: ESPN football carries yards-to-go + spot text on the
    // play's start (e.g. yardsToEndzone 73 / possessionText "NE 27").
    const startObj = play?.start != null && typeof play.start === 'object' ? play.start : null
    const rawYards = finiteNum(startObj?.yardsToEndzone) ?? finiteNum(startObj?.yardLine)
    const yardLine = rawYards != null ? Math.max(0, Math.min(100, rawYards)) : null
    const spot = typeof startObj?.possessionText === 'string' && startObj.possessionText.trim() !== ''
      ? startObj.possessionText.trim()
      : null

    return {
      text,
      period: finiteNum(play?.period?.number),
      clock,
      scoringPlay: play?.scoringPlay === true,
      down: finiteNum(play?.start?.down),
      distance: finiteNum(play?.start?.distance),
      possessionAbbr,
      yardLine,
      spot,
    }
  } catch {
    return null
  }
}

/** 2 / 7 -> "2nd & 7". Null for non-scrimmage plays (down 0, kickoffs, etc.). */
export function formatDownDistance(down: number | null, distance: number | null): string | null {
  if (down == null || distance == null || down < 1 || down > 4) return null
  const ord = ['1st', '2nd', '3rd', '4th'][down - 1]
  return `${ord} & ${distance}`
}

/** "Q2 · 0:17 · 2nd & 7 · SEA ball" — null when nothing contextual is known. */
export function formatLastPlayMeta(play: LastPlay, periodPrefix = 'Q'): string | null {
  const parts: string[] = []
  if (play.period != null) {
    parts.push(`${periodPrefix}${play.period}${play.clock ? ` · ${play.clock}` : ''}`)
  } else if (play.clock) {
    parts.push(play.clock)
  }
  const dd = formatDownDistance(play.down, play.distance)
  if (dd) parts.push(dd)
  if (play.possessionAbbr) parts.push(`${play.possessionAbbr} ball`)
  return parts.length > 0 ? parts.join(' · ') : null
}
