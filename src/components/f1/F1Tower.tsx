'use client'

import Link from 'next/link'
import type { F1CarState, F1Driver } from '@/lib/f1'
import { formatGap, formatLapTime } from '@/lib/f1'

/**
 * Position tower: every classified car with gap to leader, last lap and
 * status (PIT / OUT). Mirrors the broadcast tower; gaps come from the
 * latest live intervals.
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
  return (
    <ol className="divide-y divide-fs-line" aria-label={gameFinal ? 'Final classification' : 'Live positions'}>
      {cars.map((car) => {
        const d = byNumber.get(car.number)
        return (
          <li key={car.number} className="flex items-center gap-2.5 px-3 py-1.5 text-sm">
            <span className="fs-mono font-bold w-6 text-fs-muted tabular-nums">
              {car.position ?? '–'}
            </span>
            <span
              aria-hidden="true"
              className="w-1 self-stretch rounded-full shrink-0"
              style={{ backgroundColor: d?.colour ?? '#666' }}
            />
            <span className="min-w-0 flex-1">
              {d?.acronym ? (
                <Link href={`/f1/driver/${encodeURIComponent(d.acronym)}`} className="font-semibold fs-mono text-[13px] hover:underline" prefetch={false}>
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
            <span className="fs-mono text-xs text-fs-muted tabular-nums hidden sm:inline" title={car.lastLapSecs != null ? `Last lap ${formatLapTime(car.lastLapSecs)}` : 'No lap yet'}>
              {car.laps > 0 ? `L${car.laps}` : '–'}
            </span>
            <span
              className={`fs-mono text-xs tabular-nums w-20 text-right ${car.position === 1 ? 'text-fs-text font-bold' : 'text-fs-muted'}`}
              title={car.position === 1 ? 'Race leader' : `Gap to leader (car ${car.number})`}
            >
              {formatGap(car.position === 1 ? 0 : car.gapToLeader)}
            </span>
          </li>
        )
      })}
      {cars.length === 0 ? (
        <li className="px-3 py-4 text-sm text-fs-muted-2">No timing data yet — cars haven&apos;t hit the track.</li>
      ) : null}
    </ol>
  )
}
