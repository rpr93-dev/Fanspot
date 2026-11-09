'use client'

import type { ReactNode } from 'react'

/**
 * Workspace panel chrome for the Command layout: a titled panel whose body
 * scrolls on its own (`min-h-0` + `overflow-y-auto`) so several panels can sit
 * beside each other at viewport height without the page growing a scrollbar for
 * each one. Sizing/pane heights come from the caller's `className`.
 */
export function HubPanel({
  title,
  meta,
  action,
  children,
  className = '',
  bodyClassName = '',
}: {
  title: string
  meta?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section
      aria-label={title}
      className={`fs-panel flex min-h-0 flex-col overflow-hidden ${className}`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-fs-line bg-white/[0.02] px-3.5 py-2.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="fs-title text-base">{title}</h2>
          {meta ? <span className="fs-meta">{meta}</span> : null}
        </div>
        {action}
      </header>
      <div className={`min-h-0 flex-1 overflow-y-auto p-3.5 ${bodyClassName}`}>{children}</div>
    </section>
  )
}
