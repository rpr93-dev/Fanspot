'use client'

import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { SPLIT_MAX, SPLIT_MIN, clampSplit } from '@/lib/gameHub'

/**
 * Two-pane horizontal split with one draggable divider (Command mode). A plain
 * pointer drag + keyboard arrows, deliberately not drag-and-drop.
 *
 * The width is driven by a CSS custom property (`.hub-split` in globals.css) so
 * the same DOM renders as a single stacked column below `lg` — the children are
 * never unmounted or re-created when the layout or the ratio changes, which is
 * what keeps a playing stream absolutely stable across resizes.
 */
export function ResizableSplit({
  ratio,
  onRatio,
  children,
  className = '',
  divider = true,
  collapsed = false,
}: {
  ratio: number
  onRatio: (ratio: number) => void
  /** [leftPane, rightPane] */
  children: [ReactNode, ReactNode]
  className?: string
  /** Show the drag handle. Watch mode hides it for a calmer layout. */
  divider?: boolean
  /** Hide the right pane (stays mounted) and let the left pane fill. */
  collapsed?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0) return
      onRatio(clampSplit((clientX - rect.left) / rect.width))
    },
    [onRatio],
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragging.current) setFromClientX(e.clientX)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [setFromClientX])

  const pct = Math.round(clampSplit(ratio) * 100)

  return (
    <div
      ref={ref}
      className={`hub-split ${divider ? '' : 'hub-split--no-divider'} ${collapsed ? 'hub-split--collapsed' : ''} ${className}`}
      style={{ '--hub-split': clampSplit(ratio) } as React.CSSProperties}
    >
      <div className="min-w-0">{children[0]}</div>
      {divider && !collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          aria-valuenow={pct}
          aria-valuemin={Math.round(SPLIT_MIN * 100)}
          aria-valuemax={Math.round(SPLIT_MAX * 100)}
          tabIndex={0}
          onPointerDown={(e) => {
            dragging.current = true
            e.currentTarget.setPointerCapture?.(e.pointerId)
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              onRatio(clampSplit(ratio - 0.03))
            } else if (e.key === 'ArrowRight') {
              e.preventDefault()
              onRatio(clampSplit(ratio + 0.03))
            } else if (e.key === 'Home') {
              e.preventDefault()
              onRatio(SPLIT_MIN)
            } else if (e.key === 'End') {
              e.preventDefault()
              onRatio(SPLIT_MAX)
            }
          }}
          className="group relative hidden lg:flex items-center justify-center cursor-col-resize select-none"
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-2 left-1/2 -translate-x-1/2 w-px rounded bg-fs-line-strong transition-colors group-hover:bg-fs-turf/60 group-focus-visible:bg-fs-turf/60"
          />
          <span
            aria-hidden="true"
            className="relative z-10 h-8 w-1.5 rounded-full bg-fs-panel-2 border border-fs-line-strong opacity-0 transition-opacity group-hover:opacity-100"
          />
        </div>
      )}
      <div className={collapsed ? 'hidden' : 'min-w-0'}>{children[1]}</div>
    </div>
  )
}
