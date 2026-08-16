'use client'

import { useMemo, useState } from 'react'
import type { DraftPoolPlayer } from '@/lib/fantasy/mock-draft'
import type { InjuryTier } from '@/lib/fantasy/injury-gate'
import styles from './steals.module.css'

const INJURY_LABEL: Partial<Record<InjuryTier, string>> = {
  probable: 'Probable',
  questionable: 'Questionable',
  doubtful: 'Doubtful',
}

function InjuryTag({ tier }: { tier: InjuryTier }) {
  const label = INJURY_LABEL[tier]
  if (!label) return null
  return (
    <span className={`${styles.injTag} ${tier === 'doubtful' ? styles.injDoubtful : styles.injWarn}`}>
      {tier === 'probable' ? 'prob' : tier}
    </span>
  )
}

/**
 * "Don't like your options? Choose your own." — a searchable list of the whole
 * remaining pool, used by both the snake room (pick any player) and the auction
 * room (nominate any player). Rows show projection, ADP, gap and injury so the
 * choice is informed; rows that no longer fit the user's roster are greyed out
 * rather than hidden, so the user sees *why* a name is off-limits.
 */
export default function PoolPicker({
  pool,
  excludedIds,
  disabledIds,
  onPick,
  actionLabel = 'Draft',
  placeholder = 'Search the whole pool…',
  emptyNote = 'No players match.',
}: {
  pool: DraftPoolPlayer[]
  excludedIds: Set<number>
  disabledIds?: Set<number>
  onPick: (p: DraftPoolPlayer) => void
  actionLabel?: string
  placeholder?: string
  emptyNote?: string
}) {
  const [q, setQ] = useState('')

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    const list = pool.filter(
      (p) =>
        !excludedIds.has(p.playerId) &&
        (query === '' ||
          p.name.toLowerCase().includes(query) ||
          p.team.toLowerCase().includes(query) ||
          p.pos.toLowerCase().includes(query)),
    )
    list.sort((a, b) => b.projection - a.projection)
    return list.slice(0, 24)
  }, [pool, q, excludedIds])

  return (
    <div className={styles.picker}>
      <p className={styles.pickerTitle}>Don&apos;t like your options? Choose your own.</p>
      <input
        className={styles.pickerSearch}
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {results.length === 0 ? (
        <p className={styles.pickerEmpty}>{emptyNote}</p>
      ) : (
        <ol className={styles.pickerList}>
          {results.map((p) => {
            const disabled = disabledIds?.has(p.playerId) ?? false
            return (
              <li key={p.playerId} className={disabled ? styles.pickerDisabled : undefined}>
                <span className={styles.pickerName}>
                  <b>{p.name}</b>
                  <em>
                    {p.pos} · {p.team}
                  </em>
                  {p.injuryTier !== 'healthy' ? <InjuryTag tier={p.injuryTier} /> : null}
                </span>
                <span className={styles.pickerStat} title="Projected fantasy points">
                  {Math.round(p.projection)} proj
                </span>
                <span className={styles.pickerStat} title="Position ADP rank">
                  ADP #{p.adpRank}
                </span>
                <span
                  className={
                    p.gap > 0 ? styles.pickerGapPos : p.gap < 0 ? styles.pickerGapNeg : styles.pickerGapFlat
                  }
                  title="ADP rank − projection rank; positive means falling past value"
                >
                  {p.gap > 0 ? '+' : ''}
                  {p.gap}
                </span>
                <button
                  className={styles.pickerPick}
                  disabled={disabled}
                  onClick={() => onPick(p)}
                  title={disabled ? 'No open slot for this position on your roster' : undefined}
                >
                  {actionLabel}
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
