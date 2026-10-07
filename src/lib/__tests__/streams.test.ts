import { describe, it, expect } from 'vitest'
import {
  matchGame,
  findGameStreams,
  filterCoveredMatches,
  findHubGame,
  isF1Session,
  f1WeekTokens,
  matchF1Weekend,
  f1SessionScore,
  isValidStreamSource,
  isValidStreamId,
  isValidWatchSport,
  STREAM_CATEGORY,
  isRedzoneListing,
  findRedzoneStream,
  isRedzoneWindow,
  easternTimeParts,
  pickActiveEmbed,
} from '../streams'

const VGK_ANA = {
  title: 'Vegas Golden Knights vs Anaheim Ducks',
  teams: { home: { name: 'Vegas Golden Knights' }, away: { name: 'Anaheim Ducks' } },
}

describe('matchGame', () => {
  it('matches when both full team names appear', () => {
    expect(matchGame(VGK_ANA, 'Vegas Golden Knights', 'Anaheim Ducks')).toBe(true)
  })

  it('rejects when only one team overlaps (derby/city names)', () => {
    expect(matchGame(VGK_ANA, 'Vegas Golden Knights', 'Los Angeles Kings')).toBe(false)
    expect(matchGame(VGK_ANA, 'Anaheim Ducks', 'Chicago Blackhawks')).toBe(false)
  })

  it('matches on title alone when teams are absent (F1-style sessions)', () => {
    const m = { title: 'Los Angeles Lakers vs Boston Celtics', teams: null }
    expect(matchGame(m, 'Los Angeles Lakers', 'Boston Celtics')).toBe(true)
    expect(matchGame(m, 'Los Angeles Lakers', 'Chicago Bulls')).toBe(false)
  })

  it('falls back to nicknames for short listings', () => {
    const m = { title: 'Lakers vs Celtics', teams: null }
    expect(matchGame(m, 'Los Angeles Lakers', 'Boston Celtics')).toBe(true)
  })

  it('ignores case, punctuation, and HTML entities', () => {
    const m = { title: 'ARCA West &amp; CARS Tour West at Las Vegas', teams: null }
    expect(matchGame(m, 'ARCA West', 'CARS Tour West')).toBe(true)
  })
})

describe('findGameStreams', () => {
  it('returns indexes of all double-team matches', () => {
    const matches = [
      VGK_ANA,
      { title: 'Edmonton Oilers vs Calgary Flames', teams: null },
      { title: 'Vegas Golden Knights vs Edmonton Oilers', teams: null },
    ]
    expect(findGameStreams(matches, 'Vegas Golden Knights', 'Edmonton Oilers')).toEqual([2])
    expect(findGameStreams(matches, 'Vegas Golden Knights', 'Anaheim Ducks')).toEqual([0])
    expect(findGameStreams(matches, 'Seattle Kraken', 'Anaheim Ducks')).toEqual([])
  })
})

describe('validators', () => {  it('accepts known Streamed sources, rejects paths and URLs', () => {
    expect(isValidStreamSource('delta')).toBe(true)
    expect(isValidStreamSource('admin')).toBe(true)
    expect(isValidStreamSource('../admin')).toBe(false)
    expect(isValidStreamSource('https://evil.com')).toBe(false)
    expect(isValidStreamSource('')).toBe(false)
  })

  it('accepts Streamed source ids, rejects traversal and URLs', () => {
    expect(isValidStreamId('live_nhl_golden-knights-ducks-live-streaming-653567184')).toBe(true)
    expect(isValidStreamId('1941')).toBe(true)
    expect(isValidStreamId('../../etc/passwd')).toBe(false)
    expect(isValidStreamId('https://evil.com/x')).toBe(false)
    expect(isValidStreamId('')).toBe(false)
  })

  it('maps every watch sport to a Streamed category', () => {
    expect(STREAM_CATEGORY).toEqual({
      nfl: 'american-football',
      nba: 'basketball',
      nhl: 'hockey',
      mlb: 'baseball',
      f1: 'motor-sports',
    })
    expect(isValidWatchSport('f1')).toBe(true)
    expect(isValidWatchSport('soccer')).toBe(false)
  })
})

describe('NFL RedZone', () => {
  it('detects the RedZone channel listing but not a single game', () => {
    expect(isRedzoneListing('Redzone - Week 4')).toBe(true)
    expect(isRedzoneListing('NFL RedZone')).toBe(true)
    expect(isRedzoneListing('Red Zone Week 4')).toBe(true)
    expect(isRedzoneListing('Houston Texans vs Dallas Cowboys')).toBe(false)
    // Matchup-shaped entries that merely mention RedZone are not the channel.
    expect(isRedzoneListing('NFL vs RedZone')).toBe(false)
  })

  it('picks the popular RedZone listing and returns null when absent', () => {
    const matches = [
      { title: 'Redzone - Week 3', popular: false, date: 1 },
      { title: 'Houston Texans vs Dallas Cowboys', popular: true, date: 2 },
      { title: 'Redzone - Week 4', popular: true, date: 3 },
    ]
    expect(findRedzoneStream(matches)?.title).toBe('Redzone - Week 4')
    expect(findRedzoneStream([{ title: 'No game' }])).toBeNull()
    expect(findRedzoneStream([{ title: 'NFL vs RedZone', sources: [1, 2, 3] }])).toBeNull()
  })

  it('prefers the listing with the most sources', () => {
    const matches = [
      { title: 'Redzone - Week 4', popular: true, date: 9, sources: [1] },
      { title: 'NFL RedZone', popular: true, date: 1, sources: [1, 2, 3] },
    ]
    expect(findRedzoneStream(matches)?.title).toBe('NFL RedZone')
  })

  it('opens the window only on Sunday within 12:00–19:30 ET', () => {
    expect(isRedzoneWindow(new Date('2026-10-04T16:00:00Z'))).toBe(true) // Sun 12:00 ET
    expect(isRedzoneWindow(new Date('2026-10-04T18:00:00Z'))).toBe(true) // Sun 14:00 ET
    expect(isRedzoneWindow(new Date('2026-10-04T13:00:00Z'))).toBe(false) // Sun 09:00 ET
    expect(isRedzoneWindow(new Date('2026-10-04T23:45:00Z'))).toBe(false) // Sun 19:45 ET
    expect(isRedzoneWindow(new Date('2026-10-05T18:00:00Z'))).toBe(false) // Mon 14:00 ET
  })

  it('derives the Eastern calendar date across the UTC rollover', () => {
    expect(easternTimeParts(new Date('2026-10-05T02:00:00Z')).dateKey).toBe('20261004') // Sun 22:00 ET
    expect(easternTimeParts(new Date('2026-10-04T18:00:00Z')).dateKey).toBe('20261004')
  })
})

describe('filterCoveredMatches', () => {
  const NHL = ['Vegas Golden Knights', 'Anaheim Ducks', 'Edmonton Oilers', 'Boston Bruins']
  const matches = [
    VGK_ANA,
    { title: 'Virginia Tech vs Pittsburgh', teams: null },
    { title: 'Vegas Golden Knights vs Edmonton Oilers', teams: null },
    { title: 'Boston Bruins vs Boston University', teams: null },
  ]
  it('keeps only listings with two covered teams', () => {
    expect(filterCoveredMatches(matches, NHL).map((m) => m.title)).toEqual([
      'Vegas Golden Knights vs Anaheim Ducks',
      'Vegas Golden Knights vs Edmonton Oilers',
    ])
  })
})

describe('findHubGame', () => {
  const games = [
    { id: '401891803', away: { name: 'New York Rangers' }, home: { name: 'Detroit Red Wings' } },
    { id: '401892432', away: { name: 'Washington Capitals' }, home: { name: 'Carolina Hurricanes' } },
  ]
  it('resolves exactly one hub by both team names', () => {
    expect(findHubGame(games, 'New York Rangers', 'Detroit Red Wings')).toBe('401891803')
  })
  it('returns null on zero or ambiguous matches', () => {
    expect(findHubGame(games, 'Seattle Kraken', 'Detroit Red Wings')).toBeNull()
    const dup = [...games, { id: '9', away: { name: 'New York Rangers' }, home: { name: 'Detroit Red Wings' } }]
    expect(findHubGame(dup, 'New York Rangers', 'Detroit Red Wings')).toBeNull()
  })
})

describe('isF1Session', () => {
  it.each([
    'Formula 1 2026 - Bahrain GP',
    'Bahrain in Malaysia Grand Prix Practice 3',
    'Sepang — Qualifying',
    'Bahrain Grand Prix - Qualifying',
    'Bahrain in Malaysia Grand Prix',
    'Formula 1 2026 - Singapore GP',
    'Japan Free Practice 2',
  ])('keeps F1: %s', (t) => expect(isF1Session(t)).toBe(true))

  it.each([
    'ARCA West & CARS Tour West at Las Vegas Bullring',
    'World Rally Championship 2026 - Rally Italia',
    'Nascar Cup Series 2026 - Hollywood Casino 400',
    'Rally TV',
    'Motegi — Qualifying',
    'Motegi — Sprint',
    'Moto2 2026 - Grand Prix of Japan',
    'Grand Prix of Japan Moto3',
    'Donington Park GP Race 1',
    'Motul Petit Le Mans',
    'Las Vegas Motor Speedway — Free Practice',
    'Rally Italia Sardegna — SS8',
  ])('drops non-F1: %s', (t) => expect(isF1Session(t)).toBe(false))
})

describe('f1WeekTokens', () => {
  it('keeps significant GP/circuit/locality words and drops stopwords', () => {
    expect(f1WeekTokens(['Bahrain Grand Prix', 'Kuala Lumpur', 'Sepang International Circuit']).sort()).toEqual(
      ['bahrain', 'kuala', 'lumpur', 'sepang'].sort(),
    )
  })
  it('ignores null/empty/numbers and de-dupes', () => {
    expect(f1WeekTokens([null, undefined, '', '2026', 'Bahrain', 'bahrain'])).toEqual(['bahrain'])
  })
})

describe('matchF1Weekend', () => {
  const tokens = f1WeekTokens(['Bahrain Grand Prix', 'Kuala Lumpur'])
  it('matches any listing that mentions a weekend token', () => {
    expect(matchF1Weekend('Bahrain Grand Prix - Qualifying', tokens)).toBe(true)
    expect(matchF1Weekend('Formula 1 2026 - Bahrain GP', tokens)).toBe(true)
  })
  it('rejects other races and matches everything when tokenless', () => {
    expect(matchF1Weekend('Singapore Grand Prix - Race', tokens)).toBe(false)
    expect(matchF1Weekend('Anything', [])).toBe(true)
  })
})

describe('f1SessionScore', () => {
  it('ranks the active session highest', () => {
    expect(f1SessionScore('Bahrain Grand Prix - Qualifying', 'Qualifying')).toBe(3)
    expect(f1SessionScore('Bahrain in Malaysia Grand Prix Practice 3', 'Practice 3')).toBe(3)
    expect(f1SessionScore('Bahrain Grand Prix Sprint Qualifying', 'Sprint Qualifying')).toBe(3)
  })
  it('treats a plain Grand Prix listing as the race and demotes other sessions', () => {
    expect(f1SessionScore('Bahrain Grand Prix', 'Race')).toBe(2)
    expect(f1SessionScore('Bahrain Grand Prix - Qualifying', 'Race')).toBe(0)
    expect(f1SessionScore('Bahrain Practice 1', 'Practice 3')).toBe(1)
    expect(f1SessionScore('Bahrain Practice', 'Practice 3')).toBe(1)
    expect(f1SessionScore('Singapore Grand Prix - Race', 'Qualifying')).toBe(0)
  })
})

describe('pickActiveEmbed', () => {
  const a = { embedUrl: 'https://embed.st/a' }
  const b = { embedUrl: 'https://embed.st/b' }

  it('keeps the playing feed when it survives a refresh', () => {
    expect(pickActiveEmbed('https://embed.st/b', [a, b], false)).toBe('https://embed.st/b')
  })

  it('falls back to the best feed when the current one disappears', () => {
    expect(pickActiveEmbed('https://embed.st/gone', [a, b], false)).toBe('https://embed.st/a')
  })

  it('starts the first feed only when autoplaying', () => {
    expect(pickActiveEmbed(null, [a, b], true)).toBe('https://embed.st/a')
    expect(pickActiveEmbed(null, [a, b], false)).toBeNull()
  })

  it('returns null when nothing is available', () => {
    expect(pickActiveEmbed('https://embed.st/b', [], false)).toBeNull()
    expect(pickActiveEmbed(null, [], true)).toBeNull()
  })
})
