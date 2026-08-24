/**
 * Name matching between Yahoo's draft room and Fanspot's unified player DB.
 *
 * Yahoo renders names like "C.J. Stroud", "D'Andre Swift", "Patrick Mahomes II"
 * while the model data uses full names from ESPN/Sleeper, so matching is done on a
 * normalized key: lowercased, accents stripped, punctuation removed, common suffixes
 * dropped. D/ST nominations ("49ers Defense", "Chiefs D/ST") are matched by team
 * alias since the model prices D/ST rows by team abbreviation.
 */

/** Lowercase, strip accents/punctuation, collapse whitespace, drop jr/sr/II/III suffixes. */
export function normalizeName(raw: string): string {
  let s = raw.toLowerCase()
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  s = s.replace(/[^a-z0-9\s]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  const parts = s.split(' ')
  const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])
  while (parts.length > 1 && suffixes.has(parts[parts.length - 1] ?? '')) parts.pop()
  return parts.join(' ')
}

/** City and nickname aliases for all 32 NFL teams, keyed by normalized alias. */
const TEAM_ALIASES: Record<string, string> = {
  '49ers': 'SF', '49er': 'SF', 'san francisco': 'SF', 'san fran': 'SF', 'sf': 'SF',
  bears: 'CHI', chicago: 'CHI',
  bengals: 'CIN', cincinnati: 'CIN',
  bills: 'BUF', buffalo: 'BUF',
  broncos: 'DEN', denver: 'DEN',
  browns: 'CLE', cleveland: 'CLE',
  buccaneers: 'TB', 'tampa bay': 'TB', tampa: 'TB',
  cardinals: 'ARI', arizona: 'ARI',
  chargers: 'LAC', 'los angeles chargers': 'LAC',
  chiefs: 'KC', 'kansas city': 'KC', kansas: 'KC',
  colts: 'IND', indianapolis: 'IND',
  commanders: 'WAS', washington: 'WAS',
  cowboys: 'DAL', dallas: 'DAL',
  dolphins: 'MIA', miami: 'MIA',
  eagles: 'PHI', philadelphia: 'PHI',
  falcons: 'ATL', atlanta: 'ATL',
  giants: 'NYG', 'new york giants': 'NYG',
  jaguars: 'JAX', jacksonville: 'JAX',
  jets: 'NYJ', 'new york jets': 'NYJ',
  lions: 'DET', detroit: 'DET',
  packers: 'GB', 'green bay': 'GB',
  panthers: 'CAR', carolina: 'CAR',
  patriots: 'NE', 'new england': 'NE',
  raiders: 'LV', 'las vegas': 'LV',
  rams: 'LAR', 'los angeles rams': 'LAR',
  ravens: 'BAL', baltimore: 'BAL',
  saints: 'NO', 'new orleans': 'NO',
  seahawks: 'SEA', seattle: 'SEA',
  steelers: 'PIT', pittsburgh: 'PIT',
  texans: 'HOU', houston: 'HOU',
  titans: 'TEN', tennessee: 'TEN',
  vikings: 'MIN', minnesota: 'MIN',
}

/** Map a team mention ("49ers", "Kansas City", "Chiefs D/ST") to its abbreviation. */
export function abbrFromTeamName(raw: string): string | null {
  const key = normalizeName(raw)
  for (const [alias, abbr] of Object.entries(TEAM_ALIASES)) {
    if (key === alias || key.startsWith(alias + ' ') || key.endsWith(' ' + alias) || key.includes(alias + ' ')) {
      return abbr
    }
  }
  return null
}

export interface NameMatchRow {
  name: string
  pos: string
  team: string
}

/**
 * Best-effort match of a Yahoo-displayed name to a model row. D/ST nominations are
 * matched by team abbreviation; everyone else by normalized name, using the position
 * hint to break ties (e.g. "Josh Allen" QB vs LB).
 */
export function findPlayer(rows: NameMatchRow[], rawName: string, posHint?: string): NameMatchRow | null {
  const key = normalizeName(rawName)
  if (key.length === 0) return null

  // The slash in "D/ST" is stripped by normalization, so test both raw and key.
  const isDefense = /def|dst|d\/st/i.test(rawName) || /\bd st\b|dst|def/i.test(key)
  if (isDefense) {
    const abbr = abbrFromTeamName(rawName)
    const dst = rows.find((r) => r.pos === 'D/ST' && (abbr == null || r.team === abbr))
    if (dst) return dst
  }

  const exact = rows.filter((r) => normalizeName(r.name) === key)
  if (exact.length === 1) return exact[0] ?? null
  if (exact.length > 1) {
    if (posHint) {
      const hinted = exact.find((r) => r.pos === posHint)
      if (hinted) return hinted
    }
    return exact[0] ?? null
  }

  // Loose fallback: short normalized keys can collide (e.g. "A Jones"), so only
  // substring-match names that share the first word — that kills false positives
  // while catching Yahoo suffixes like "49ers Defense" on skill players.
  if (key.length >= 3) {
    const first = key.split(' ')[0] ?? ''
    for (const r of rows) {
      const rk = normalizeName(r.name)
      if (rk.includes(key) && rk.startsWith(first)) {
        return r
      }
    }
  }
  return null
}
