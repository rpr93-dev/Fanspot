'use client'

import type { Team } from '@/data/teams'
import { teams } from '@/data/teams'

/** Lookup a constructor record by local abbreviation (MCL, FER, …). */
export function constructorByAbbr(abbr: string | null | undefined): Team | undefined {
  if (!abbr) return undefined
  const a = abbr.toUpperCase()
  return teams.find((t) => t.sport === 'F1' && t.abbreviation === a)
}

/**
 * Constructor logo badge: the constructor colourway renders as the logo
 * (F1 teams have no ESPN logo CDN). Diagonal livery stripe + abbr.
 */
export function F1Badge({
  abbr,
  primary,
  secondary,
  size = 'md',
}: {
  abbr?: string | null
  primary?: string
  secondary?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const record = constructorByAbbr(abbr ?? undefined)
  const p = primary ?? record?.colors.primary ?? '#E10600'
  const s = secondary ?? record?.colors.secondary ?? '#000000'
  const dims =
    size === 'sm'
      ? 'w-8 h-8 text-[10px] rounded-lg'
      : size === 'lg'
        ? 'w-14 h-14 text-sm rounded-xl'
        : size === 'xl'
          ? 'w-16 h-16 text-base rounded-2xl'
          : 'w-10 h-10 text-xs rounded-xl'
  return (
    <span
      aria-hidden="true"
      title={record?.name ?? abbr ?? ''}
      className={`${dims} shrink-0 grid place-items-center font-black tracking-wider text-white relative overflow-hidden border border-white/15`}
      style={{
        background: `linear-gradient(135deg, ${p} 0%, ${p} 55%, ${s} 55%, ${s} 100%)`,
        boxShadow: `0 0 12px ${p}55, inset 0 1px 0 rgba(255,255,255,0.25)`,
        textShadow: '0 1px 3px rgba(0,0,0,0.8)',
      }}
    >
      {abbr ?? 'F1'}
    </span>
  )
}

/** Small colour chip used inline in standings rows. */
export function F1ColorChip({ abbr, color }: { abbr?: string | null; color?: string }) {
  const record = constructorByAbbr(abbr ?? undefined)
  const c = color ?? record?.colors.primary ?? '#666'
  return (
    <span
      aria-hidden="true"
      className="w-1 self-stretch rounded-full shrink-0"
      style={{ backgroundColor: c, boxShadow: `0 0 6px ${c}88` }}
    />
  )
}
