import Link from 'next/link'
import { SectionHeader } from '@/components/feedback'
import { hasFantasyDraftRoom, isFantasySportLive } from '@/lib/providers/fantasy-constants'
import { sportTheme } from '@/lib/sportTheme'
import { boardConfigFor } from './[sport]/board-config'

const SPORT_ORDER = ['nfl', 'nba', 'nhl', 'mlb'] as const

const SPORT_NAMES: Record<string, string> = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL', mlb: 'MLB' }

const SPORT_BLURBS: Record<string, string> = {
  nfl: 'Steals board, auction values, and mock drafts against live ADP.',
  nba: 'League-wide value board under points or 9-category scoring.',
  nhl: 'Projections are not wired yet — the board stays closed until the data is real.',
  mlb: 'Projections are not wired yet — the board stays closed until the data is real.',
}

function Tool({ href, label, soon }: { href?: string; label: string; soon?: boolean }) {
  if (soon || !href) {
    return (
      <span className="fs-chip opacity-60 cursor-not-allowed" aria-disabled="true" title="Coming soon">
        {label} · Soon
      </span>
    )
  }
  return (
    <Link href={href} className="fs-chip relative z-10">
      {label}
    </Link>
  )
}

function Check({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={on ? 'text-fs-text' : 'text-fs-muted-2'}>
      {on ? '✓' : '○'} {label}
    </span>
  )
}

export default function FantasyPage() {
  return (
    <div className="min-h-screen fs-page">
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-8">
        <SectionHeader
          as="h1"
          eyebrow="Draft prep"
          title="Fantasy"
          description="Pick a sport for the full draft room — steals, auction values, and mocks. NFL and NBA are live; the rest open as soon as their projections are real."
        />

        <div className="grid gap-6 lg:grid-cols-12">
          <section className="lg:col-span-7" aria-label="Sports">
            <div className="grid gap-4 sm:grid-cols-2">
              {SPORT_ORDER.map((slug) => {
                const live = isFantasySportLive(slug)
                const theme = sportTheme(SPORT_NAMES[slug])
                const room = hasFantasyDraftRoom(slug)
                const cfg = live ? boardConfigFor(slug) : null
                const scoring = cfg ? cfg.scoring.map((s) => s.label).join(' · ') : '—'
                const ranks = cfg
                  ? cfg.overall
                    ? `Ranked league-wide, filtered by ${cfg.positions.filter((p) => p !== 'ALL').join('/')}`
                    : `Ranked within position (${cfg.positions.filter((p) => p !== 'ALL').join('/')})`
                  : 'Projections not wired yet'
                return (
                  <div
                    key={slug}
                    className={`fs-panel relative p-5 ${live ? 'hover:border-white/30 transition-colors' : 'opacity-60'}`}
                    style={{ borderTop: `3px solid ${theme.accent}` }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-2xl font-bold">
                        {live ? (
                          <Link href={`/fantasy/${slug}`} className="after:absolute after:inset-0">
                            {SPORT_NAMES[slug]}
                          </Link>
                        ) : (
                          SPORT_NAMES[slug]
                        )}
                      </h2>
                      <span
                        className={`fs-meta inline-flex items-center gap-1.5 ${live ? '!text-fs-turf' : ''}`}
                      >
                        <span
                          aria-hidden="true"
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: live ? 'var(--color-fs-turf)' : 'var(--color-fs-muted-2)' }}
                        />
                        {live ? 'Live' : 'Coming soon'}
                      </span>
                    </div>
                    <p className="text-sm text-fs-muted mt-2 leading-relaxed">{SPORT_BLURBS[slug]}</p>
                    <dl className="fs-meta mt-3 space-y-1.5">
                      <div className="flex gap-2">
                        <dt className="shrink-0 w-14">Scoring</dt>
                        <dd className="min-w-0 normal-case tracking-normal">{scoring}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="shrink-0 w-14">Ranks</dt>
                        <dd className="min-w-0 normal-case tracking-normal">{ranks}</dd>
                      </div>
                      {live && (
                        <div className="flex gap-2">
                          <dt className="shrink-0 w-14">Tools</dt>
                          <dd className="min-w-0 normal-case tracking-normal space-x-2">
                            <Check on label="Steals" />
                            <Check on label="Auction" />
                            <Check on={room} label={room ? 'Mock' : 'Mock soon'} />
                          </dd>
                        </div>
                      )}
                    </dl>
                    {live && (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Tool href={`/fantasy/${slug}`} label="Open full board →" />
                        <Tool href={`/fantasy/${slug}?mode=auction`} label="Auction" />
                        <Tool href={`/fantasy/${slug}?mode=mock`} label="Mock draft" soon={!room} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          <aside className="lg:col-span-5 space-y-4">
            <div className="fs-panel p-5">
              <h2 className="text-lg font-semibold mb-2">How a steal is scored</h2>
              <ul className="fs-meta space-y-2 list-disc pl-4">
                <li>Each player gets a projected rank and an ADP rank in the same pool.</li>
                <li>The rank gap is converted into value with a curve fit to last season&apos;s real finishes, so moving up ten spots near the top is worth more than in the deep bench.</li>
                <li>The value gap is weighted by model confidence, so a shaky waiver outlier can&apos;t outrank a stable difference-maker.</li>
                <li>Long-term injuries and suspensions go to an Availability Watch list instead of the main board.</li>
              </ul>
            </div>
            <div className="fs-panel p-5">
              <h2 className="text-lg font-semibold mb-2">Auction values</h2>
              <p className="fs-meta">
                Value over replacement, priced to your league&apos;s budget, team count and roster size, with a $1 minimum per player.
                Each price is compared with ESPN&apos;s average winning bid, rescaled to your league&apos;s total money.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
