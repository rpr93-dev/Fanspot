'use client'

import { useEffect, useRef } from 'react'
import type { F1CarState, F1Driver } from '@/lib/f1'
import { trackBounds } from '@/lib/f1'

/**
 * Live circuit map: the track outline (traced from real timing-loop
 * coordinates) with every classified car plotted by its latest x/y.
 * Canvas, DPR-aware, refits on resize. North is up.
 */
export function F1TrackCanvas({
  outline,
  cars,
  drivers,
  height = 420,
}: {
  outline: [number, number][] | null
  cars: F1CarState[]
  drivers: F1Driver[]
  height?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = wrap.clientWidth
      const h = height
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const bounds = outline?.length ? trackBounds(outline) : null
      if (!bounds) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)'
        ctx.font = '13px system-ui'
        ctx.textAlign = 'center'
        ctx.fillText('Track outline appears once cars are on circuit…', w / 2, h / 2)
        return
      }
      const sx = w / (bounds.maxX - bounds.minX)
      const sy = h / (bounds.maxY - bounds.minY)
      const s = Math.min(sx, sy)
      const ox = (w - (bounds.maxX - bounds.minX) * s) / 2
      const oy = (h - (bounds.maxY - bounds.minY) * s) / 2
      const px = (x: number) => ox + (x - bounds.minX) * s
      // OpenF1 y grows northward; canvas y grows downward.
      const py = (y: number) => oy + (bounds.maxY - y) * s

      // Circuit outline.
      ctx.beginPath()
      outline!.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(px(x), py(y))
        else ctx.lineTo(px(x), py(y))
      })
      ctx.closePath()
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'
      ctx.lineWidth = 5
      ctx.lineJoin = 'round'
      ctx.stroke()

      const byNumber = new Map(drivers.map((d) => [d.number, d]))
      for (const car of cars) {
        if (car.x == null || car.y == null) continue
        const d = byNumber.get(car.number)
        const colour = d?.colour ?? '#999999'
        const x = px(car.x)
        const y = py(car.y)
        const leader = car.position === 1
        // Glow for the leader, dim for retirements.
        ctx.globalAlpha = car.dnf ? 0.35 : 1
        if (leader) {
          ctx.beginPath()
          ctx.arc(x, y, 9, 0, Math.PI * 2)
          ctx.fillStyle = `${colour}44`
          ctx.fill()
        }
        ctx.beginPath()
        ctx.arc(x, y, 5, 0, Math.PI * 2)
        ctx.fillStyle = colour
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'
        ctx.stroke()
        ctx.globalAlpha = 1
        // Acronym tag.
        ctx.font = '600 9px ui-monospace, monospace'
        ctx.textAlign = 'left'
        const label = d?.acronym ?? String(car.number)
        const tw = ctx.measureText(label).width
        ctx.fillStyle = 'rgba(0,0,0,0.65)'
        const bx = x + 7
        const by = y - 6
        const pad = 2
        ctx.fillRect(bx - pad, by - 9, tw + pad * 2, 12)
        ctx.fillStyle = car.dnf ? 'rgba(255,255,255,0.5)' : '#fff'
        ctx.fillText(label, bx, by)
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [outline, cars, drivers, height])

  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={canvasRef} aria-label="Live car positions on the circuit map" />
    </div>
  )
}
