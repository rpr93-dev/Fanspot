import type { ReactNode } from 'react'

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
  tint,
  id,
  as: Heading = 'h2',
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
  tint?: string
  id?: string
  /** Heading level — pass 'h1' for top-level pages so the document has an h1. */
  as?: 'h1' | 'h2' | 'h3'
}) {
  return (
    <div id={id} className="mb-5 scroll-mt-20">
      <div className="flex items-end justify-between gap-4">
        <div className="flex gap-3 min-w-0">
          <span
            aria-hidden="true"
            className="w-1 shrink-0 self-stretch rounded-full"
            style={{ background: tint ?? 'var(--color-fs-turf)' }}
          />
          <div className="min-w-0">
            {eyebrow && (
              <p className="fs-eyebrow mb-1.5" style={tint ? ({ '--tint': tint } as React.CSSProperties) : undefined}>
                {eyebrow}
              </p>
            )}
            <Heading className="fs-title text-2xl sm:text-3xl truncate">{title}</Heading>
            {description && (
              <p className="text-sm text-fs-muted mt-1.5 max-w-3xl leading-relaxed">{description}</p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="fs-panel p-6 text-center">
      <p className="text-sm text-fs-muted">{title}</p>
      {hint && <p className="fs-meta mt-2">{hint}</p>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="fs-panel p-6 text-center">
      <p className="text-sm text-fs-red">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="fs-btn mt-4" type="button">
          Retry
        </button>
      )}
    </div>
  )
}

export function SkeletonRows({ count = 3, height = 'h-24' }: { count?: number; height?: string }) {
  return (
    <div className="space-y-2.5" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`fs-skeleton ${height}`} />
      ))}
    </div>
  )
}
