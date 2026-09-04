'use client'

import { useState, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'

// Loaded on demand: the react-markdown + remark-gfm tree (~224 KB raw) is only
// needed once analysis output renders, so keep it out of the team-route
// first-load bundle (F4). The wrapper module carries both imports behind this
// single dynamic boundary.
const Markdown = dynamic(() => import('@/components/Markdown'), { ssr: false })

const TEAM_AREAS = ['Team News', 'Injuries', 'Recent Form', 'Win Probability Next Game', 'Roster Moves', 'Rumors', 'Key Player Stats', 'Web Sources']
const NEXT_GAME_AREAS = ['Team Stats Comparison', 'Key Matchups', 'Injury Report', 'Recent Form (both teams)', 'Betting Line/Odds', 'Historical Head-to-Head', 'Web Sources']

const PAST_GAME_AREAS: Record<string, string[]> = {
  NFL: ['Passing Yards', 'Rushing Yards', 'Touchdowns', 'Turnovers', 'Sacks', 'Key Player Stats', 'Key Turning Points'],
  NBA: ['Points', 'Assists', 'Rebounds', 'Steals', 'Blocks', 'Key Player Stats', 'Key Turning Points'],
  NHL: ['Goals', 'Assists', 'Shots on Goal', 'Hits', 'Penalty Minutes', 'Key Player Stats', 'Key Turning Points'],
  MLB: ['Hits', 'Home Runs', 'RBI', 'Strikeouts', 'ERA', 'Batting Average', 'Key Player Stats', 'Key Turning Points'],
}

const STYLES = ['Normal', 'Stephen A. Smith', 'Nick Wright', 'Skip Bayless', 'Pat McAfee', 'Bill Simmons'] as const

/** The analyst must answer inside this window; the server's own attempts budget stays below it. */
const ANALYST_TIMEOUT_MS = 90_000

function getPastGameAreas(sport: string): string[] {
  return PAST_GAME_AREAS[sport.toUpperCase()] ?? PAST_GAME_AREAS.MLB
}

function SportIcon({ sport }: { sport: string }) {
  const s = sport.toUpperCase()
  const svgProps = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "white", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }

  switch (s) {
    case 'NFL':
      return (
        <svg {...svgProps}>
          <ellipse cx="12" cy="12" rx="6" ry="10" strokeWidth="2" />
          <line x1="12" y1="3" x2="12" y2="6" strokeWidth="1.2" />
          <line x1="12" y1="18" x2="12" y2="21" strokeWidth="1.2" />
          <line x1="9.5" y1="4.5" x2="14.5" y2="4.5" strokeWidth="0.8" opacity="0.6" />
          <line x1="9.5" y1="19.5" x2="14.5" y2="19.5" strokeWidth="0.8" opacity="0.6" />
        </svg>
      )
    case 'NBA':
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="9" strokeWidth="2" />
          <line x1="3.5" y1="12" x2="20.5" y2="12" strokeWidth="1.5" />
          <path d="M7.5 7.5Q12 10 16.5 7.5" strokeWidth="0.8" opacity="0.5" />
          <path d="M7.5 16.5Q12 14 16.5 16.5" strokeWidth="0.8" opacity="0.5" />
        </svg>
      )
    case 'NHL':
      return (
        <svg {...svgProps}>
          <ellipse cx="12" cy="12" rx="9" ry="6" strokeWidth="2" />
          <line x1="6" y1="10" x2="18" y2="10" strokeWidth="0.8" opacity="0.4" />
          <line x1="6" y1="14" x2="18" y2="14" strokeWidth="0.8" opacity="0.4" />
        </svg>
      )
    default:
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="9" strokeWidth="2" />
          <path d="M5.5 7.5Q12 11 5.5 16.5" strokeWidth="1.2" opacity="0.7" />
          <path d="M18.5 7.5Q12 11 18.5 16.5" strokeWidth="1.2" opacity="0.7" />
        </svg>
      )
  }
}

interface AiNalystProps {
  sport: string
  teamId: string
  teamAbbreviation: string
  teamColor: string
  pageType: 'team' | 'next-game' | 'past-game'
  eventId?: string
}

export default function AiNalyst({ sport, teamId, teamAbbreviation, teamColor, pageType, eventId }: AiNalystProps) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [output, setOutput] = useState<string | null>(null)
  // Failures render here — a DISTINCT state from the generated-content box, never into it.
  const [error, setError] = useState<string | null>(null)
  const [selectedStyle, setSelectedStyle] = useState('Normal')
  const [customQuestion, setCustomQuestion] = useState('')
  const outputRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const areas = pageType === 'past-game' ? getPastGameAreas(sport) : pageType === 'next-game' ? NEXT_GAME_AREAS : TEAM_AREAS

  useEffect(() => {
    if (open) {
      setSelected(new Set(areas))
      setOutput(null)
      setError(null)
      setCustomQuestion('')
      setSelectedStyle('Normal')
    }
  }, [open])

  const canGenerate = customQuestion.trim().length > 0 || selected.size > 0
  const allSelected = selected.size === areas.length

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(areas))
  }

  const toggleChip = (area: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(area)) next.delete(area)
      else next.add(area)
      return next
    })
  }

  const handleGenerate = async () => {
    if (!canGenerate) return
    setLoading(true)
    setOutput(null)
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    // Hard client ceiling: no more staring at the spinner for minutes with no escape.
    const timer = setTimeout(() => controller.abort('timeout'), ANALYST_TIMEOUT_MS)
    try {
      const res = await fetch('/api/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          sport,
          teamId,
          teamAbbreviation,
          pageType,
          focusAreas: Array.from(selected),
          eventId: eventId || undefined,
          style: selectedStyle,
          customQuestion: customQuestion.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        if (res.status === 503 && err.error === 'analyst-unavailable') {
          setError(err.message || 'The analyst is unavailable right now — please retry later.')
        } else {
          setError(err.message ?? err.error ?? `Request failed (${res.status})`)
        }
      } else {
        const data = await res.json()
        setOutput(data.content ?? 'No response generated')
      }
    } catch (err: any) {
      if (controller.signal.aborted) {
        // User-initiated cancel just returns to idle; a timeout explains itself.
        if (controller.signal.reason === 'timeout') {
          setError('The analyst did not respond in time. The model may be busy — please retry later.')
        }
      } else {
        setError(err?.message ?? 'Request failed')
      }
    } finally {
      clearTimeout(timer)
      abortRef.current = null
      setLoading(false)
    }
  }

  const handleCancel = () => {
    abortRef.current?.abort('cancel')
  }

  // Dismissing the modal abandons any in-flight generation.
  useEffect(() => {
    if (!open) abortRef.current?.abort('cancel')
  }, [open])

  useEffect(() => {
    if (output && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        className={`fixed top-4 right-4 sm:top-6 sm:right-6 z-50 gen-btn-glow shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center ${
          open
            ? 'gap-2.5 px-4 py-2.5 sm:px-5 sm:py-3 rounded-full'
            : 'w-11 h-11 sm:w-12 sm:h-12 rounded-full p-0'
        }`}
        style={{ backgroundColor: teamColor, '--glow': `${teamColor}88` } as any}
        title="The AI-nalyst"
        aria-label="The AI-nalyst"
      >
        <SportIcon sport={sport} />
        {open && <span className="text-sm font-bold tracking-wide text-white drop-shadow-sm">The AI-nalyst</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-6">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div
            className="relative w-full max-w-lg rounded-2xl shadow-2xl animate-fade-in-up overflow-hidden"
            style={{ backgroundColor: 'var(--color-fs-panel-2)', border: `1px solid ${teamColor}25` }}
          >
            <div className="flex items-center justify-between p-4 sm:p-5 border-b" style={{ borderColor: `${teamColor}18` }}>
              <h2 className="text-sm font-medium tracking-wider text-fs-text/85">
                {pageType === 'team' ? 'Team Analysis' : pageType === 'next-game' ? 'Game Preview' : 'Game Recap'}
              </h2>
              <button onClick={() => setOpen(false)} className="text-fs-muted hover:text-fs-text text-lg leading-none">&times;</button>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              <div>
                <p className="fs-meta mb-2">Style</p>
                <div className="flex flex-wrap gap-1.5">
                  {STYLES.map(style => {
                    const isActive = selectedStyle === style
                    return (
                      <button
                        key={style}
                        onClick={() => setSelectedStyle(style)}
                        className="text-xs px-2.5 py-1 rounded-full transition-all duration-150"
                        style={{
                          backgroundColor: isActive ? `${teamColor}30` : `${teamColor}08`,
                          border: `1px solid ${isActive ? teamColor : `${teamColor}20`}`,
                          color: isActive ? 'white' : 'rgba(255,255,255,0.55)',
                        }}
                      >
                        {style}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="fs-meta">Focus areas</p>
                  <button
                    onClick={toggleAll}
                    className="text-xs px-2 py-0.5 rounded-full transition-colors"
                    style={{
                      backgroundColor: `${teamColor}12`,
                      border: `1px solid ${teamColor}25`,
                      color: 'rgba(255,255,255,0.5)',
                    }}
                  >
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {areas.map(area => {
                    const isSelected = selected.has(area)
                    return (
                      <button
                        key={area}
                        onClick={() => toggleChip(area)}
                        className="text-xs px-3 py-1.5 rounded-full transition-all duration-150"
                        style={{
                          backgroundColor: isSelected ? `${teamColor}25` : `${teamColor}08`,
                          border: `1px solid ${isSelected ? teamColor : `${teamColor}20`}`,
                          color: isSelected ? 'white' : 'rgba(255,255,255,0.6)',
                        }}
                      >
                        {area}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <p className="fs-meta mb-2">Or ask your own question</p>
                <input
                  type="text"
                  value={customQuestion}
                  onChange={e => setCustomQuestion(e.target.value)}
                  placeholder="e.g. What's the biggest weakness of this team?"
                  className="fs-input"
                  style={{ '--tint': teamColor } as React.CSSProperties}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleGenerate}
                  disabled={!canGenerate || loading}
                  className={`flex-1 text-sm font-medium py-2.5 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed ${canGenerate && !loading ? 'gen-btn-glow' : ''}`}
                  style={{
                    backgroundColor: canGenerate && !loading ? teamColor : `${teamColor}15`,
                    color: canGenerate && !loading ? 'white' : 'rgba(255,255,255,0.3)',
                    '--glow': canGenerate && !loading ? `${teamColor}66` : 'transparent',
                    transition: 'all 0.25s ease',
                  } as any}
                >
                  {loading ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="loader-dot w-2 h-2 rounded-full" style={{ backgroundColor: teamColor }} />
                        <span className="loader-dot w-2 h-2 rounded-full" style={{ backgroundColor: teamColor }} />
                        <span className="loader-dot w-2 h-2 rounded-full" style={{ backgroundColor: teamColor }} />
                      </div>
                      <span className="text-xs opacity-60">Generating...</span>
                    </div>
                  ) : (
                    'Generate Analysis'
                  )}
                </button>
                {loading && (
                  <button
                    onClick={handleCancel}
                    className="text-sm font-medium py-2.5 px-4 rounded-xl text-fs-muted hover:text-fs-text transition-colors"
                    style={{
                      backgroundColor: 'transparent',
                      border: '1px solid rgba(255,255,255,0.18)',
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-xl p-3.5 text-sm leading-relaxed"
                  style={{ backgroundColor: 'rgba(220,38,38,0.10)', border: '1px solid rgba(248,113,113,0.35)', color: '#fca5a5' }}
                >
                  <span className="font-semibold">The AI-nalyst is unavailable.</span>{' '}
                  <span className="opacity-90">{error}</span>
                </div>
              )}

              {output && (
                <div
                  ref={outputRef}
                  className="rounded-xl p-4 text-sm leading-relaxed text-fs-text/85 max-h-80 overflow-y-auto prose prose-invert prose-sm"
                  style={{ backgroundColor: 'var(--color-fs-panel)', border: `1px solid ${teamColor}20` }}
                >
                  <Markdown>
                    {output}
                  </Markdown>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
