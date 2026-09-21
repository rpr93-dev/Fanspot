import Link from 'next/link'
import { NewsFeed } from '@/components/NewsFeed'
import { DaySnapshot } from '@/components/home/DaySnapshot'
import { ForYou } from '@/components/home/ForYou'
import { SectionHeader } from '@/components/feedback'
import { fontVariables } from './fonts'
import { version } from '../../package.json'

const leagues = [
  { id: 'nfl', name: 'NFL', fullName: 'National Football League', color: '#013369' },
  { id: 'nba', name: 'NBA', fullName: 'National Basketball Association', color: '#C9082A' },
  { id: 'nhl', name: 'NHL', fullName: 'National Hockey League', color: '#003E7E' },
  { id: 'mlb', name: 'MLB', fullName: 'Major League Baseball', color: '#002D72' },
]

export default function HomePage() {
  return (
    <div className={`min-h-screen fs-page ${fontVariables}`}>
      <div className="fs-shell px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-8">
          <div>
            <p className="fs-eyebrow mb-2">Your sports command center</p>
            <h1 className="fs-title text-4xl sm:text-5xl">Today in Sports</h1>
          </div>
          <span className="fs-meta shrink-0">Fanspot v{version}</span>
        </div>

        <div className="space-y-10">
          <ForYou />

          <DaySnapshot />

          <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
            <section aria-label="League hubs" className="lg:col-span-2">
              <SectionHeader eyebrow="Go deeper" title="Leagues" />
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                {leagues.map((league) => (
                  <Link
                    key={league.id}
                    href={`/${league.id}`}
                    className="league-card fs-panel group flex items-center gap-3 p-3 sm:p-4 text-left transition-all duration-300 hover:-translate-y-1"
                    style={{
                      '--tint': league.color,
                      '--tint-border': `${league.color}38`,
                      '--glow-color': `${league.color}60`,
                    } as React.CSSProperties}
                  >
                    <img
                      src={`https://a.espncdn.com/i/teamlogos/leagues/500/${league.id}.png`}
                      alt=""
                      className="w-10 h-10 sm:w-12 sm:h-12 object-contain shrink-0"
                      loading="lazy"
                    />
                    <span className="min-w-0">
                      <span className="fs-title text-base block">{league.name}</span>
                      <span className="fs-meta hidden sm:block truncate">{league.fullName}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>

            <section aria-label="Fantasy">
              <SectionHeader eyebrow="Fantasy" title="Draft Prep" />
              <div className="fs-panel p-4 sm:p-5 flex flex-col gap-3">
                <p className="fs-meta leading-relaxed">Steals · Mock draft · Auction — NFL live</p>
                <Link href="/fantasy/nfl" className="fs-btn shrink-0 self-start">
                  Open Fantasy →
                </Link>
              </div>
            </section>
          </div>

          <section aria-label="Top stories">
            <SectionHeader
              eyebrow="Around the leagues"
              title="Top Stories"
              action={
                <Link href="/news" className="fs-meta hover:text-fs-text">
                  All news →
                </Link>
              }
            />
            <NewsFeed ranking="balanced" limit={12} layout="grid" />
          </section>
        </div>
      </div>
    </div>
  )
}
