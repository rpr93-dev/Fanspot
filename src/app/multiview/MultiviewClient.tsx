'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MultiviewWorkspace } from '@/components/game-hub/MultiviewWorkspace'
import { useMultiviewSelection } from '@/hooks/useMultiviewSelection'
import { useGameHubPrefs } from '@/hooks/useGameHubPrefs'
import { parseMultiviewParam, serializeMultiviewSlots } from '@/lib/multiview'

/**
 * Standalone split-screen hub. This is a thin mount of the shared
 * `MultiviewWorkspace` (the same board the Game Hub's Multiview mode renders),
 * so there is exactly one split-screen implementation. It adds the two things
 * a dedicated page owns: the `?games=` URL contract and a copy-link action.
 */
export function MultiviewClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initial = useMemo(() => parseMultiviewParam(searchParams.get('games')), [searchParams])
  const mv = useMultiviewSelection(initial)
  const { prefs, patch } = useGameHubPrefs()
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Keep the shareable `?games=` URL in sync with the selection.
  const serialized = serializeMultiviewSlots(mv.slots)
  useEffect(() => {
    if (!mv.hydrated) return
    const current = searchParams.get('games') ?? ''
    if (current !== serialized) {
      router.replace(serialized ? `/multiview?games=${encodeURIComponent(serialized)}` : '/multiview', {
        scroll: false,
      })
    }
  }, [mv.hydrated, serialized, router, searchParams])

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — the URL is still shareable */
    }
  }, [])

  return (
    <div className="min-h-screen fs-page">
      <div className="fs-shell px-4 sm:px-6 py-6 sm:py-10">
        <MultiviewWorkspace
          standalone
          slots={mv.slots}
          onAdd={mv.add}
          onRemove={mv.remove}
          clear={mv.clear}
          spotlight={mv.spotlight}
          onSpotlight={mv.setSpotlight}
          paused={mv.paused}
          onTogglePause={mv.togglePause}
          autoplay={mv.autoplay}
          onAutoplay={mv.setAutoplay}
          layout={prefs.multiviewLayout}
          onLayout={(l) => patch({ multiviewLayout: l })}
          activeKey={activeKey}
          onActive={setActiveKey}
          extraActions={
            <button type="button" className="fs-btn" onClick={copyLink}>
              {copied ? '✓ Link copied' : '⧉ Copy link'}
            </button>
          }
        />
      </div>
    </div>
  )
}
