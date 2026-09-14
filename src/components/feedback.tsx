import type { ReactNode } from 'react'

export function SectionHeader({
  eyebrow,
  title,
  action,
  tint,
}: {
  eyebrow?: string
  title: string
  action?: ReactNode
  tint?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 mb-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="fs-eyebrow mb-1.5" style={tint ? ({ '--tint': tint } as React.CSSProperties) : undefined}>
            {eyebrow}
          </p>
        )}
        <h2 className="fs-title text-xl sm:text-2xl truncate">{title}</h2>
      </div>
      {action && <div className="shrink-0">{action}</div>}
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
