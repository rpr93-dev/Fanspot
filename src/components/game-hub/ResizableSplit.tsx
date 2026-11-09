'use client'

import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { SPLIT_MAX, SPLIT_MIN, clampSplit } from '@/lib/gameHub'

/**
 * Two-pane split with one draggable divider (Command mode). A plain pointer
 * drag + keyboard arrows, deliberately not drag-and-drop.
 *
 * The size is driven by a CSS custom property (`.hub-split*` in globals.css) so
 * the same DOM renders as a single stacked column below `lg` — the children are
 * never unmounted or re-created when the layout or the ratio changes, which is
 * what keeps a playing stream absolutely stable across resizes.
 *
 * `orientation` adds a vertical (top/bottom) variant used by the Command rail:
 * `horizontal` splits width, `vertical` splits height and needs a bounded
 * container height to have anything to divide.
 */
export function ResizableSplit({
  ratio,
  onRatio,
  children,
  className = '',
  divider = true,
  collapsed = false,
  orientation = 'horizontal',
  label = 'Resize panels',
  min = SPLIT_MIN,
  max = SPLIT_MAX,
}: {
  ratio: number
  onRatio: (ratio: number) => void
  /** [firstPane, secondPane] — first is left (or top) of the divider. */
  children: [ReactNode, ReactNode]
  className?: string
  /** Show the drag handle. Watch mode hides it for a calmer layout. */
  divider?: boolean
  /** Hide the second pane (stays mounted) and let the first pane fill. */
  collapsed?: boolean
  orientation?: 'horizontal' | 'vertical'
  label?: string
  min?: number
  max?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const vertical = orientation === 'vertical'

  const setFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (vertical) {
        if (rect.height <= 0) return
        onRatio(clampSplit((clientY - rect.top) / rect.height, min, max))
      } else {
        if (rect.width <= 0) return
        onRatio(clampSplit((clientX - rect.left) / rect.width, min, max))
      }
    },
    [onRatio, vertical, min, max],
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragging.current) setFromPointer(e.clientX, e.clientY)
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
  }, [setFromPointer])

  const nudge = (dir: 1 | -1) => onRatio(clampSplit(ratio + dir * (max - min) / 12, min, max))
  const pct = Math.round(clampSplit(ratio, min, max) * 100)

  return (
    <div
      ref={ref}
      className={`hub-split ${vertical ? 'hub-split--vertical' : ''} ${divider ? '' : 'hub-split--no-divider'} ${collapsed ? 'hub-split--collapsed' : ''} ${className}`}
      style={{ '--hub-split': clampSplit(ratio, min, max) } as React.CSSProperties}
    >
      <div className="min-h-0 min-w-0">{children[0]}</div>
      {divider && !collapsed && (
        <div
          role="separator"
          aria-orientation={vertical ? 'horizontal' : 'vertical'}
          aria-label={label}
          aria-valuenow={pct}
          aria-valuemin={Math.round(min * 100)}
          aria-valuemax={Math.round(max * 100)}
          tabIndex={0}
          onPointerDown={(e) => {
            dragging.current = true
            e.currentTarget.setPointerCapture?.(e.pointerId)
            document.body.style.cursor = vertical ? 'row-resize' : 'col-resize'
            document.body.style.userSelect = 'none'
          }}
          onKeyDown={(e) => {
            const back = vertical ? 'ArrowUp' : 'ArrowLeft'
            const forward = vertical ? 'ArrowDown' : 'ArrowRight'
            if (e.key === back) {
              e.preventDefault()
              nudge(-1)
            } else if (e.key === forward) {
              e.preventDefault()
              nudge(1)
            } else if (e.key === 'Home') {
              e.preventDefault()
              onRatio(min)
            } else if (e.key === 'End') {
              e.preventDefault()
              onRatio(max)
            }
          }}
          className={`group relative hidden items-center justify-center select-none lg:flex ${
            vertical ? 'h-2.5 w-full cursor-row-resize' : 'cursor-col-resize'
          }`}
        >
          <span
            aria-hidden="true"
            className={
              vertical
                ? 'absolute inset-x-2 top-1/2 -translate-y-1/2 h-px rounded bg-fs-line-strong transition-colors group-hover:bg-fs-turf/60 group-focus-visible:bg-fs-turf/60'
                : 'absolute inset-y-2 left-1/2 -translate-x-1/2 w-px rounded bg-fs-line-strong transition-colors group-hover:bg-fs-turf/60 group-focus-visible:bg-fs-turf/60'
            }
          />
          <span
            aria-hidden="true"
            className={`relative z-10 rounded-full bg-fs-panel-2 border border-fs-line-strong opacity-0 transition-opacity group-hover:opacity-100 ${
              vertical ? 'h-1.5 w-8' : 'h-8 w-1.5'
            }`}
          />
        </div>
      )}
      <div className={collapsed ? 'hidden' : 'min-h-0 min-w-0'}>{children[1]}</div>
    </div>
  )
}
