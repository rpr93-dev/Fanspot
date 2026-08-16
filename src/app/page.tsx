import HomeTabs from '@/components/HomeTabs'
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
      className="league-card fs-panel group relative p-6 text-center transition-all duration-300 hover:-translate-y-1.5 hover:scale-[1.03] active:scale-[0.98]"
      style={{
        '--tint': color,
        '--tint-border': `${color}38`,
        '--glow-color': `${color}60`,
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        opacity: live ? 1 : 0.55,
      } as React.CSSProperties}
    >
      <span
        className="fs-meta inline-block mb-3 px-2.5 py-1 rounded-full border"
        style={{ borderColor: live ? '#8BC53F66' : 'var(--color-fs-line-strong)', color: live ? '#8BC53F' : 'var(--color-fs-muted-2)' }}
      >
        {live ? '● Live now' : 'Coming soon'}
      </span>
      <div className="w-14 h-14 mx-auto mb-4 flex items-center justify-center">
        <img
          src={`https://a.espncdn.com/i/teamlogos/leagues/500/${id}.png`}
          alt={name}
          className="w-full h-full object-contain"
          loading="lazy"
        />
      </div>
      <h3 className="fs-title text-lg text-white/90 mb-1">{name}</h3>
      <p className="fs-meta leading-relaxed">
        {live ? 'Steals · Mock draft · Auction' : 'Fantasy draft prep'}
      </p>
    </a>
  )
}

export default function HomePage() {
  return (
    <div className={`min-h-screen fs-page ${fontVariables}`}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="text-center mb-12">
          <p className="fs-eyebrow justify-center mb-3">Multi-sport team dashboards</p>
          <h1 className="fs-title text-6xl sm:text-7xl mb-5">Fanspot</h1>
          <span className="fs-meta inline-block px-2.5 py-1 rounded-full border border-fs-line-strong">
            v{version}
          </span>
        </div>

        <section className="mb-16">
          <div className="text-center mb-6">
            <p className="fs-eyebrow justify-center mb-3">Draft season is here</p>
            <h2 className="fs-title text-2xl sm:text-3xl mb-2">Fantasy Draft Prep</h2>
            <p className="fs-meta">Steals, mock drafts and auction values — straight to the fantasy section</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {leagues.map((league) => (
              <FantasyCard key={league.id} id={league.id} name={league.name} color={league.color} />
            ))}
          </div>
        </section>

        <HomeTabs leagues={leagues} />
      </div>
    </div>
  )
}
