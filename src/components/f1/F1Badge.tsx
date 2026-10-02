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
 * Constructor logo: the official 2026 white lockup served locally (F1 teams
 * have no ESPN logo CDN). Marks are transparent, trimmed, and vary in shape,
 * so they render height-matched with auto width — never squeezed into a
 * square. Every current mark is drawn white-on-transparent and sits bare on
 * the dark card with a soft drop shadow (the `logoOnLight` white-plate branch
 * stays for any legacy dark-on-transparent asset).
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
  if (record?.logo) {
    const dims =
      size === 'sm'
        ? 'h-6 max-w-[96px]'
        : size === 'lg'
          ? 'h-11 max-w-[180px]'
          : size === 'xl'
            ? 'h-14 max-w-[236px]'
            : 'h-8 max-w-[128px]'
    if (record.logoOnLight) {
      return (
        <span
          className={`shrink-0 inline-flex items-center justify-center bg-white rounded-lg px-2 py-1 ${dims}`}
          style={{ boxShadow: `0 0 14px ${p}55` }}
          title={record.name}
        >
          <img
            src={record.logo}
            alt={`${record.name} logo`}
            loading="lazy"
            draggable={false}
            className="h-full w-auto max-w-full object-contain select-none"
          />
        </span>
      )
    }
    return (
      <span className="shrink-0 inline-flex items-center" title={record.name}>
        <img
          src={record.logo}
          alt={`${record.name} logo`}
          loading="lazy"
          draggable={false}
          className={`${dims} w-auto object-contain select-none`}
          style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.65))' }}
        />
      </span>
    )
  }
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
