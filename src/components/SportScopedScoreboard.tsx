'use client'

import { usePathname } from 'next/navigation'
import { GlobalScoreboard } from './GlobalScoreboard'
import { normalizeSportKey, type SportKey } from '@/lib/models'

/**
 * Maps a URL pathname to the league being browsed, if any. League hubs,
 * team pages, game pages, and fantasy league pages scope to that sport;
 * everything else (home, scores, news, search...) stays cross-league.
 */
export function sportForPathname(pathname: string | null): SportKey | null {
  const segs = (pathname ?? '/').split('/').filter(Boolean).map((s) => s.toLowerCase())
  const direct = segs[0] ? normalizeSportKey(segs[0]) : null
  if (direct) return direct
  if (segs[0] === 'fantasy' && segs[1]) return normalizeSportKey(segs[1])
  return null
}

/**
 * Whether the scoreboard strip renders on this route. Hidden on the
 * homepage (starts directly at "Today in Sports") and everywhere inside
 * the league sections — each hub carries its own scores content.
 */
export function shouldShowScoreboard(pathname: string | null): boolean {
  const segs = (pathname ?? '/').split('/').filter(Boolean).map((s) => s.toLowerCase())
  if (segs.length === 0) return false
  return normalizeSportKey(segs[0]) == null
}

/**
 * The persistent scoreboard strip, scoped to the league being browsed on
 * cross-league pages (scores, news, search, fantasy...). Remounts on league
 * change so stale games from the previous league never linger.
 */
export function SportScopedScoreboard() {
  const pathname = usePathname()
  if (!shouldShowScoreboard(pathname)) return null
  const sport = sportForPathname(pathname)
  return (
    <div className="fs-shell px-4 sm:px-6 pt-4">
      <GlobalScoreboard key={sport ?? 'all'} sports={sport ? [sport] : undefined} />
    </div>
  )
}
