'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { pickActiveEmbed, type StreamMatch, type StreamOption } from '@/lib/streams'

/**
 * Click-to-play stream player shared by the /watch hub and game hubs.
 * Resolves a match's sources to playable embeds (first source that yields
 * any), offers a feed picker, and loads the chosen embed on click. The
 * fullscreen button fills the viewport with the player via the Fullscreen
 * API (works regardless of the embed's own controls); the iframe also
 * keeps allowFullScreen so the source player's button keeps working.
 */
export function StreamPlayer({
  match,
  preselect,
  autoplay,
}: {
  match: StreamMatch
  preselect?: { source: string; id: string } | null
  /** Start the first resolved feed without a click (best-effort: browsers
      may hold it on the player's own play button when sound is on). */
  autoplay?: boolean
}) {
  const [options, setOptions] = useState<StreamOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeUrl, setActiveUrl] = useState<string | null>(null)
  const [isFs, setIsFs] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  // Read by `load` so a refresh can keep the feed that is already playing.
  const activeUrlRef = useRef<string | null>(null)
  useEffect(() => {
    activeUrlRef.current = activeUrl
  }, [activeUrl])

  // Identifies the source set + resolution hints. Hubs poll their listings
  // (the RedZone hub refetches every minute), handing us an equal-but-new
  // match object each time; we must only tear down the player when the sources
  // really change, not on every render — otherwise the stream drops each poll.
  const signature = [
    match.id,
    match.sources.map((s) => `${s.source}:${s.id}`).join(','),
    preselect ? `${preselect.source}:${preselect.id}` : '',
    autoplay ? 'auto' : '',
  ].join('|')

  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setOptions([])
    const previous = activeUrlRef.current
    try {
      const ordered = [...match.sources]
      if (preselect) {
        const i = ordered.findIndex(
          (s) => s.source === preselect.source && s.id === preselect.id,
        )
        if (i > 0) {
          const [p] = ordered.splice(i, 1)
          ordered.unshift(p)
        }
      }
      const combined: StreamOption[] = []
      const seen = new Set<string>()
      // Try sources in order until one yields playable embeds (max 3).
      for (const src of ordered.slice(0, 3)) {
        const res = await fetch(
          `/api/streams/embed?source=${encodeURIComponent(src.source)}&id=${encodeURIComponent(src.id)}`,
          { signal: AbortSignal.timeout(25000) },
        )
        if (res.status === 404) continue
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`)
        for (const o of body.streams ?? []) {
          if (!seen.has(o.embedUrl)) {
            seen.add(o.embedUrl)
            combined.push(o)
          }
        }
        if (combined.length > 0) break
      }
      combined.sort((a, b) => Number(b.hd) - Number(a.hd) || (b.viewers ?? 0) - (a.viewers ?? 0))
      setOptions(combined)
      if (combined.length === 0) {
        setError('No streams listed for this match right now — try another match.')
        setActiveUrl(null)
      } else {
        setActiveUrl(pickActiveEmbed(previous, combined, !!autoplay))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load streams')
    } finally {
      setLoading(false)
    }
  }, [match, preselect, autoplay])

  // Re-resolve only when the signature changes, never on a bare re-render.
  const loadedSig = useRef<string | null>(null)
  useEffect(() => {
    if (loadedSig.current === signature) return
    loadedSig.current = signature
    void load()
  }, [signature, load])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await wrapRef.current?.requestFullscreen()
      }
    } catch {
      /* Fullscreen API unavailable (older browsers) — the iframe's own
         fullscreen button still works via allowFullScreen. */
    }
  }, [])

  const activeSource = options.find((o) => o.embedUrl === activeUrl)?.source ?? ''

  return (
    <div ref={wrapRef} className={isFs ? 'bg-black p-2 sm:p-4 overflow-auto' : undefined}>
      {loading && <div className="fs-skeleton h-24" aria-hidden="true" />}
      {error && (
        <div className="flex flex-wrap items-center gap-3 py-2">
          <p className="text-sm text-fs-muted flex-1 min-w-40">{error}</p>
          <button type="button" className="fs-btn" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {!loading && !error && options.length > 0 && !activeUrl && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a stream">
          {options.map((o) => (
            <button
              key={o.embedUrl}
              type="button"
              onClick={() => setActiveUrl(o.embedUrl)}
              className="fs-btn inline-flex items-center gap-2"
            >
              {o.hd && <span className="text-fs-turf font-bold">HD</span>}
              {o.language}
              {typeof o.viewers === 'number' && (
                <span className="opacity-60 tabular-nums">{o.viewers} watching</span>
              )}
            </button>
          ))}
        </div>
      )}
      {activeUrl && (
        <div>
          <div
            className="relative w-full overflow-hidden rounded-lg border border-fs-line-strong bg-black"
            style={isFs ? { height: 'calc(100vh - 120px)' } : { aspectRatio: '16 / 9' }}
          >
            <iframe
              key={activeUrl}
              src={activeUrl}
              title={`Stream: ${match.title}`}
              className="absolute inset-0 h-full w-full"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {activeSource && <span className="fs-meta">Source {activeSource}</span>}
            <span className="flex-1" />
            {options.length > 1 && (
              <button type="button" className="fs-meta hover:text-fs-text" onClick={() => setActiveUrl(null)}>
                Switch stream
              </button>
            )}
            <button
              type="button"
              className="fs-btn"
              onClick={() => void toggleFullscreen()}
              aria-pressed={isFs}
            >
              {isFs ? '⤢ Exit fullscreen' : '⛶ Fullscreen'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
