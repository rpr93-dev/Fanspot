import { formatGap, formatLapTime, mergeLiveState, decimateTrack, trackBounds, sessionState, F1_TEAM_ABBR } from '@/lib/f1'

describe('formatGap', () => {
  it('formats leader, seconds, lap-down and missing gaps', () => {
    expect(formatGap(0)).toBe('LEADER')
    expect(formatGap(1.2344)).toBe('+1.234')
    expect(formatGap('+1 LAP')).toBe('+1 LAP')
    expect(formatGap('+2 LAPS')).toBe('+2 LAPS')
    expect(formatGap(null)).toBe('—')
    expect(formatGap(undefined)).toBe('—')
  })
})

describe('formatLapTime', () => {
  it('formats seconds as m:ss.mmm', () => {
    expect(formatLapTime(107.2)).toBe('1:47.200')
    expect(formatLapTime(59.4)).toBe('0:59.400')
    expect(formatLapTime(null)).toBe('—')
    expect(formatLapTime(-1)).toBe('—')
  })
})

describe('mergeLiveState', () => {
  const drivers = [
    { driver_number: 63, name_acronym: 'RUS', team_name: 'Mercedes', team_colour: '00D7B6' },
    { driver_number: 16, name_acronym: 'LEC', team_name: 'Ferrari', team_colour: 'ED1131' },
  ]
  it('merges latest rows per driver and orders by position', () => {
    const cars = mergeLiveState({
      drivers,
      positions: [
        { driver_number: 16, position: 2, date: '2026-09-26T12:00:01+00:00' },
        { driver_number: 63, position: 1, date: '2026-09-26T12:00:01+00:00' },
      ],
      intervals: [{ driver_number: 63, gap_to_leader: 0, interval: 0 }],
      locations: [{ driver_number: 63, x: -5101, y: -3099, date: '2026-09-26T12:00:02+00:00' }],
      laps: [
        { driver_number: 63, lap_duration: 107.2 },
        { driver_number: 63, lap_duration: 108.1 },
      ],
      at: '2026-09-26T12:00:03+00:00',
    })
    expect(cars.map((c) => c.number)).toEqual([63, 16])
    expect(cars[0]).toMatchObject({ position: 1, gapToLeader: 0, x: -5101, y: -3099, laps: 2, lastLapSecs: 108.1 })
    // Missing pieces stay null, never throw.
    expect(cars[1]).toMatchObject({ position: 2, gapToLeader: null, x: null, laps: 0 })
  })
  it('marks pit and dnf cars', () => {
    const cars = mergeLiveState({
      drivers, positions: [], intervals: [], locations: [], laps: [],
      pitNow: new Set([16]), dnf: [63],
    })
    expect(cars.find((c) => c.number === 16)?.inPit).toBe(true)
    expect(cars.find((c) => c.number === 63)?.dnf).toBe(true)
  })
})

describe('decimateTrack / trackBounds', () => {
  it('keeps small traces intact and strides large ones', () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ x: i, y: i * 2 }))
    expect(decimateTrack(pts)).toHaveLength(100)
    expect(decimateTrack(pts, 10)).toHaveLength(10)
  })
  it('drops teleport glitches, keeping the longest clean run', () => {
    const lap = Array.from({ length: 50 }, (_, i) => ({ x: i * 10, y: 0 }))
    const pts = [...lap.slice(0, 10), { x: 99999, y: 99999 }, ...lap.slice(10)]
    const out = decimateTrack(pts)
    expect(out).toHaveLength(40)
    expect(out[0]).toEqual([100, 0])
  })
  it('bounds with padding', () => {
    const b = trackBounds([[0, 0], [100, 50]])
    expect(b).toEqual({ minX: -8, minY: -4, maxX: 108, maxY: 54 })
    expect(trackBounds([])).toBeNull()
  })
})

describe('sessionState', () => {
  const start = '2026-10-04T07:00:00+00:00'
  const end = '2026-10-04T09:00:00+00:00'
  it('is upcoming / live / final around the window', () => {
    expect(sessionState(start, end, Date.parse('2026-10-04T06:00:00+00:00'))).toBe('upcoming')
    expect(sessionState(start, end, Date.parse('2026-10-04T06:55:00+00:00'))).toBe('live')
    expect(sessionState(start, end, Date.parse('2026-10-04T08:00:00+00:00'))).toBe('live')
    expect(sessionState(start, end, Date.parse('2026-10-04T09:30:00+00:00'))).toBe('final')
    expect(sessionState(null, null)).toBe('upcoming')
  })
})

describe('F1_TEAM_ABBR', () => {
  it('covers the 2026 grid', () => {
    for (const t of ['McLaren', 'Ferrari', 'Red Bull Racing', 'Mercedes', 'Aston Martin', 'Alpine', 'Haas F1 Team', 'Racing Bulls', 'Williams', 'Audi', 'Cadillac']) {
      expect(F1_TEAM_ABBR[t]).toBeTruthy()
    }
  })
})
