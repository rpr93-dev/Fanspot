import Link from 'next/link'
import BiggestStories from '@/components/BiggestStories'
import { fontVariables } from './fonts'
import { version } from '../../package.json'

const leagues = [
  { id: 'nfl', name: 'NFL', fullName: 'National Football League', color: '#013369' },
  { id: 'nba', name: 'NBA', fullName: 'National Basketball Association', color: '#C9082A' },
  { id: 'nhl', name: 'NHL', fullName: 'National Hockey League', color: '#003E7E' },
  { id: 'mlb', name: 'MLB', fullName: 'Major League Baseball', color: '#002D72' },
]

/** Fantasy is live for the NFL only; the other sports land on their coming-soon page. */
const fantasyLive = new Set(['nfl'])

function FantasyCard({ id, name, color }: { id: string; name: string; color: string }) {
  const live = fantasyLive.has(id)
  return (
    <a
      href={`/fantasy/${id}`}
      className="league-card fs-panel group flex items-center gap-4 p-4 text-left transition-all duration-300 hover:-translate-y-1.5 hover:scale-[1.02] active:scale-[0.98]"
      style={{
        '--tint': color,
        '--tint-border': `${color}38`,
        '--glow-color': `${color}60`,
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        opacity: live ? 1 : 0.55,
      } as React.CSSProperties}
    >
      <div className="w-12 h-12 shrink-0 flex items-center justify-center">
        <img
          src={`https://a.espncdn.com/i/teamlogos/leagues/500/${id}.png`}
          alt={name}
          className="w-full h-full object-contain"
          loading="lazy"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="fs-title text-base text-white/90">{name}</h3>
          <span
            className="fs-meta inline-block px-2 py-0.5 rounded-full border shrink-0"
            style={{ borderColor: live ? '#8BC53F66' : 'var(--color-fs-line-strong)', color: live ? '#8BC53F' : 'var(--color-fs-muted-2)' }}
          >
            {live ? '● Live' : 'Soon'}
          </span>
        </div>
        <p className="fs-meta leading-relaxed mt-1">
          {live ? 'Steals · Mock draft · Auction' : 'Fantasy draft prep'}
        </p>
      </div>
    </a>
  )
}

function LeagueRow({ id, name, fullName, color }: { id: string; name: string; fullName: string; color: string }) {
  return (
    <Link
      href={`/${id}`}
      className="league-card fs-panel group flex items-center gap-4 p-4 text-left transition-all duration-300 hover:-translate-y-1.5 hover:scale-[1.02] active:scale-[0.98]"
      style={{
        '--tint': color,
        '--tint-border': `${color}38`,
        '--glow-color': `${color}60`,
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      } as React.CSSProperties}
    >
      <div className="w-12 h-12 shrink-0 flex items-center justify-center">
        <img
          src={`https://a.espncdn.com/i/teamlogos/leagues/500/${id}.png`}
          alt={name}
          className="w-full h-full object-contain"
          loading="lazy"
        />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="fs-title text-base text-white/90">{name}</h2>
        <p className="fs-meta leading-relaxed mt-1 truncate">{fullName}</p>
      </div>
      <span className="fs-meta shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
    </Link>
  )
}

export default function HomePage() {
  return (
    <div className={`min-h-screen fs-page ${fontVariables}`}>
      <div className="fs-shell px-4 sm:px-6 py-8 sm:py-12">
        {/* Horizontal hero: title left, meta right on desktop */}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-8">
          <div className="text-left">
            <p className="fs-eyebrow mb-3">Multi-sport team dashboards</p>
            <h1 className="fs-title text-5xl sm:text-6xl">Fanspot</h1>
          </div>
          <span className="fs-meta inline-block self-start lg:self-auto px-2.5 py-1 rounded-full border border-fs-line-strong">
            v{version}
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-12 items-start">
          {/* Left pane: fantasy + leagues */}
          <div className="lg:col-span-7 xl:col-span-8 space-y-8 min-w-0">
            <section>
              <div className="flex items-baseline justify-between gap-4 mb-4">
                <h2 className="fs-title text-xl sm:text-2xl">Fantasy Draft Prep</h2>
                <p className="fs-meta hidden sm:block shrink-0">Draft season is here</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {leagues.map((league) => (
                  <FantasyCard key={league.id} id={league.id} name={league.name} color={league.color} />
                ))}
              </div>
            </section>

            <section>
              <div className="flex items-baseline justify-between gap-4 mb-4">
                <h2 className="fs-title text-xl sm:text-2xl">Browse Leagues</h2>
                <p className="fs-meta hidden sm:block shrink-0">Select a league for teams</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {leagues.map((league) => (
                  <LeagueRow key={league.id} id={league.id} name={league.name} fullName={league.fullName} color={league.color} />
                ))}
              </div>
            </section>
          </div>

          {/* Right rail: stories beside content on desktop, stacked below on mobile */}
          <aside className="lg:col-span-5 xl:col-span-4 min-w-0 lg:sticky lg:top-6">
            <div className="fs-panel-2 p-5">
              <div className="flex items-baseline justify-between gap-4 mb-4">
                <h2 className="fs-title text-xl">Biggest Stories</h2>
                <p className="fs-meta shrink-0">Ranked, not recency</p>
              </div>
              <BiggestStories />
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
