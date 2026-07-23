'use client'

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const TEAM_AREAS = ['Team News', 'Injuries', 'Recent Form', 'Win Probability Next Game', 'Roster Moves', 'Rumors', 'Key Player Stats', 'Web Sources']
const NEXT_GAME_AREAS = ['Team Stats Comparison', 'Key Matchups', 'Injury Report', 'Recent Form (both teams)', 'Betting Line/Odds', 'Historical Head-to-Head', 'Web Sources']

const PAST_GAME_AREAS: Record<string, string[]> = {
  NFL: ['Passing Yards', 'Rushing Yards', 'Touchdowns', 'Turnovers', 'Sacks', 'Key Player Stats', 'Key Turning Points'],
  NBA: ['Points', 'Assists', 'Rebounds', 'Steals', 'Blocks', 'Key Player Stats', 'Key Turning Points'],
  NHL: ['Goals', 'Assists', 'Shots on Goal', 'Hits', 'Penalty Minutes', 'Key Player Stats', 'Key Turning Points'],
  MLB: ['Hits', 'Home Runs', 'RBI', 'Strikeouts', 'ERA', 'Batting Average', 'Key Player Stats', 'Key Turning Points'],
}

const STYLES = ['Normal', 'Stephen A. Smith', 'Nick Wright', 'Skip Bayless', 'Pat McAfee', 'Bill Simmons'] as const

function getPastGameAreas(sport: string): string[] {
  return PAST_GAME_AREAS[sport.toUpperCase()] ?? PAST_GAME_AREAS.MLB
}

interface AiConciergeProps {
  sport: string
  teamId: string
  teamAbbreviation: string
  teamColor: string
  pageType: 'team' | 'next-game' | 'past-game'
  eventId?: string
}

export default function AiConcierge({ sport, teamId, teamAbbreviation, teamColor, pageType, eventId }: AiConciergeProps) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [output, setOutput] = useState<string | null>(null)
  const [selectedStyle, setSelectedStyle] = useState('Normal')
  const [customQuestion, setCustomQuestion] = useState('')
  const outputRef = useRef<HTMLDivElement>(null)

  const areas = pageType === 'past-game' ? getPastGameAreas(sport) : pageType === 'next-game' ? NEXT_GAME_AREAS : TEAM_AREAS

  useEffect(() => {
    if (open) {
      setSelected(new Set(areas))
      setOutput(null)
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
    try {
      const res = await fetch('/api/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        const err = await res.json().catch(() => ({ error: res.statusText }))
        setOutput(`Error: ${err.error ?? 'Unknown error'}`)
      } else {
        const data = await res.json()
        setOutput(data.content ?? 'No response generated')
      }
    } catch (err: any) {
      setOutput(`Error: ${err.message ?? 'Request failed'}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (output && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform duration-200"
        style={{ backgroundColor: teamColor }}
        title="AI Concierge"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="20" height="20">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-6">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div
            className="relative w-full max-w-lg rounded-2xl shadow-2xl animate-fade-in-up overflow-hidden"
            style={{ backgroundColor: '#0f0f1a', border: `1px solid ${teamColor}25` }}
          >
            <div className="flex items-center justify-between p-4 sm:p-5 border-b" style={{ borderColor: `${teamColor}15` }}>
              <h2 className="text-sm font-medium tracking-wider text-white/80">
                {pageType === 'team' ? 'Team Analysis' : pageType === 'next-game' ? 'Game Preview' : 'Game Recap'}
              </h2>
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white text-lg leading-none">&times;</button>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              <div>
                <p className="text-xs text-gray-500 mb-2">Style</p>
                <div className="flex flex-wrap gap-1.5">
                  {STYLES.map(style => {
                    const isActive = selectedStyle === style
                    return (
                      <button
                        key={style}
                        onClick={() => setSelectedStyle(style)}
                        className="text-[11px] px-2.5 py-1 rounded-full transition-all duration-150"
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
                  <p className="text-xs text-gray-500">Focus areas</p>
                  <button
                    onClick={toggleAll}
                    className="text-[11px] px-2 py-0.5 rounded-full transition-colors"
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
                <p className="text-xs text-gray-500 mb-2">Or ask your own question</p>
                <input
                  type="text"
                  value={customQuestion}
                  onChange={e => setCustomQuestion(e.target.value)}
                  placeholder="e.g. What's the biggest weakness of this team?"
                  className="w-full text-xs px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/80 placeholder:text-gray-600 outline-none focus:border-white/25 transition-colors"
                />
              </div>

              <button
                onClick={handleGenerate}
                disabled={!canGenerate || loading}
                className={`w-full text-sm font-medium py-2.5 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed ${canGenerate && !loading ? 'gen-btn-glow' : ''}`}
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

              {output && (
                <div
                  ref={outputRef}
                  className="rounded-xl p-4 text-sm leading-relaxed text-white/80 max-h-80 overflow-y-auto prose prose-invert prose-sm"
                  style={{ backgroundColor: `${teamColor}08`, border: `1px solid ${teamColor}15` }}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {output}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
