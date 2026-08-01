import HomeTabs from '@/components/HomeTabs'
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
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="text-center mb-12">
          <p className="fs-eyebrow justify-center mb-3">Multi-sport team dashboards</p>
          <h1 className="fs-title text-6xl sm:text-7xl mb-5">Fanspot</h1>
          <span className="fs-meta inline-block px-2.5 py-1 rounded-full border border-fs-line-strong">
            v{version}
          </span>
        </div>
        <HomeTabs leagues={leagues} />
      </div>
    </div>
  )
}
