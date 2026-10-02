import { teams, sportPath, type Team } from '@/data/teams'
import { getEspnAbbr } from '@/lib/providers/espn'

/**
 * Team crest URL for a team record. A locally hosted `logo` wins (F1
 * constructors have no ESPN logo CDN); every other league uses the ESPN
 * 500px crest keyed by the ESPN abbreviation.
 */
export function teamLogoUrl(team: Team): string {
  if (team.logo) return team.logo
  const path = sportPath[team.sport]
  if (!path) return ''
  const abbr = getEspnAbbr(team.id, team.abbreviation)
  return `https://a.espncdn.com/i/teamlogos/${path}/500/${abbr.toLowerCase()}.png`
}

/**
 * Resolve a crest when only a sport plus an id or abbreviation is known
 * (search results, favorites). Falls back to the ESPN URL shape if the team
 * is not in the registry.
 */
export function teamLogoCrest(
  sport: string,
  teamId: string | null | undefined,
  abbr: string,
): string {
  const key = sport.toUpperCase()
  const team = teams.find((t) =>
    t.sport === key && (teamId ? t.id === teamId : t.abbreviation.toUpperCase() === abbr.toUpperCase()),
  )
  if (team) return teamLogoUrl(team)
  return `https://a.espncdn.com/i/teamlogos/${sport.toLowerCase()}/500/${abbr.toLowerCase()}.png`
}
