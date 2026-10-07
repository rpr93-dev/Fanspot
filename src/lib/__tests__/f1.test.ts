import { formatGap, formatLapTime, mergeLiveState, decimateTrack, trackBounds, sessionState, F1_TEAM_ABBR, parseLapTime, bridgeDrivers, bridgeSnapshot, tyreCompound } from '@/lib/f1'

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
    // Best lap is the quickest of the driver's laps.
    expect(cars[0].bestLapSecs).toBeCloseTo(107.2, 3)
    // Missing pieces stay null, never throw.
    expect(cars[1]).toMatchObject({ position: 2, gapToLeader: null, x: null, laps: 0 })
    expect(cars[1].bestLapSecs).toBeNull()
    expect(cars[1].tyre).toBeNull()
  })
  it('picks the latest stint compound per driver', () => {
    const cars = mergeLiveState({
      drivers,
      positions: [],
      intervals: [],
      locations: [],
      laps: [],
      stints: [
        { driver_number: 16, compound: 'SOFT', stint_number: 1, lap_start: 1 },
        { driver_number: 16, compound: 'HARD', stint_number: 2, lap_start: 20 },
        { driver_number: 63, compound: 'MEDIUM', stint_number: 1, lap_start: 1 },
      ],
    })
    expect(cars.find((c) => c.number === 16)).toMatchObject({ tyre: 'HARD', stint: 2 })
    expect(cars.find((c) => c.number === 63)).toMatchObject({ tyre: 'MEDIUM', stint: 1 })
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
  it('aliases Jolpica naming variants (Lawson team, Verstappen team)', () => {
    expect(F1_TEAM_ABBR['RB F1 Team']).toBe('RBU')
    expect(F1_TEAM_ABBR['Red Bull']).toBe('RBR')
    expect(F1_TEAM_ABBR['Cadillac F1 Team']).toBe('CAD')
  })
})

describe('parseLapTime', () => {
  it('parses m:ss.mmm, ss.mmm and h:mm:ss.mmm into seconds', () => {
    expect(parseLapTime('2:37.849')).toBeCloseTo(157.849, 3)
    expect(parseLapTime('37.849')).toBeCloseTo(37.849, 3)
    expect(parseLapTime('1:02:03.500')).toBeCloseTo(3723.5, 3)
  })
  it('returns null for empty/garbage', () => {
    expect(parseLapTime(null)).toBeNull()
    expect(parseLapTime('')).toBeNull()
    expect(parseLapTime('DNF')).toBeNull()
  })
})

describe('bridgeDrivers', () => {
  it('maps bridge rows into F1Driver with team abbreviation and colour', () => {
    const [d] = bridgeDrivers([{ driver_number: '4', name: 'Lando NORRIS', acronym: 'NOR', team: 'McLaren', team_colour: 'F47600' }])
    expect(d).toMatchObject({ number: 4, acronym: 'NOR', firstName: 'Lando', lastName: 'NORRIS', team: 'McLaren', teamAbbr: 'MCL', colour: '#F47600' })
  })
  it('accepts a #-prefixed colour and drops rows without a number', () => {
    const rows = bridgeDrivers([
      { driver_number: '3', name: 'Max VERSTAPPEN', team_colour: '#4781D7' },
      { name: 'Nobody' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].colour).toBe('#4781D7')
  })
})

describe('tyreCompound', () => {
  it('normalizes the five compounds and short codes', () => {
    expect(tyreCompound('SOFT')).toBe('SOFT')
    expect(tyreCompound('supersoft')).toBe('SOFT')
    expect(tyreCompound('M')).toBe('MEDIUM')
    expect(tyreCompound('medium')).toBe('MEDIUM')
    expect(tyreCompound('HARD')).toBe('HARD')
    expect(tyreCompound('INTERMEDIATE')).toBe('INTERMEDIATE')
    expect(tyreCompound('WET')).toBe('WET')
  })
  it('returns null for empty/absent values', () => {
    expect(tyreCompound(null)).toBeNull()
    expect(tyreCompound(undefined)).toBeNull()
    expect(tyreCompound('')).toBeNull()
  })
})

describe('bridgeSnapshot', () => {
  const status = {
    live: true,
    session: { Key: 11729, Name: 'Practice 3', Meeting: { Location: 'Kuala Lumpur' } },
    track_status: { Message: 'AllClear' },
  }
  const timing = {
    timestamp: '2026-10-03T05:00:00.000Z',
    drivers: [
      { driver_number: '12', position: '2', laps_completed: 3, last_lap_time: '1:36.924', best_lap_time: '1:36.924', tyre_compound: 'SOFT', tyre_new: 'true', stint_number: 3, in_pit: false, retired: false },
      { driver_number: '63', position: '1', laps_completed: 8, last_lap_time: '1:37.053', in_pit: true, retired: false },
    ],
  }
  it('builds a live snapshot ordered by position with no coordinates', () => {
    const snap = bridgeSnapshot({ status, timing, weather: { AirTemp: '32.6', TrackTemp: '53.3' }, raceControl: [] })!
    expect(snap.state).toBe('live')
    expect(snap.sessionName).toBe('Practice 3')
    expect(snap.location).toBe('Kuala Lumpur')
    expect(snap.trackStatus).toBe('AllClear')
    expect(snap.cars.map((c) => c.number)).toEqual([63, 12])
    expect(snap.cars.every((c) => c.x === null && c.y === null)).toBe(true)
    expect(snap.lap).toBe(8)
    expect(snap.cars[1]).toMatchObject({ number: 12, bestLapSecs: expect.any(Number), tyre: 'SOFT', tyreNew: true, stint: 3 })
    expect(snap.cars[1].bestLapSecs).toBeCloseTo(96.924, 3)
    expect(snap.airTemp).toBeCloseTo(32.6, 1)
    expect(snap.trackTemp).toBeCloseTo(53.3, 1)
  })
  it('returns null with no status and no timing', () => {
    expect(bridgeSnapshot({ status: null, timing: null, weather: null, raceControl: [] })).toBeNull()
  })
  it('marks a stale session final and folds race-control messages', () => {
    const snap = bridgeSnapshot({
      status: { ...status, live: false, stale: true },
      timing,
      weather: null,
      raceControl: [{ Utc: '2026-10-03T05:00:00Z', Category: 'Flag', Message: 'GREEN' }],
    })!
    expect(snap.state).toBe('final')
    expect(snap.messages[0].message).toBe('GREEN')
  })
})
