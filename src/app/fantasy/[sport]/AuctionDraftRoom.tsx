'use client'

import { useEffect, useMemo, useState } from 'react'
import type { DraftPoolPlayer, MockDraftSettings, MockPosition } from '@/lib/fantasy/mock-draft'
import { positionCapacity, MOCK_POSITIONS } from '@/lib/fantasy/mock-draft'
import {
  createAuctionDraft,
  nominate,
  placeBid,
  pass,
  simulate,
  auctionCoach,
  suggestBid,
  auctionDraftGrade,
} from '@/lib/fantasy/auction-draft-engine'
import type { AuctionDraftState, AuctionPick, AuctionTeam } from '@/lib/fantasy/auction-draft-engine'
import PoolPicker from './PoolPicker'
import styles from './steals.module.css'

const SCORING_OPTIONS = [
  { value: 'ppr', label: 'PPR' },
  { value: 'half-ppr', label: 'Half-PPR' },
  { value: 'standard', label: 'Standard' },
]

const MONEY = (n: number) => `$${n}`

function TeamCard({ team, label }: { team: AuctionTeam; label: string }) {
  return (
    <div className={`${styles.teamCard} ${team.isUser ? styles.userTeam : ''}`}>
      <div className={styles.teamHead}>
        <b>{label}</b>
        <span className={styles.teamProj}>
          {MONEY(team.budget)} left · {Math.round(team.projected)} proj
        </span>
      </div>
      <div className={styles.teamByPos}>
        {[...MOCK_POSITIONS].map((pos) => {
          const n = team.byPos[pos as MockPosition] ?? 0
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
            <span className={styles.teamPickNo}>{MONEY(p.price)}</span>
            <span className={styles.teamPickName}>{p.name}</span>
            <span className={styles.teamPickMeta}>({p.pos} · {p.team})</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function AuctionDraftRoom({
  sport,
  pool,
  settings,
}: {
  sport: string
  pool: DraftPoolPlayer[]
  settings: MockDraftSettings
}) {
  const [budget, setBudget] = useState(200)
  const [auction, setAuction] = useState<AuctionDraftState | null>(null)
  const [customBid, setCustomBid] = useState('')

  const userIdx = Math.max(0, Math.min(settings.teams - 1, settings.pick - 1))

  const draftSettings = useMemo(
    () => ({
      teams: settings.teams,
      rosterSize: settings.rosterSize,
      budget: Math.max(10, Math.min(1000, budget || 200)),
      scoringFormat: settings.scoringFormat,
      adpPlatform: settings.adpPlatform,
      starters: settings.starters,
      userTeam: userIdx,
    }),
    [settings, budget, userIdx],
  )

  useEffect(() => {
    const created = createAuctionDraft(pool, draftSettings)
    // The human nominates first, so the room opens on a decision they can make.
    setAuction(simulate(created, { untilUser: true }))
    setCustomBid('')
  }, [pool, draftSettings])

  const act = (next: AuctionDraftState) => {
    setAuction(simulate(next, { untilUser: true }))
  }

  const isMyNomination =
    auction != null && !auction.completed && auction.phase === 'nominating' && auction.nominateManager === userIdx
  const isMyBid =
    auction != null && !auction.completed && auction.phase === 'bidding' && auction.activeBidders[auction.bidCursor] === userIdx

  const coach = isMyNomination ? auctionCoach(auction, 6) : []
  const bid = isMyBid ? suggestBid(auction) : null

  const disabledIds = useMemo(() => {
    const set = new Set<number>()
    if (!auction) return set
    const team = auction.teams[userIdx]
    const s = auction.settings
    const slotsLeft = s.rosterSize - team.picks.length
    for (const p of auction.pool) {
      if ((team.byPos[p.pos] ?? 0) >= positionCapacity(s.starters, s.rosterSize, p.pos)) {
        set.add(p.playerId)
      } else if (team.budget < slotsLeft) {
        // Can't afford the $1 opening bid while keeping the $1-per-slot reserve.
        set.add(p.playerId)
      }
    }
    return set
  }, [auction, userIdx])

  const myTeam = auction?.teams[userIdx]
  const maxAffordable = myTeam ? myTeam.budget - Math.max(0, settings.rosterSize - myTeam.picks.length - 1) : 0

  if (!auction) {
    return (
      <div className={styles.room}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={styles.skeleton} />
        ))}
      </div>
    )
  }

  const grade = auction.completed ? auctionDraftGrade(auction) : null
  const currentBidderLabel = auction.currentBidder == null ? null : auction.teams[auction.currentBidder]?.isUser ? 'You' : `Team ${auction.currentBidder + 1}`

  return (
    <div className={styles.room}>
      <div className={styles.draftSettings}>
        <fieldset>
          <legend>Budget</legend>
          <label>
            Per team
            <input
              type="number"
              min={10}
              max={1000}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value) || 200)}
            />
          </label>
        </fieldset>
        <p className={styles.auctionRoomHint}>
          {auction.settings.teams} teams × {MONEY(budget)} = {MONEY(auction.settings.teams * budget)} on the
          table · ${auction.settings.teams * budget - auction.settings.teams * auction.settings.rosterSize} of it is
          bid-with money (the rest is the $1-per-slot floor)
        </p>
        <button
          className={styles.draftRestart}
          onClick={() => {
            const created = createAuctionDraft(pool, draftSettings)
            setAuction(simulate(created, { untilUser: true }))
            setCustomBid('')
          }}
        >
          Restart
        </button>
      </div>

      <div className={styles.draftStatus}>
        {auction.completed ? (
          <p className={styles.draftDone}>
            Auction complete — {auction.settings.teams} teams × {auction.settings.rosterSize} roster spots
          </p>
        ) : isMyNomination ? (
          <p className={styles.draftYou}>It&apos;s your nomination — put a player on the block</p>
        ) : isMyBid ? (
          <p className={styles.draftYou}>
            It&apos;s your bid — {auction.nominatingPlayer?.name} is at {MONEY(auction.currentBid)}
          </p>
        ) : (
          <p className={styles.draftBots}>
            {auction.phase === 'nominating'
              ? `Team ${auction.nominateManager + 1} is nominating…`
              : `Bidding on ${auction.nominatingPlayer?.name} — ${MONEY(auction.currentBid)}${currentBidderLabel ? ` by ${currentBidderLabel}` : ''}`}
          </p>
        )}
      </div>

      {!auction.completed && (
        <div className={styles.draftActions}>
          <button onClick={() => setAuction(simulate(auction, { untilUser: false }))}>
            Auto-draft my whole team
          </button>
        </div>
      )}

      {auction.completed && grade && (
        <div className={styles.gradePanel}>
          <p className={styles.gradeLead}>
            Grade <b>{grade.grade}</b> · rank {grade.rank} of {auction.settings.teams} ·{' '}
            {grade.total.toFixed(0)} projected (league avg {grade.leagueAvg.toFixed(0)})
          </p>
          <p className={styles.gradeSub}>
            spent {MONEY(grade.spent)} · {grade.dollarsPerPoint.toFixed(2)} per projected point vs league{' '}
            {grade.leagueDollarsPerPoint.toFixed(2)} · {grade.bargains} pick{grade.bargains === 1 ? '' : 's'} bought
            below the model&apos;s price
          </p>
        </div>
      )}

      {isMyNomination && (
        <>
          <div className={styles.coach}>
            <p className={styles.coachTitle}>
              Nomination coach — the best values left that still fit your roster and your budget. Nominate one, and
              the room bids it up (or lets it go for $1); you can always outbid them, or watch and wait.
            </p>
            <ol className={styles.coachList}>
              {coach.map((p, i) => (
                <li key={p.playerId}>
                  <span className={styles.coachRank}>#{i + 1}</span>
                  <span className={styles.coachName}>
                    {p.name}
                 
                    <em>
                      {p.pos} · {p.team} · {Math.round(p.projection)} proj
                    </em>
                  </span>
                  <button className={styles.coachPick} onClick={() => act(nominate(auction, p))}>
                    Nominate
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <PoolPicker
            pool={auction.pool}
            excludedIds={auction.pickedIds}
            disabledIds={disabledIds}
            onPick={(p) => act(nominate(auction, p))}
            actionLabel="Nominate"
            placeholder="Search the whole pool…"
          />
        </>
      )}

      {isMyBid && auction.nominatingPlayer && bid && (
        <div className={styles.bidPanel}>
          <div className={styles.bidPlayer}>
            <b>{auction.nominatingPlayer.name}</b>
            <em>
              {auction.nominatingPlayer.pos} · {auction.nominatingPlayer.team} · {Math.round(auction.nominatingPlayer.projection)} proj · ADP #{auction.nominatingPlayer.adpRank}
            </em>
          </div>
          <div className={styles.bidState}>
            <span>
              Current bid <b>{MONEY(bid.currentBid)}</b> by {currentBidderLabel ?? '—'}
            </span>
            <span>
              Model says worth <b>{MONEY(Math.max(1, bid.maxBid))}</b> · you have{' '}
              <b>{MONEY(myTeam?.budget ?? 0)}</b> left{maxAffordable > 0 ? ` (max ${MONEY(maxAffordable)})` : ''}
            </span>
          </div>
          <div className={styles.bidControls}>
            <button
              onClick={() => act(placeBid(auction, userIdx, bid.currentBid + 1))}
              disabled={bid.currentBid + 1 > maxAffordable}
            >
              Bid {MONEY(bid.currentBid + 1)}
            </button>
            <button
              onClick={() => act(placeBid(auction, userIdx, bid.currentBid + 5))}
              disabled={bid.currentBid + 5 > maxAffordable}
            >
              Bid {MONEY(bid.currentBid + 5)}
            </button>
            <button
              onClick={() => act(placeBid(auction, userIdx, Math.max(bid.currentBid + 1, bid.maxBid)))}
              disabled={bid.maxBid > maxAffordable || bid.maxBid <= bid.currentBid}
              title={`Jump to your honest max — the model's price for this player`}
            >
              Bid to value {MONEY(Math.max(bid.currentBid + 1, bid.maxBid))}
            </button>
            <span className={styles.bidCustom}>
              <input
                type="number"
                min={bid.currentBid + 1}
                max={Math.max(maxAffordable, bid.currentBid + 1)}
                value={customBid}
                placeholder="custom"
                onChange={(e) => setCustomBid(e.target.value)}
              />
              <button
                onClick={() => act(placeBid(auction, userIdx, Number(customBid)))}
                disabled={!customBid || Number(customBid) <= bid.currentBid || Number(customBid) > maxAffordable}
              >
                Bid
              </button>
            </span>
            <button className={styles.bidPass} onClick={() => act(pass(auction, userIdx))}>
              Pass
            </button>
          </div>
        </div>
      )}

      <div className={styles.roomSplit}>
        <div className={styles.boardPane}>
          <div className={styles.draftBoard}>
            <div className={styles.boardHead}>
              <span className={styles.boardPickCol}>Sold</span>
              <span className={styles.boardSpinCol}>$</span>
              <span className={styles.boardNameCol}>Player · Pos — Team</span>
            </div>
            <ol className={styles.boardRows}>
              {auction.pickLog.length === 0 && (
                <li className={styles.boardRow}>
                  <span className={styles.boardName}>
                    <em>Nothing sold yet — nominations open the room.</em>
                  </span>
                </li>
              )}
              {auction.pickLog.map((pick: AuctionPick) => {
                const isUser = auction.teams[pick.manager]?.isUser
                return (
                  <li key={pick.slot} className={`${styles.boardRow} ${styles.boardFilled}`}>
                    <span className={styles.boardPickno}>#{pick.slot}</span>
                    <span className={styles.boardRd}>{MONEY(pick.price)}</span>
                    <span className={`${styles.boardName} ${isUser ? styles.boardNameUser : ''}`}>
                      <b>{pick.name}</b>
                      <em>
                        {pick.pos} · {pick.team} · {isUser ? 'you' : `Team ${pick.manager + 1}`}
                      </em>
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
        <div className={styles.teamsPane}>
          <div className={styles.teamsGrid}>
            {auction.teams.map((t, i) => (
              <TeamCard
                key={i}
                team={t}
                label={t.isUser ? `You · pick ${settings.pick}` : `Team ${i + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
      <p className={styles.roomFooter}>
        {myTeam
          ? `${myTeam.picks.length} / ${settings.rosterSize} rostered · ${MONEY(myTeam.budget)} of ${MONEY(budget)} left · `
          : ''}
        you nominate first, then teams rotate; bots bid up to their own valuation of every player — prices come from
        this league&apos;s money, not from thin air
      </p>
    </div>
  )
}
