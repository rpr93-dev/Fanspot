import { teams } from '@/data/teams'

export const STORY_LEAGUES = ['nfl', 'nba', 'nhl', 'mlb'] as const
export type StoryLeague = (typeof STORY_LEAGUES)[number]

export interface TopStory {
  title: string
  url: string
  source: string
  league: StoryLeague
  publishedAt: string | null
  snippet: string
  significance: number
  /** Human-readable list of the signals that scored, shown in the UI. */
  drivers: string[]
}

/**
 * Event weights. This is deliberately not the ±10 keyword sentiment used by
 * news-momentum: that answers "is this good or bad for the player", this answers
 * "how much does this matter to the league", which is a different question.
 */
const EVENT_SIGNALS: { re: RegExp; weight: number; label: string }[] = [
  { re: /\btraded?\b|\btrade\b|blockbuster|acquires?|deals? (him|for)|swap/i, weight: 34, label: 'trade' },
  { re: /\bsigns?\b|\bsigning\b|agree[sd]? to (a )?(terms|deal)|\bextension\b|re-?signs?|megadeal/i, weight: 28, label: 'signing' },
  { re: /out for (the )?season|season[-\s]ending|torn (acl|achilles)|ruptur|placed on (the )?ir|injured reserve/i, weight: 30, label: 'major injury' },
  { re: /\bretires?\b|\bretirement\b|announces? retirement/i, weight: 26, label: 'retirement' },
  { re: /\bfired\b|\brelieved of\b|steps? down|\bhires?\b|named (head )?coach/i, weight: 22, label: 'coaching change' },
  { re: /suspend(ed|s|ion)|banned|placed on leave/i, weight: 20, label: 'suspension' },
  { re: /\breleased?\b|\bwaived?\b|\bcut\b|designated for assignment|\bdfa\b|buyout/i, weight: 16, label: 'roster move' },
  { re: /\bmvp\b|record[-\s]breaking|breaks? the .*record|no[-\s]hitter|triple[-\s]double|hat[-\s]trick/i, weight: 14, label: 'milestone' },
  { re: /\bdraft(ed|s)?\b|first overall|no\.? 1 pick/i, weight: 12, label: 'draft' },
]

/**
 * Speculation reads like news but has not happened. Aggregators publish a lot of it
 * with the same verbs as real transactions, so it needs its own pattern set.
 */
const SPECULATION_RE =
  /\brumou?rs?\b|\bcould\b|\bmight\b|\bshould\b|\bwould\b|reportedly interested|linked (to|with)|trade (candidate|machine|proposal|idea|pitch|target|deadline preview)|propos(al|ed|es)|hypothetical|mock draft|speculation|what if|predict(ing|ion|s)?\b|way-too-early|\branking(s)?\b|best fits?|blueprint|wish ?list|\bpitch(es)?\b|dream (trade|scenario)|packages? for/i

/** Reporting language that means a thing actually happened, and outranks a rumour hit. */
const CONFIRMED_RE =
  /\bofficially\b|\bhas (been )?(signed|traded|released|waived)\b|\bagreed to\b|\bfinaliz|\bcompleted\b|announced|\bplaced on\b|\bwill undergo\b|\bunderwent\b/i

/**
 * Outlets whose involvement raises confidence that a story is real and significant.
 * Weight is a prominence tier, not an endorsement of any particular article.
 */
const SOURCE_PROMINENCE: { re: RegExp; weight: number }[] = [
  { re: /espn|the athletic|associated press|\bap\b|reuters/i, weight: 12 },
  { re: /nfl\.com|nba\.com|nhl\.com|mlb\.com|sports illustrated|yahoo sports|cbs sports|fox sports|nbc sports/i, weight: 9 },
  { re: /bleacher report|the score|sportsnet|tsn|usa today|washington post|new york times/i, weight: 6 },
]

/**
 * Hand-maintained relevance lexicon, not a data feed. It only affects ordering — no
 * part of it is ever displayed as a fact — but it does go stale, so a name missing
 * here costs a story some rank rather than hiding it.
 */
const STAR_PLAYERS: Record<StoryLeague, string[]> = {
  nfl: [
    'Patrick Mahomes', 'Josh Allen', 'Lamar Jackson', 'Joe Burrow', 'Jalen Hurts',
    'Justin Jefferson', 'Ja\'Marr Chase', 'Tyreek Hill', 'CeeDee Lamb', 'Travis Kelce',
    'Saquon Barkley', 'Christian McCaffrey', 'Micah Parsons', 'Myles Garrett', 'T.J. Watt',
    'Aaron Rodgers', 'Caleb Williams', 'Jayden Daniels', 'Bijan Robinson', 'Malik Nabers',
  ],
  nba: [
    'LeBron James', 'Stephen Curry', 'Kevin Durant', 'Giannis Antetokounmpo', 'Nikola Jokic',
    'Luka Doncic', 'Joel Embiid', 'Jayson Tatum', 'Anthony Davis', 'Devin Booker',
    'Shai Gilgeous-Alexander', 'Victor Wembanyama', 'Anthony Edwards', 'Jimmy Butler', 'Kawhi Leonard',
    'Damian Lillard', 'Donovan Mitchell', 'Tyrese Haliburton', 'Paolo Banchero', 'Zion Williamson',
  ],
  nhl: [
    'Connor McDavid', 'Auston Matthews', 'Nathan MacKinnon', 'Sidney Crosby', 'Leon Draisaitl',
    'Cale Makar', 'David Pastrnak', 'Nikita Kucherov', 'Igor Shesterkin', 'Connor Bedard',
    'Jack Hughes', 'Quinn Hughes', 'Matthew Tkachuk', 'Mitch Marner', 'Alexander Ovechkin',
  ],
  mlb: [
    'Shohei Ohtani', 'Aaron Judge', 'Mookie Betts', 'Juan Soto', 'Ronald Acuna',
    'Mike Trout', 'Bryce Harper', 'Freddie Freeman', 'Gerrit Cole', 'Paul Skenes',
    'Bobby Witt', 'Corbin Carroll', 'Elly De La Cruz', 'Jose Ramirez', 'Yoshinobu Yamamoto',
  ],
}

const LEAGUE_TEAM_NAMES: Record<StoryLeague, string[]> = Object.fromEntries(
  STORY_LEAGUES.map((l) => [
    l,
    teams.filter((t) => t.sport === l.toUpperCase()).map((t) => t.name.split(' ').slice(-1)[0]),
  ]),
) as Record<StoryLeague, string[]>

/**
 * Recency is a tiebreaker, not a ranking axis — the brief is explicit that a big trade
 * from last week outranks a minor move from this morning. Caps at +10.
 */
function recencyBonus(publishedAt: string | null): number {
  if (!publishedAt) return 0
  const ageHours = (Date.now() - new Date(publishedAt).getTime()) / 3_600_000
  if (!Number.isFinite(ageHours) || ageHours < 0) return 0
  if (ageHours <= 12) return 10
  if (ageHours <= 48) return 7
  if (ageHours <= 24 * 7) return 4
  return 0
}

export interface RawStory {
  title: string
  url: string
  source: string
  snippet: string
  publishedAt: string | null
  league: StoryLeague
}

/** Deterministic significance score, 0-100. */
export function scoreStory(story: RawStory): { significance: number; drivers: string[] } {
  const text = `${story.title} ${story.snippet}`
  const drivers: string[] = []
  let score = 0

  let topEvent: { weight: number; label: string } | null = null
  for (const sig of EVENT_SIGNALS) {
    if (!sig.re.test(text)) continue
    // Only the strongest event counts. Stacking every keyword let a single article
    // that merely lists several transactions outrank the transaction itself.
    if (!topEvent || sig.weight > topEvent.weight) topEvent = sig
  }
  if (topEvent) {
    score += topEvent.weight
    drivers.push(topEvent.label)
  }

  const star = STAR_PLAYERS[story.league].find((n) => story.title.includes(n))
  if (star) {
    score += 26
    drivers.push(star)
  }

  const teamHit = LEAGUE_TEAM_NAMES[story.league].find((n) => text.includes(n))
  if (teamHit) score += 8

  const prominence = SOURCE_PROMINENCE.find((s) => s.re.test(story.source))
  if (prominence) {
    score += prominence.weight
    drivers.push(story.source)
  }

  score += recencyBonus(story.publishedAt)

  // Headline is what the reader judges the story by, so speculation is only weighed
  // there — a confirmed move that mentions a rumour in its summary is still a move.
  if (SPECULATION_RE.test(story.title) && !CONFIRMED_RE.test(story.title)) {
    score = Math.round(score * 0.35)
    drivers.push('speculative')
  }

  return { significance: Math.max(0, Math.min(100, score)), drivers }
}

/** Collapses syndicated duplicates of the same story. */
export function dedupeKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8)
    .join(' ')
}

export function rankStories(raw: RawStory[], limit: number): TopStory[] {
  const seen = new Set<string>()
  const scored: TopStory[] = []

  for (const s of raw) {
    if (!s.title) continue
    const key = dedupeKey(s.title)
    if (seen.has(key)) continue
    seen.add(key)
    const { significance, drivers } = scoreStory(s)
    scored.push({ ...s, significance, drivers })
  }

  scored.sort(
    (a, b) =>
      b.significance - a.significance ||
      new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime(),
  )
  return scored.slice(0, limit)
}
