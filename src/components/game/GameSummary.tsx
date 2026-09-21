'use client'

import { useEffect, useState } from 'react'
import { PlayByPlay } from './PlayByPlay'
import {
  buildComparisonRows,
  resolveBarColors,
  StatComparisonRow,
  type BoxScoreTeam,
} from '@/components/box-score/GameStatsSection'
import { EmptyState, SkeletonRows } from '@/components/feedback'
import type { NormalizedPlay } from '@/lib/plays'
import type { FeedStory } from '@/components/NewsFeed'

/* ------------------------------------------------------------------ */
/* Pure selectors (unit-tested)                                        */
/* ------------------------------------------------------------------ */

export interface SummaryTeam {
  abbr: string
  name: string
}

/** Scoring plays + highlighted big moments, chronological (oldest first, as PlayByPlay expects), capped. */
export function selectBigPlays(plays: NormalizedPlay[] | null, limit = 6): NormalizedPlay[] {
  if (!plays || plays.length === 0) return []
  return plays.filter((p) => p.scoring || p.highlight).slice(-limit)
}

export interface ConciseStatRow {
  label: string
  awayValue: string | null
  homeValue: string | null
  awayNumericValue: number | null
  homeNumericValue: number | null
}

/** First N head-to-head rows that actually have values — the at-a-glance box. */
export function selectConciseStats(
  awayStats: { name: string; displayValue: string }[] | undefined,
  homeStats: { name: string; displayValue: string }[] | undefined,
  limit = 6,
): ConciseStatRow[] {
  return buildComparisonRows(awayStats, homeStats)
    .filter((r) => (r.awayValue ?? '') !== '' || (r.homeValue ?? '') !== '')
    .slice(0, limit)
}

function wordRe(haystack: string, word: string): boolean {
  const w = word.trim().toLowerCase()
  if (w.length < 2) return false
  return new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack)
}

/** Does this story mention the team (full name, nickname, or abbreviation)? */
export function storyMentionsTeam(
  story: Pick<FeedStory, 'title' | 'snippet'>,
  team: SummaryTeam,
): boolean {
  const hay = `${story.title ?? ''} ${story.snippet ?? ''}`.toLowerCase()
  if (!hay.trim()) return false
  const name = (team.name ?? '').toLowerCase().trim()
  if (name && hay.includes(name)) return true
  const nickname = name.split(/\s+/).pop() ?? ''
  if (nickname.length >= 3 && wordRe(hay, nickname)) return true
  if (wordRe(hay, team.abbr)) return true
  return false
}

/** League stories that mention either side, most significant first, capped. */
export function selectGameStories(
  stories: FeedStory[],
  teams: SummaryTeam[],
  limit = 3,
): FeedStory[] {
  return stories
    .filter((s) => teams.some((t) => storyMentionsTeam(s, t)))
    .slice(0, limit)
}

/* ------------------------------------------------------------------ */
/* GameNews — league stories mentioning either team                    */
/* ------------------------------------------------------------------ */

function GameNews({ league, teams }: { league: string; teams: SummaryTeam[] }) {
  const [stories, setStories] = useState<FeedStory[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/top-stories?leagues=${league.toLowerCase()}&limit=24&ranking=balanced`, {
      signal: AbortSignal.timeout(30000),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`News returned ${r.status}`)
        return r.json()
      })
      .then((json) => {
        if (!cancelled) setStories(Array.isArray(json?.stories) ? json.stories : [])
      })
      .catch(() => {
        if (!cancelled) setStories([])
      })
    return () => {
      cancelled = true
    }
  }, [league])

  if (!stories) return null
  const relevant = selectGameStories(stories, teams)
  if (relevant.length === 0) return null

  return (
    <section aria-label="Game news" className="fs-panel p-4 sm:p-5">
      <h2 className="fs-title text-lg mb-1">Game News</h2>
      <p className="fs-meta mb-3">Latest on these teams</p>
      <ul className="space-y-2.5">
        {relevant.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="block group">
              <p className="text-sm font-semibold leading-snug text-white/90 group-hover:text-fs-text">
                {s.title}
              </p>
              <p className="fs-meta mt-0.5">
                {s.source}
                {s.publishedAt
                  ? ` · ${new Date(s.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                  : ''}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* LiveGameSummary — big plays + concise stats + news for live/final   */
/* ------------------------------------------------------------------ */

export function LiveGameSummary({
  sport,
  away,
  home,
  boxScore,
  plays,
  playsChecked,
  playsError,
  onRetryPlays,
  lastPlayBlock,
  onViewTeamStats,
}: {
  sport: string
  away: SummaryTeam
  home: SummaryTeam
  boxScore: {
    teams?: BoxScoreTeam[]
    status?: { state?: string; completed?: boolean; detail?: string; shortDetail?: string } | null
  } | null
  plays: NormalizedPlay[] | null
  playsChecked: boolean
  playsError: string | null
  onRetryPlays: () => void
  lastPlayBlock: React.ReactNode
  onViewTeamStats: () => void
}) {
  const bsTeams: BoxScoreTeam[] = boxScore?.teams ?? []
  const awayBs = bsTeams.find((t) => t.homeAway === 'away') ?? bsTeams[0] ?? null
  const homeBs = bsTeams.find((t) => t.homeAway === 'home') ?? bsTeams[1] ?? null
  const concise =
    awayBs && homeBs ? selectConciseStats(awayBs.statistics, homeBs.statistics) : []
  const bigPlays = selectBigPlays(plays)
  const { awayColor, homeColor } =
    awayBs && homeBs
      ? resolveBarColors(sport, awayBs.abbreviation, homeBs.abbreviation)
      : { awayColor: '#8a9990', homeColor: '#5e6c63' }

  const showBigPlays = playsChecked && bigPlays.length > 0
  const showPlaysLoading = !playsChecked
  const showPlaysEmpty = playsChecked && !playsError && (plays ?? []).length === 0
  const showConciseStats = concise.length > 0

  return (
    <div className="space-y-4">
      {lastPlayBlock}

      <section aria-label="Big plays" className="fs-panel p-4 sm:p-5">
        <h2 className="fs-title text-lg mb-1">Big Plays</h2>
        <p className="fs-meta mb-3">Scores &amp; key moments</p>
        {showPlaysLoading ? (
          <SkeletonRows count={4} height="h-14" />
        ) : playsError && !plays ? (
          <EmptyState
            title={`Couldn't load plays: ${playsError}`}
            hint="Scores update separately — retry for the full feed"
          />
        ) : showBigPlays ? (
          <>
            <PlayByPlay plays={bigPlays} loading={false} error={null} />
            <button
              type="button"
              onClick={onRetryPlays}
              className="fs-meta hover:text-fs-text mt-3 transition-colors"
            >
              Refresh plays &rarr;
            </button>
          </>
        ) : showPlaysEmpty ? (
          <p className="text-sm text-fs-muted">No scoring plays yet — check back as the game unfolds.</p>
        ) : (
          <p className="text-sm text-fs-muted">No big moments yet — check back as the game unfolds.</p>
        )}
      </section>

      {showConciseStats && awayBs && homeBs ? (
        <section aria-label="Team stats at a glance" className="fs-panel p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <h2 className="fs-title text-lg">Team Stats</h2>
            <span className="fs-mono text-xs text-fs-muted tabular-nums">
              {awayBs.abbreviation} · {homeBs.abbreviation}
            </span>
          </div>
          <div>
            {concise.map((row) => (
              <StatComparisonRow
                key={row.label}
                row={row}
                awayColor={awayColor}
                homeColor={homeColor}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={onViewTeamStats}
            className="fs-meta hover:text-fs-text mt-3 transition-colors"
          >
            Full team stats &rarr;
          </button>
        </section>
      ) : (
        <p className="text-sm text-fs-muted px-1">Team stats fill in as the game progresses.</p>
      )}

      <GameNews league={sport} teams={[away, home]} />
    </div>
  )
}
