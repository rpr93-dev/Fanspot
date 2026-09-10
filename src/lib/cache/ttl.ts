export const TTL = {
  LIVE_SCORE: 15_000,
  ODDS: 30_000,
  NEWS: 300_000,
  STANDINGS: 1_800_000,
  ROSTER: 86_400_000,
  SCHEDULE: 21_600_000,
  /** Schedule refresh while a game is live or inside the gameday window. */
  SCHEDULE_FAST: 30_000,
  AI_RESPONSE: 300_000,
  BOX_SCORE: 300_000,
} as const

export const STALE = {
  LIVE_SCORE: 15_000,
  ODDS: 30_000,
  NEWS: 120_000,
  STANDINGS: 300_000,
  ROSTER: 86_400_000,
  SCHEDULE: 86_400_000,
  AI_RESPONSE: 600_000,
  BOX_SCORE: 600_000,
} as const

/**
 * Games within this window of now force fast schedule refreshes, even when
 * the cached copy still marks them `pre` (the feed only flips to `in` after
 * a fresh pull past kickoff). Covers NFL-length games plus pre-game warmup.
 */
export const SCHEDULE_GAME_WINDOW_MS = 6 * 60 * 60 * 1000

/**
 * Game-clock-aware schedule TTL. A flat 6h TTL drops live games from the
 * dashboard: a feed cached pre-kickoff still marks the game `pre`, and once
 * its date passes, computeResult filters it out of BOTH the future list
 * (date < now) and the live list (state != 'in') — the game vanishes until
 * the cache expires. Fast refresh while any event is in progress or inside
 * the gameday window; slow otherwise (protects the ESPN quota out of season).
 */
export function scheduleTtlFor(events: unknown): number {
  const now = Date.now()
  if (Array.isArray(events)) {
    for (const e of events) {
      const status = (e as any)?.competitions?.[0]?.status?.type
      if (status?.state === 'in') return TTL.SCHEDULE_FAST
      if (status?.completed === true || status?.state === 'post') continue
      const t = new Date((e as any)?.date ?? NaN).getTime()
      if (Number.isFinite(t) && Math.abs(now - t) < SCHEDULE_GAME_WINDOW_MS) {
        return TTL.SCHEDULE_FAST
      }
    }
  }
  return TTL.SCHEDULE
}
