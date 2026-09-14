import type { NormalizedStatus } from '@/lib/models'

/** Compact phase badge: LIVE (pulsing) / FINAL / PRE time / PPD / DELAYED. */
export function GameStatusBadge({ status, compactLabel }: { status: NormalizedStatus; compactLabel?: string }) {
  if (status.phase === 'live') {
    const label = status.periodLabel && status.clock
      ? `${status.periodLabel} · ${status.clock}`
      : status.shortDetail || 'LIVE'
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wider bg-fs-red/15 text-fs-red whitespace-nowrap shrink-0"
        aria-label={`Live: ${label}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-fs-red animate-pulse" aria-hidden="true" />
        {label}
      </span>
    )
  }
  if (status.phase === 'final') {
    return (
      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wider bg-white/10 text-fs-muted-2 whitespace-nowrap shrink-0">
        FINAL
      </span>
    )
  }
  if (status.phase === 'postponed' || status.phase === 'delayed') {
    return (
      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wider bg-fs-gold/15 text-fs-gold whitespace-nowrap shrink-0">
        {status.phase === 'postponed' ? 'PPD' : 'DELAYED'}
      </span>
    )
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wider bg-fs-gold/15 text-fs-gold whitespace-nowrap shrink-0">
      {compactLabel ?? status.shortDetail ?? 'PRE'}
    </span>
  )
}
