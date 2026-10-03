import Link from 'next/link'
import { SectionHeader } from '@/components/feedback'
import { hasFantasyDraftRoom, isFantasySportLive } from '@/lib/providers/fantasy-constants'
import { sportTheme } from '@/lib/sportTheme'

interface SportCard {
  slug: string
  name: string
  scoring: string
  ranking: string
}

const SPORTS: SportCard[] = [
  { slug: 'nfl', name: 'NFL', scoring: 'PPR · Half-PPR · Standard', ranking: 'Ranked within position (QB/RB/WR/TE/K/D/ST)' },
  { slug: 'nba', name: 'NBA', scoring: 'Points · 9-cat categories', ranking: 'Ranked league-wide, filtered by PG/SG/SF/PF/C eligibility' },
  { slug: 'mlb', name: 'MLB', scoring: '—', ranking: 'Projections not wired yet' },
  { slug: 'nhl', name: 'NHL', scoring: '—', ranking: 'Projections not wired yet' },
]

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

export default function FantasyPage() {
  return (
    <div className="min-h-screen fs-page">
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-8">
        <SectionHeader
          as="h1"
          eyebrow="Draft prep"
          title="Fantasy Steals"
          description="Find value picks across your drafts: where each player is projected to finish against where the market drafts them."
        />

        <div className="grid gap-6 lg:grid-cols-12">
          <section className="lg:col-span-7" aria-label="Sports">
            <div className="grid gap-4 sm:grid-cols-2">
              {SPORTS.map((s) => {
                const live = isFantasySportLive(s.slug)
                const theme = sportTheme(s.name)
                const room = hasFantasyDraftRoom(s.slug)
                return (
                  <div
                    key={s.slug}
                    className={`fs-panel relative p-5 ${live ? 'hover:border-white/30 transition-colors' : 'opacity-60'}`}
                    style={{ borderTop: `3px solid ${theme.accent}` }}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 className="text-2xl font-bold">
                        {live ? (
                          <Link href={`/fantasy/${s.slug}`} className="after:absolute after:inset-0">
                            {s.name}
                          </Link>
                        ) : (
                          s.name
                        )}
                      </h2>
                      <span className="fs-meta">{live ? 'Live' : 'Coming soon'}</span>
                    </div>
                    <p className="fs-meta mt-2">{s.ranking}</p>
                    <p className="fs-meta mt-1">Scoring: {s.scoring}</p>
                    {live && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Tool href={`/fantasy/${s.slug}`} label="Steals board" />
                        <Tool href={`/fantasy/${s.slug}?mode=auction`} label="Auction values" />
                        <Tool href={`/fantasy/${s.slug}?mode=mock`} label="Mock draft" soon={!room} />
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
