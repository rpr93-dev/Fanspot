import HomeTabs from '@/components/HomeTabs'
import { fontVariables } from './fonts'

const leagues = [
  { id: 'nfl', name: 'NFL', fullName: 'National Football League', color: '#013369' },
  { id: 'nba', name: 'NBA', fullName: 'National Basketball Association', color: '#C9082A' },
  { id: 'nhl', name: 'NHL', fullName: 'National Hockey League', color: '#003E7E' },
  { id: 'mlb', name: 'MLB', fullName: 'Major League Baseball', color: '#002D72' },
]

export default function HomePage() {
  return (
    <div
      className={`min-h-screen ${fontVariables}`}
      style={{ background: 'linear-gradient(135deg, #0a0a0f, #1a1a2e)' }}
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="text-center mb-10">
          <h1 className="text-5xl font-light tracking-tight text-white mb-3">Fanspot</h1>
          <p className="text-base text-gray-500 tracking-wide">Multi-sport team dashboards</p>
        </div>
        <HomeTabs leagues={leagues} />
      </div>
    </div>
  )
}
