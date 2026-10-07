'use client'

import Link from 'next/link'
import type { F1CarState, F1Driver } from '@/lib/f1'
import { formatGap, formatLapTime } from '@/lib/f1'

/** Colour + letter for one tyre compound (F1 broadcast palette). */
function tyreStyle(compound: string | null): { bg: string; fg: string; letter: string } | null {
  switch (compound) {
    case 'SOFT':
      return { bg: '#E10600', fg: '#fff', letter: 'S' }
    case 'MEDIUM':
      return { bg: '#F5C518', fg: '#1a1a1a', letter: 'M' }
    case 'HARD':
      return { bg: '#E8E8E8', fg: '#1a1a1a', letter: 'H' }
    case 'INTERMEDIATE':
      return { bg: '#3EA34A', fg: '#fff', letter: 'I' }
    case 'WET':
      return { bg: '#2A6FD6', fg: '#fff', letter: 'W' }
    default:
      return null
  }
}

/** Small tyre badge; a ring marks a new (unscrubbed) set. */
function TyreBadge({ car }: { car: F1CarState }) {
  const style = tyreStyle(car.tyre)
  const title = car.tyre
    ? `${car.tyre}${car.tyreNew === true ? ' (new)' : car.tyreNew === false ? ' (used)' : ''}` +
      `${car.stint != null ? ` · stint ${car.stint}` : ''}` +
      `${car.tyreLaps != null ? ` · ${car.tyreLaps} laps` : ''}`
    : 'Tyre compound unavailable'
  if (!style) {
    return (
      <span className="w-6 shrink-0 flex justify-center" title={title}>
        <span aria-hidden="true" className="inline-block w-4 h-4 rounded-full border border-fs-line" />
        <span className="sr-only">Tyre unknown</span>
      </span>
    )
  }
  return (
    <span className="w-6 shrink-0 flex justify-center" title={title}>
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black leading-none"
        style={{
          backgroundColor: style.bg,
          color: style.fg,
          boxShadow: car.tyreNew === true ? `inset 0 0 0 1.5px rgba(255,255,255,0.85)` : undefined,
        }}
      >
        {style.letter}
      </span>
      <span className="sr-only">
        {car.tyre}
        {car.tyreNew === true ? ', new' : ''}
      </span>
    </span>
  )
}

/**
 * Position tower: every classified car with its current tyre, best lap, and
 * either gap to leader (when the feed publishes intervals — race/quali) or the
 * last lap (practice, where gaps aren't broadcast). Mirrors the broadcast
 * tower. All timing columns degrade to "–" when the feed hasn't sent them.
 */
export function F1Tower({
  cars,
  drivers,
  gameFinal,
}: {
  cars: F1CarState[]
  drivers: F1Driver[]
  gameFinal: boolean
}) {
  const byNumber = new Map(drivers.map((d) => [d.number, d]))
  const hasGaps = cars.some((c) => c.gapToLeader != null || c.intervalToAhead != null)
  const fastestBest = cars.reduce(
    (m, c) => (c.bestLapSecs != null && c.bestLapSecs < m ? c.bestLapSecs : m),
    Infinity,
  )
  return (
    <div>
      <div
        aria-hidden="true"
        className="flex items-center gap-2.5 px-3 py-2 border-b border-fs-line fs-meta !text-[10px] uppercase tracking-wide"
      >
        <span className="w-6 shrink-0">P</span>
        <span className="w-1 shrink-0" />
        <span className="min-w-0 flex-1">Driver</span>
        <span className="w-6 shrink-0 text-center">Tyre</span>
        <span className="w-16 shrink-0 text-right">Best</span>
        <span className="w-16 shrink-0 text-right">{hasGaps ? 'Gap' : 'Last'}</span>
      </div>
      <ol className="divide-y divide-fs-line" aria-label={gameFinal ? 'Final classification' : 'Live positions'}>
        {cars.map((car) => {
          const d = byNumber.get(car.number)
          const isFastest = car.bestLapSecs != null && car.bestLapSecs === fastestBest
          return (
            <li key={car.number} className="flex items-center gap-2.5 px-3 py-1.5 text-sm">
              <span className="fs-mono font-bold w-6 shrink-0 text-fs-muted tabular-nums">
                {car.position ?? '–'}
              </span>
              <span
                aria-hidden="true"
                className="w-1 self-stretch rounded-full shrink-0"
                style={{ backgroundColor: d?.colour ?? '#666' }}
              />
              <span className="min-w-0 flex-1">
                {d?.acronym ? (
                  <Link
                    href={`/f1/driver/${encodeURIComponent(d.acronym)}`}
                    className="font-semibold fs-mono text-[13px] hover:underline"
                    prefetch={false}
                  >
                    {d.acronym}
                  </Link>
                ) : (
                  <span className="font-semibold fs-mono text-[13px]">#{car.number}</span>
                )}{' '}
                <span className="text-fs-muted-2 text-xs truncate">
                  {d ? `${d.firstName[0]}. ${d.lastName}` : ''}
                </span>
                {car.dnf ? (
                  <span className="ml-1.5 text-[10px] font-bold text-fs-red">OUT</span>
                ) : car.inPit ? (
                  <span className="ml-1.5 text-[10px] font-bold text-fs-gold">PIT</span>
                ) : null}
              </span>
              <TyreBadge car={car} />
              <span
                className={`fs-mono text-xs tabular-nums w-16 shrink-0 text-right ${
                  isFastest ? 'font-bold' : 'text-fs-muted'
                }`}
                style={isFastest ? { color: '#b26bff' } : undefined}
                title={car.bestLapSecs != null ? `Best lap ${formatLapTime(car.bestLapSecs)}` : 'No best lap yet'}
              >
                {formatLapTime(car.bestLapSecs)}
              </span>
              <span
                className={`fs-mono text-xs tabular-nums w-16 shrink-0 text-right ${
                  car.position === 1 && hasGaps ? 'text-fs-text font-bold' : 'text-fs-muted'
                }`}
                title={hasGaps ? `Gap to leader (car ${car.number})` : `Last lap (car ${car.number})`}
              >
                {hasGaps
                  ? formatGap(car.position === 1 ? 0 : car.gapToLeader)
                  : formatLapTime(car.lastLapSecs)}
              </span>
            </li>
          )
        })}
        {cars.length === 0 ? (
          <li className="px-3 py-4 text-sm text-fs-muted-2">
            No timing data yet — cars haven&apos;t hit the track.
          </li>
        ) : null}
      </ol>
    </div>
  )
}
