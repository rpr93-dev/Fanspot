'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

interface GraphMeta {
  html: { mtime: string; size: number } | null
  json: { mtime: string; size: number } | null
  nodes: number | null
  links: number | null
}

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export default function GraphPage() {
  const [meta, setMeta] = useState<GraphMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [frameKey, setFrameKey] = useState(0)
  const [auto, setAuto] = useState(true)
  const [tick, setTick] = useState(0) // re-render the "ago" label
  const knownMtime = useRef<string | null>(null)

  const refresh = useCallback(async (force = false) => {
    try {
      const res = await fetch('/api/graph-meta', { cache: 'no-store' })
      if (!res.ok) throw new Error(`meta returned ${res.status}`)
      const m: GraphMeta = await res.json()
      setMeta(m)
      setError(m.html ? null : 'graph.html not found — run `graphify .` in the repo')
      if (m.html && (force || (knownMtime.current && knownMtime.current !== m.html.mtime))) {
        setFrameKey((k) => k + 1) // regenerate -> reload the visualization
      }
      if (m.html) knownMtime.current = m.html.mtime
    } catch (e: any) {
      setError(e?.message ?? 'meta fetch failed')
    }
  }, [])

  useEffect(() => {
    refresh(true)
    if (!auto) return
    const id = setInterval(() => refresh(false), 15_000)
    return () => clearInterval(id)
  }, [auto, refresh])

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000)
    return () => clearInterval(id)
  }, [])

  void tick

  return (
    <div className="min-h-screen fs-page">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 flex flex-col gap-4" style={{ minHeight: '100dvh' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/" className="hover-lift fs-meta hover:text-fs-text">&larr; Home</Link>
          <h1 className="fs-title text-xl text-fs-text">Code Graph</h1>
          <span className="fs-meta">
            {meta?.nodes != null ? `${meta.nodes.toLocaleString()} nodes` : '…'}
            {meta?.links != null ? ` · ${meta.links.toLocaleString()} edges` : ''}
            {meta?.html ? ` · built ${ago(meta.html.mtime)}` : ''}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setAuto((v) => !v)}
              className="hover-bright text-xs font-semibold px-3 py-1.5 rounded-full text-fs-muted hover:text-fs-text"
              style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
              title="Reload the visualization when graphify regenerates it (commits, checkouts)"
            >
              {auto ? '● Live' : '○ Paused'}
            </button>
            <button
              onClick={() => refresh(true)}
              className="hover-bright text-xs font-semibold px-3 py-1.5 rounded-full text-fs-muted hover:text-fs-text"
              style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              ↻ Refresh
            </button>
            <a
              href="/api/graph-html"
              target="_blank"
              rel="noopener noreferrer"
              className="hover-bright text-xs font-semibold px-3 py-1.5 rounded-full text-fs-muted hover:text-fs-text"
              style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              ↗ Full page
            </a>
          </div>
        </div>

        {error ? (
          <div className="fs-panel p-6 text-sm text-fs-red">{error}</div>
        ) : (
          <div className="fs-panel overflow-hidden flex-1" style={{ minHeight: 'calc(100dvh - 160px)' }}>
            {meta?.html && (
              <iframe
                key={frameKey}
                src="/api/graph-html"
                title="Graphify code graph"
                className="w-full h-full block"
                style={{ height: 'calc(100dvh - 162px)', border: 0 }}
              />
            )}
          </div>
        )}
        <p className="fs-meta">Regenerates on git commit / checkout via hooks — this page picks it up automatically.</p>
      </div>
    </div>
  )
}
