'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createDraft,
  simulate,
  recommend,
  applyPick,
  projectDraftGrade,
  MOCK_POSITIONS,
  positionCapacity,
  DEFAULT_STARTERS,
  INJURY_GRADE,
} from '@/lib/fantasy/mock-draft'
import type {
  MockDraftSettings,
  DraftState,
  DraftPoolPlayer,
  DraftPick,
} from '@/lib/fantasy/mock-draft'
import type { InjuryTier } from '@/lib/fantasy/injury-gate'
import PoolPicker from './PoolPicker'
import AuctionDraftRoom from './AuctionDraftRoom'
import styles from './steals.module.css'

interface DraftRoomResponse {
  settings: MockDraftSettings
  pool: DraftPoolPlayer[]
  counts: Record<string, number>
  total: number
  generatedAt: string
}

const SCORING_OPTIONS = [
  { value: 'ppr', label: 'PPR' },
  { value: 'half-ppr', label: 'Half-PPR' },
  { value: 'standard', label: 'Standard' },
]

/** 0-based order slot → 1-based draft round. */
function roundOf(slot: number, teams: number): number {
  return Math.floor(slot / teams) + 1
}

const INJURY_LABEL: Partial<Record<InjuryTier, string>> = {
  probable: 'Probable',
  questionable: 'Questionable',
  doubtful: 'Doubtful',
}

function InjuryTag({ tier, status }: { tier: InjuryTier; status?: string }) {
  const label = INJURY_LABEL[tier]
  if (!label) return null
  const penalty = Math.round((1 - (INJURY_GRADE[tier] ?? 1)) * 100)
  return (
    <span
      className={`${styles.injTag} ${tier === 'doubtful' ? styles.injDoubtful : styles.injWarn}`}
      title={`${label} · ${status ?? ''} · graders rank it at ${INJURY_GRADE[tier] ?? 1}× these projections${penalty > 0 ? ` (−${penalty}%)` : ''}`}
    >
      {tier === 'probable' ? 'prob' : tier}
      {penalty > 0 ? ` −${penalty}%` : ''}
    </span>
  )
}

function DraftBoard({ state }: { state: DraftState }) {
  const grid = useMemo(() => {
    const cells: (DraftPick | undefined)[] = Array.from({ length: state.order.length })
    for (const t of state.teams) {
      for (const pick of t.picks) cells[pick.slot] = pick
    }
    return cells
  }, [state])

  return (
    <div className={styles.draftBoard}>
      <div className={styles.boardHead}>
        <span className={styles.boardPickCol}>Pick</span>
        <span className={styles.boardSpinCol}>Rd</span>
        <span className={styles.boardNameCol}>Player · Pos — Team</span>
      </div>
      <ol className={styles.boardRows}>
        {grid.map((pick, slot) => {
          const manager = state.order[slot]
          const isUser = state.teams[manager]?.isUser
          const cls = [
            styles.boardRow,
            pick ? styles.boardFilled : styles.boardOpen,
            state.cursor === slot ? styles.currentSlot : '',
          ].join(' ')
          return (
            <li key={slot} className={cls}>
              <span className={styles.boardPickno}>#{slot + 1}</span>
              <span className={styles.boardRd}>{roundOf(slot, state.settings.teams)}</span>
              {pick ? (
                <>
                  <span className={`${styles.boardName} ${isUser ? styles.boardNameUser : ''}`}>
                    <b>{pick.name}</b>
                    <em>
                      {pick.pos} · {pick.team}
                    </em>
                    {pick.injuryTier ? (
                      <InjuryTag tier={pick.injuryTier} status={pick.injuryStatus} />
                    ) : null}
                    {isUser ? <i className={styles.boardYou}>you</i> : null}
                  </span>
                </>
              ) : (
                <span className={styles.boardName}>
                  {state.cursor === slot ? 'On the clock' : 'Upcoming'}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Coach({
  coords,
  onPick,
}: {
  coords: DraftPoolPlayer[]
  onPick: (p: DraftPoolPlayer) => void
}) {
  return (
    <div className={styles.coach}>
      <p className={styles.coachTitle}>
        Draft Coach — on the clock, and here&apos;s what the room is watching. Pick from the
        top of the same list the bots draft off, ordered by projection weighed by position
        reliability, scoring format, where the round is and how thin the position is — and
        cut by any injury risk.
      </p>
      <ol className={styles.coachList}>
        {coords.slice(0, 6).map((p, i) => (
          <li key={p.playerId}>
            <span className={styles.coachRank}>#{i + 1}</span>
            <span className={styles.coachName}>
              {p.name}
              {p.injuryTier !== 'healthy' ? <InjuryTag tier={p.injuryTier} status={p.injuryStatus} /> : null}
              <em>
                {p.pos} · {p.team} · Proj rank #{p.posRank}
              </em>
            </span>
            <span
              className={
                p.gap > 0 ? styles.coachGapPos : p.gap < 0 ? styles.coachGapNeg : styles.coachGapFlat
              }
              title="ADP rank − projection rank; positive means the player is falling past their value"
            >
              {p.gap > 0 ? '+' : ''}{p.gap}
            </span>
            <button className={styles.coachPick} onClick={() => onPick(p)}>
              Draft
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

function TeamRoster({
  teamIdx,
  state,
  label,
}: {
  teamIdx: number
  state: DraftState
  label: string
}) {
  const team = state.teams[teamIdx]
  return (
    <div className={`${styles.teamCard} ${team.isUser ? styles.userTeam : ''}`}>
      <div className={styles.teamHead}>
        <b>{label}</b>
        <span className={styles.teamProj}>{team.projected.toFixed(0)} proj</span>
      </div>
      <div className={styles.teamByPos}>
        {[...MOCK_POSITIONS].map((pos) => {
          const n = team.byPos[pos as keyof typeof team.byPos] ?? 0
          return (
            <span key={pos} className={styles.teamFish}>
              {pos} <b>{n}</b>
            </span>
          )
        })}
      </div>
      <ul className={styles.teamPicks}>
        {team.picks.map((p) => (
          <li key={p.playerId}>
            <span className={styles.teamPickNo}>#{p.slot + 1}</span>
            <span className={styles.teamPickName}>
              {p.name}
              {p.injuryTier !== 'healthy' ? (
                <InjuryTag tier={p.injuryTier} status={p.injuryStatus} />
              ) : null}
            </span>
            <span className={styles.teamPickMeta}>({p.pos} · {p.team})</span>
          </li>
        ))}
        {Array.from({ length: Math.max(0, state.settings.rosterSize - team.picks.length) }).map((_, i) => (
          <li key={`open-${i}`} className={styles.teamPickOpen}>
            <span className={styles.teamPickNo}>#{team.picks.length + i + 1}</span>
            <span className={styles.teamPickName}>open</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function MockDraftRoom({ sport }: { sport: string }) {
  const [settings, setSettings] = useState<MockDraftSettings>({
    teams: 12,
    pick: 1,
    rosterSize: 16,
    scoringFormat: 'ppr',
    adpPlatform: 'espn',
    starters: DEFAULT_STARTERS,
  })
  const [state, setState] = useState<DraftState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [format, setFormat] = useState<'snake' | 'auction'>('snake')
  const [roomPool, setRoomPool] = useState<DraftPoolPlayer[]>([])

  const loadRoom = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({
        teams: String(settings.teams),
        pick: String(settings.pick),
        rosterSize: String(settings.rosterSize),
        scoring: settings.scoringFormat,
        adpPlatform: settings.adpPlatform,
        QB: String(settings.starters.QB),
        RB: String(settings.starters.RB),
        WR: String(settings.starters.WR),
        TE: String(settings.starters.TE),
        K: String(settings.starters.K),
        'D/ST': String(settings.starters['D/ST']),
        FLEX: String(settings.starters.FLEX),
      })
      const res = await fetch(`/api/fantasy/mock-draft/${sport}?${q}`, {
        signal: AbortSignal.timeout(60000),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message || body.error || `HTTP ${res.status}`)
      }
      const data: DraftRoomResponse = await res.json()
      setState(createDraft(data.pool, data.settings))
      setRoomPool(data.pool)
      setGeneratedAt(data.generatedAt)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the draft room')
    } finally {
      setLoading(false)
    }
    // The room only depends on these settings, not on how the browser re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport, settings.teams, settings.pick, settings.rosterSize, settings.scoringFormat, settings.adpPlatform, settings.starters])

  useEffect(() => {
    void loadRoom()
  }, [loadRoom])

  const isMyTurn = state != null && !state.completed && state.teams[state.order[state.cursor]]?.isUser === true
  const myManager = state?.teams.findIndex((t) => t.isUser) ?? -1

  const coords = useMemo(() => {
    if (!state || !isMyTurn) return []
    return recommend(state, 6)
  }, [state, isMyTurn])

  // "Don't like your options?" — which remaining players no longer fit the user's roster,
  // so the choose-your-own picker can grey them out instead of hiding them.
  const snakeDisabled = useMemo(() => {
    const set = new Set<number>()
    if (!state || !isMyTurn) return set
    const team = state.teams[state.order[state.cursor]]
    const starters = state.settings.starters
    for (const pl of state.pool) {
      if ((team.byPos[pl.pos] ?? 0) >= positionCapacity(starters, state.settings.rosterSize, pl.pos)) {
        set.add(pl.playerId)
      }
    }
    return set
  }, [state, isMyTurn])

  // The user's one explicit choice, then the bots immediately fill to the next human
  // decision. `recommend` guarantees the pick has an open slot, so this is exact.
  function choose(p: DraftPoolPlayer) {
    if (!state) return
    const res = applyPick(state, p)
    if (!res.changed) return
    let next = res.state
    if (!next.completed) next = simulate(next, { untilUser: true })
    setState(next)
  }

  function autoToMe() {
    if (!state) return
    const next = simulate(state, { untilUser: true })
    if (next !== state) setState(next)
  }

  function autoAll() {
    if (!state) return
    const next = simulate(state, { untilUser: false })
    if (next !== state) setState(next)
  }

  const STARTER_LABELS: { key: keyof typeof settings.starters; label: string; max: number }[] = [
    { key: 'QB', label: 'QB', max: 6 },
    { key: 'RB', label: 'RB', max: 8 },
    { key: 'WR', label: 'WR', max: 10 },
    { key: 'TE', label: 'TE', max: 6 },
    { key: 'FLEX', label: 'Flex', max: 6 },
    { key: 'D/ST', label: 'D/ST', max: 4 },
    { key: 'K', label: 'K', max: 4 },
  ]

  function setStarter(key: keyof typeof settings.starters, value: number) {
    setSettings({
      ...settings,
      starters: { ...settings.starters, [key]: Math.max(0, Math.min(12, value)) },
    })
  }

  // Build slot → pick for the grid; empty slots are the future.
  const grid = useMemo(() => {
    if (!state) return []
    const cells: (DraftPick | undefined)[] = Array.from({ length: state.order.length })
    for (const t of state.teams) {
      for (const pick of t.picks) cells[pick.slot] = pick
    }
    return cells
  }, [state])

  const grade = state?.completed ? projectDraftGrade(state) : null

  if (loading && !state) {
    return (
      <div className={styles.room}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={styles.skeleton} />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.room}>
        <div className={styles.error}>
          {error}
          <button onClick={() => void loadRoom()}>Retry</button>
        </div>
      </div>
    )
  }

  if (!state) return null

  return (
    <div className={styles.room}>
      <div className={styles.roomFormatTabs}>
        <button
          className={format === 'snake' ? styles.active : undefined}
          onClick={() => setFormat('snake')}
        >
          Snake draft
        </button>
        <button
          className={format === 'auction' ? styles.active : undefined}
          onClick={() => setFormat('auction')}
        >
          Auction draft
        </button>
      </div>

      <div className={styles.draftSettings}>
        <fieldset>
          <legend>Room</legend>
          <label>
            Teams
            <input
              type="number"
              min={2}
              max={20}
              value={state.settings.teams}
              onChange={(e) => setSettings({ ...settings, teams: Number(e.target.value) || 12 })}
            />
          </label>
          <label>
            Your pick
            <input
              type="number"
              min={1}
              max={state.settings.teams}
              value={state.settings.pick}
              onChange={(e) => setSettings({ ...settings, pick: Number(e.target.value) || 1 })}
            />
          </label>
          <label>
            Roster size
            <input
              type="number"
              min={12}
              max={24}
              value={state.settings.rosterSize}
              onChange={(e) => setSettings({ ...settings, rosterSize: Number(e.target.value) || 16 })}
            />
          </label>
          <label>
            Scoring
            <select
              value={state.settings.scoringFormat}
              onChange={(e) => setSettings({ ...settings, scoringFormat: e.target.value as never })}
            >
              {SCORING_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
        </fieldset>
        <fieldset className={styles.startersFieldset}>
          <legend>Starters</legend>
          <div className={styles.starterInputs}>
            {STARTER_LABELS.map(({ key, label, max }) => (
              <label key={key} className={styles.starterInput}>
                <span>{label}</span>
                <input
                  type="number"
                  min={0}
                  max={max}
                  value={settings.starters[key]}
                  onChange={(e) => setStarter(key, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
          <p className={styles.startersHint}>
            Required starters per lineup — everything after these is a free bench spot.
          </p>
        </fieldset>
        <button className={styles.draftRestart} onClick={() => void loadRoom()}>
          Restart
        </button>
      </div>

      {format === 'auction' ? (
        <AuctionDraftRoom sport={sport} pool={roomPool} settings={state.settings} />
      ) : (
        <>
      <div className={styles.draftStatus}>
        {state.completed ? (
          <p className={styles.draftDone}>
            Draft complete — {state.settings.teams} teams × {state.settings.rosterSize} rounds
          </p>
        ) : isMyTurn ? (
          <p className={styles.draftYou}>
            It&apos;s your pick · pick {state.settings.pick} of {state.settings.teams}
          </p>
        ) : (
          <p className={styles.draftBots}>
            Bots are drafting · {grid.length - state.cursor} picks left
          </p>
        )}
        {generatedAt && (
          <span className={styles.draftUpdated}>
            Updated {new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {!state.completed && (
        <div className={styles.draftActions}>
          <button onClick={autoToMe} disabled={isMyTurn}>
            Fast-forward bots to my next pick
          </button>
          <button onClick={autoAll}>Auto-draft my whole team</button>
        </div>
      )}

      {state.completed && grade && (
        <div className={styles.gradePanel}>
          <p className={styles.gradeLead}>
            Grade <b>{grade.grade}</b> · rank {grade.rank} of {state.settings.teams} ·{' '}
            {grade.total.toFixed(0)} projected (league avg {grade.leagueAvg.toFixed(0)})
          </p>
          <p className={styles.gradeSub}>
            {grade.steals} steal picks ·{' '}
            {grade.valueSurplus > 0 ? '+' : ''}
            {grade.valueSurplus.toFixed(0)} value surplus vs the market&apos;s ordering
          </p>
        </div>
      )}

      {isMyTurn && <Coach coords={coords} onPick={choose} />}

      {isMyTurn && (
        <PoolPicker
          pool={state.pool}
          excludedIds={state.pickedIds}
          disabledIds={snakeDisabled}
          onPick={choose}
          actionLabel="Draft"
          placeholder="Search the whole pool…"
        />
      )}

      <div className={styles.starterLegend}>
        <b>Lineup to field each week</b>
        <span>{state.settings.starters.QB} QB</span>
        <span>{state.settings.starters.RB} RB</span>
        <span>{state.settings.starters.WR} WR</span>
        <span>{state.settings.starters.TE} TE</span>
        <span>{state.settings.starters.FLEX} FLEX (RB/WR/TE)</span>
        <span>{state.settings.starters['D/ST']} D/ST</span>
        <span>{state.settings.starters.K} K</span>
        <span className={styles.starterNote}>
          · every roster drafts {state.settings.rosterSize} (starters + free bench: RB{' '}
          {positionCapacity(state.settings.starters, state.settings.rosterSize, 'RB')}, WR{' '}
          {positionCapacity(state.settings.starters, state.settings.rosterSize, 'WR')}, TE{' '}
          {positionCapacity(state.settings.starters, state.settings.rosterSize, 'TE')} …); the bots never
          leave a required starter slot empty
        </span>
      </div>

      <div className={styles.roomSplit}>
        <div className={styles.boardPane}>
          <DraftBoard state={state} />
        </div>
        <div className={styles.teamsPane}>
          <div className={styles.teamsGrid}>
            {state.teams.map((t, i) => (
              <TeamRoster
                key={i}
                teamIdx={i}
                state={state}
                label={t.isUser ? `You · pick ${state.settings.pick}` : `Team ${i + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
      <p className={styles.roomFooter}>
        {myManager >= 0
          ? `${state.teams[myManager].picks.length} / ${state.settings.rosterSize} drafted on your roster · `
          : ''}
        every team shares the same snake order · your Draft Coach ranks the exact model the bots draft off
      </p>
        </>
      )}
    </div>
  )
}