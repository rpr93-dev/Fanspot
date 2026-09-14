import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  GameStatsSection,
  MIN_BAR_COLOR_DISTANCE,
  colorDistance,
  resolveBarColors,
  teamAccent,
} from '../GameStatsSection'

const completedAway = {
  abbreviation: 'TB',
  displayName: 'Tampa Bay Buccaneers',
  logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/tb.png',
  homeAway: 'away',
  score: { displayValue: '23' },
  linescores: [3, 10, 7, 3],
  statistics: [
    { name: 'firstDowns', displayValue: '16' },
    { name: 'thirdDownEff', displayValue: '7-14' },
    { name: 'totalYards', displayValue: '260' },
    { name: 'possessionTime', displayValue: '24:48' },
    { name: 'completionAttempts', displayValue: '17/32' },
    { name: 'rushingYards', displayValue: '101' },
    { name: 'netPassingYards', displayValue: '159' },
    { name: 'totalPenaltiesYards', displayValue: '5-60' },
    { name: 'turnovers', displayValue: '0' },
  ],
}

const completedHome = {
  abbreviation: 'ATL',
  displayName: 'Atlanta Falcons',
  logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/atl.png',
  homeAway: 'home',
  score: { displayValue: '20' },
  linescores: [7, 3, 3, 7],
  statistics: [
    { name: 'firstDowns', displayValue: '23' },
    { name: 'thirdDownEff', displayValue: '6-15' },
    { name: 'totalYards', displayValue: '358' },
    { name: 'possessionTime', displayValue: '35:12' },
    { name: 'completionAttempts', displayValue: '27/42' },
    { name: 'rushingYards', displayValue: '69' },
    { name: 'netPassingYards', displayValue: '289' },
    { name: 'totalPenaltiesYards', displayValue: '8-55' },
    { name: 'turnovers', displayValue: '0' },
  ],
}

const completedStatus = {
  state: 'post',
  completed: true,
  description: 'Final',
  detail: 'Final',
  shortDetail: 'Final',
}

function widths(html: string): number[] {
  const out: number[] = []
  for (const m of html.matchAll(/width:\s*([\d.]+)%/g)) out.push(parseFloat(m[1]))
  return out
}

describe('GameStatsSection', () => {
  it('completed game: away left, home right, FINAL, finite bar widths', () => {
    const html = renderToStaticMarkup(
      <GameStatsSection away={completedAway} home={completedHome} status={completedStatus} sport="NFL" />,
    )
    // Away (TB) renders before home (ATL) in document order (left-to-right).
    expect(html.indexOf('>TB<') < html.indexOf('>ATL<')).toBe(true)
    expect(html).toContain('FINAL')
    expect(html).toContain('>23<')
    expect(html).toContain('>20<')
    // Stat values + labels present.
    expect(html).toContain('24:48')
    expect(html).toContain('35:12')
    expect(html).toContain('Total Yards')
    expect(html).toContain('7-14')
    // Every bar width is finite and within [0, 100].
    const ws = widths(html)
    expect(ws.length).toBeGreaterThan(0)
    for (const w of ws) {
      expect(Number.isFinite(w)).toBe(true)
      expect(w).toBeGreaterThanOrEqual(0)
      expect(w).toBeLessThanOrEqual(100)
    }
    // Heavily uneven value (260 vs 358 total yards): leader gets more bar.
    // Total Yards row: away share = 260/618 ≈ 42%.
    expect(html).toContain('width:42')
  })

  it('live game: shows LIVE + clock detail', () => {
    const html = renderToStaticMarkup(
      <GameStatsSection
        away={{ ...completedAway, score: { displayValue: '7' } }}
        home={{ ...completedHome, score: { displayValue: '3' } }}
        status={{ state: 'in', completed: false, detail: '11:47 - 2nd Quarter', shortDetail: '11:47 - 2nd' }}
        sport="NFL"
      />,
    )
    expect(html).toContain('LIVE')
    expect(html).toContain('11:47 - 2nd Quarter')
  })

  it('upcoming game: scheduled text, no zeroed stat rows', () => {
    const html = renderToStaticMarkup(
      <GameStatsSection
        away={{ abbreviation: 'SF', displayName: 'San Francisco 49ers', homeAway: 'away', statistics: [] }}
        home={{ abbreviation: 'LAR', displayName: 'Los Angeles Rams', homeAway: 'home', statistics: [] }}
        status={{ state: 'pre', completed: false, detail: 'Thu, September 10th at 8:35 PM EDT', shortDetail: '9/10 - 8:35 PM EDT' }}
        sport="NFL"
      />,
    )
    expect(html).toContain('8:35 PM EDT')
    expect(html).toContain('will appear here once the game begins')
    expect(widths(html)).toEqual([])
  })

  it('0 vs 0 renders an even, finite bar', () => {
    const html = renderToStaticMarkup(
      <GameStatsSection
        away={{ ...completedAway, statistics: [{ name: 'turnovers', displayValue: '0' }] }}
        home={{ ...completedHome, statistics: [{ name: 'turnovers', displayValue: '0' }] }}
        status={completedStatus}
        sport="NFL"
      />,
    )
    expect(html).toContain('width:50%')
  })

  it('same-color matchup (NE vs SEA) gets distinct bar colors via away secondary', () => {
    const { awayColor, homeColor } = resolveBarColors('NFL', 'NE', 'SEA')
    // Primaries clash (both navy) so the away side falls back to its secondary.
    expect(colorDistance(teamAccent('NFL', 'NE', 'primary'), teamAccent('NFL', 'SEA', 'primary')))
      .toBeLessThan(MIN_BAR_COLOR_DISTANCE)
    expect(awayColor).toBe(teamAccent('NFL', 'NE', 'secondary'))
    expect(homeColor).toBe(teamAccent('NFL', 'SEA', 'primary'))
    expect(colorDistance(awayColor, homeColor)).toBeGreaterThanOrEqual(MIN_BAR_COLOR_DISTANCE)
  })

  it('distinct primaries (KC vs BUF) stay primary-primary', () => {
    const { awayColor, homeColor } = resolveBarColors('NFL', 'KC', 'BUF')
    expect(awayColor).toBe(teamAccent('NFL', 'KC', 'primary'))
    expect(homeColor).toBe(teamAccent('NFL', 'BUF', 'primary'))
  })

  it('unknown teams still resolve to finite, usable colors', () => {
    const { awayColor, homeColor } = resolveBarColors('NFL', 'ZZZ', 'QQQ')
    for (const c of [awayColor, homeColor]) {
      expect(/^#[0-9a-f]{6}$/i.test(c)).toBe(true)
    }
  })

  it('last play renders under the score with meta context', () => {
    const html = renderToStaticMarkup(
      <GameStatsSection
        away={completedAway}
        home={completedHome}
        status={completedStatus}
        sport="NFL"
        lastPlay={{
          text: 'G.Holani up the middle to SEA 26 for 4 yards (C.Barmore).',
          period: 2,
          clock: '0:17',
          scoringPlay: false,
          down: 2,
          distance: 7,
          possessionAbbr: 'SEA',
        }}
      />,
    )
    expect(html).toContain('Last play')
    expect(html).toContain('G.Holani up the middle')
    expect(html).toContain('Q2 · 0:17 · 2nd &amp; 7 · SEA ball')
    // Score still renders above the last-play block.
    expect(html.indexOf('>23<') < html.indexOf('Last play')).toBe(true)
  })

  it('no last-play block when lastPlay is null', () => {    const html = renderToStaticMarkup(
      <GameStatsSection
        away={completedAway}
        home={completedHome}
        status={completedStatus}
        sport="NFL"
        lastPlay={null}
      />,
    )
    expect(html).not.toContain('Last play')
  })

  it('field indicator shows the spot under the last play', () => {
    const html = renderToStaticMarkup(
      <GameStatsSection
        away={completedAway}
        home={completedHome}
        status={completedStatus}
        sport="NFL"
        lastPlay={{
          text: 'D.Maye pass short left to R.Stevenson pushed ob at NE 44 for 17 yards (E.Jones).',
          period: 3,
          clock: '3:06',
          scoringPlay: false,
          down: 1,
          distance: 15,
          possessionAbbr: 'NE',
          yardLine: 73,
          spot: 'NE 27',
        }}
      />,
    )
    expect(html).toContain('at NE 27')
    expect(html).toContain('Ball at NE 27')
    // Ball sits 100-73 = 27% from the possessing team's own goal (left).
    expect(html).toContain('left:27%')
  })

  it('missing stats on one side render a dash, never blank/broken', () => {
    const html = renderToStaticMarkup(
      <GameStatsSection
        away={{ ...completedAway, statistics: [] }}
        home={completedHome}
        status={completedStatus}
        sport="NFL"
      />,
    )
    expect(html).toContain('–')
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('Infinity')
    expect(html).not.toContain('undefined')
  })
})
