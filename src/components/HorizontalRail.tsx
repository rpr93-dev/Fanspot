'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Shared horizontal rail used by every game/stream row in Fanspot. The inner
 * viewport owns horizontal overflow (hidden native scrollbar via `fs-scroll-x`)
 * and the track owns the flex layout, so the page itself never scrolls
 * sideways and no route renders a stray scrollbar track under its cards.
 *
 * Optional left/right arrows reserve a fixed column on desktop (md+) so
 * appearing/disappearing never shifts the cards, and they fade out when there
 * is nothing to scroll in that direction. Overflow state is measured with a
 * ResizeObserver — no manual width assignment during resize.
 */
export function HorizontalRail({
  children,
  ariaLabel,
  className = '',
  trackClassName = '',
  showArrows = true,
}: {
  children: ReactNode
  ariaLabel?: string
  className?: string
  trackClassName?: string
  showArrows?: boolean
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState({ any: false, left: false, right: false })

  const measure = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const any = max > 1
    const left = el.scrollLeft > 1
    const right = el.scrollLeft < max - 1
    setState((prev) =>
      prev.any === any && prev.left === left && prev.right === right ? prev : { any, left, right },
    )
  }, [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (trackRef.current) ro.observe(trackRef.current)
    return () => ro.disconnect()
  }, [measure])

  const nudge = useCallback((dir: -1 | 1) => {
    const el = viewportRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.85, 260), behavior: 'smooth' })
  }, [])

  return (
    <div className={`fs-rail ${className}`}>
      {showArrows && (
        <button
          type="button"
          className="fs-rail-nav"
          data-hidden={!state.left}
          disabled={!state.left}
          aria-hidden={!state.left}
          tabIndex={state.left ? 0 : -1}
          aria-label="Scroll left"
          onClick={() => nudge(-1)}
        >
          <span aria-hidden="true">‹</span>
        </button>
      )}
      <div
        ref={viewportRef}
        className="fs-rail-viewport fs-scroll-x"
        role="list"
        aria-label={ariaLabel}
        onScroll={measure}
      >
        <div ref={trackRef} className={`fs-rail-track ${trackClassName}`}>
          {children}
        </div>
      </div>
      {showArrows && (
        <button
          type="button"
          className="fs-rail-nav"
          data-hidden={!state.right}
          disabled={!state.right}
          aria-hidden={!state.right}
          tabIndex={state.right ? 0 : -1}
          aria-label="Scroll right"
          onClick={() => nudge(1)}
        >
          <span aria-hidden="true">›</span>
        </button>
      )}
    </div>
  )
}
