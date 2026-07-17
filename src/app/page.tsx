import Link from 'next/link'

const leagues = [
  { id: 'nfl', name: 'NFL', fullName: 'National Football League', color: '#013369' },
  { id: 'nba', name: 'NBA', fullName: 'National Basketball Association', color: '#C9082A' },
  { id: 'nhl', name: 'NHL', fullName: 'National Hockey League', color: '#003E7E' },
  { id: 'mlb', name: 'MLB', fullName: 'Major League Baseball', color: '#002D72' },
]

export default function HomePage() {
  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0a0a0f, #1a1a2e)' }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-light tracking-tight text-white mb-3">Fanspot</h1>
          <p className="text-base text-gray-500 tracking-wide">Multi-sport team dashboards</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {leagues.map((league) => (
            <Link
              key={league.id}
              href={`/${league.id}`}
              className="group relative rounded-2xl p-8 text-center transition-all duration-300 hover:-translate-y-1"
              style={{ backgroundColor: `${league.color}15`, border: `1px solid ${league.color}25` }}
            >
              <div className="w-20 h-20 mx-auto mb-5 flex items-center justify-center">
                <img
                  src={`https://a.espncdn.com/i/teamlogos/leagues/500/${league.id}.png`}
                  alt={league.name}
                  className="w-full h-full object-contain"
                  loading="lazy"
                />
              </div>
              <h2 className="text-lg font-medium text-white/90 mb-1">{league.name}</h2>
              <p className="text-xs text-gray-500 leading-relaxed">{league.fullName}</p>
            </Link>
          ))}
        </div>
        <p className="text-center mt-16 text-xs text-gray-600">Select a league to browse teams and dashboards</p>
      </div>
    </div>
  )
}
