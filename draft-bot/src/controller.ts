import readline from 'node:readline'
import { stdin as input, stdout as output } from 'node:process'
import { chromium, type Page } from 'playwright'
import type { BotConfig } from './config'
import type { ValueIndex } from './engine/values'
import { lookup } from './engine/values'
import { decideBid, suggestNominations, type NominationCandidate } from './engine/strategy'
import { normalizeName } from './names'
import {
  readSnapshot,
  type DraftSnapshot,
  type ParsedPick,
} from './yahoo/draft-state'
import {
  enterDraft,
  isMyTurnToBid,
  isMyTurnToNominate,
  nominatePlayer,
  passBid,
  placeBid,
} from './yahoo/actions'
import { bodyText, selectorsFromEnv } from './yahoo/selectors'
import { alertUser, banner } from './notify'
import { positionCapacity } from '@/lib/fantasy/mock-draft'

/**
 * The hybrid brain. Watches the Yahoo draft room, auto-bids up to AUTO_BID_CAP, and
 * when a decision would cross that cap it pings the user and waits — while keeping
 * an eye on the room so an outbid cancels the prompt instead of forcing a stale bid.
 */

interface PromptHandle {
  resolve: (v: string) => void
}

let pendingPrompt: PromptHandle | null = null

function makePrompt(rl: readline.Interface): (prompt: string) => Promise<string> {
  rl.on('line', (line) => {
    if (pendingPrompt) {
      const handle = pendingPrompt
      pendingPrompt = null
      handle.resolve(line)
    }
  })
  return (prompt: string) =>
    new Promise<string>((resolve) => {
      pendingPrompt = { resolve }
      output.write(prompt)
    })
}

/** Ask the user, but bail out with 'STATE_CHANGED' if the room moves first. */
async function promptWithWatch(
  rl: readline.Interface,
  ask: (p: string) => Promise<string>,
  page: Page,
  selectors: ReturnType<typeof selectorsFromEnv>,
  cfg: BotConfig,
  prev: DraftSnapshot,
  prompt: string,
): Promise<string> {
  const watcher = (async () => {
    for (;;) {
      await new Promise((r) => setTimeout(r, cfg.pollMs))
      try {
        const s = await readSnapshot(page, selectors, cfg.myTeamName)
        if (s.nominatedPlayer !== prev.nominatedPlayer || s.currentBid !== prev.currentBid) return 'STATE_CHANGED'
      } catch {
        return 'STATE_CHANGED'
      }
    }
  })()

  const answer = await Promise.race([ask(prompt), watcher])
  // A watcher win leaves the ask unresolved; drop the handle so the next ask works.
  if (pendingPrompt) {
    pendingPrompt = null
  }
  return answer
}

class DraftTracker {
  pickedKeys = new Set<string>()
  myPicks: ParsedPick[] = []
  myBudget: number | null = null

  constructor(private cfg: BotConfig) {}

  update(snap: DraftSnapshot): void {
    for (const p of snap.pickLog) this.pickedKeys.add(normalizeName(p.name))

    if (snap.myRoster.length > 0) this.myPicks = snap.myRoster
    if (snap.myBudget != null) {
      this.myBudget = snap.myBudget
    } else {
      const spent = this.myPicks.reduce((s, p) => s + (p.price ?? 0), 0)
      this.myBudget = this.cfg.budget - spent
    }
  }

  remainingBudget(): number {
    return this.myBudget ?? this.cfg.budget
  }

  remainingSlots(): number {
    return Math.max(0, this.cfg.rosterSize - this.myPicks.length)
  }

  byPos(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const p of this.myPicks) {
      if (p.pos) out[p.pos] = (out[p.pos] ?? 0) + 1
    }
    return out
  }

  positionFilled(pos: string): boolean {
    const posKey = pos as 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'D/ST'
    const cap = positionCapacity(this.cfg.starters, this.cfg.rosterSize, posKey)
    return (this.byPos()[pos] ?? 0) >= cap
  }

  myPicksSummary(): string {
    return this.myPicks.length === 0
      ? 'no picks tracked yet'
      : this.myPicks.map((p) => `${p.name}${p.price != null ? ` $${p.price}` : ''}`).join(', ')
  }
}

export async function runBot(cfg: BotConfig, values: ValueIndex): Promise<void> {
  const selectors = selectorsFromEnv()
  const context = await chromium.launchPersistentContext(cfg.userDataDir, {
    headless: cfg.headless,
    viewport: { width: 1440, height: 900 },
  })
  const page = context.pages()[0] ?? (await context.newPage())

  process.once('SIGINT', async () => {
    await context.close().catch(() => {})
    process.exit(130)
  })

  banner(`Fanspot auction draft bot — league ${cfg.leagueId} (dry run: ${cfg.dryRun})`)
  console.log(
    `Model pricing: ${values.rows.length} players priced, $${cfg.budget} budget, ${cfg.teams} teams, ` +
      `${cfg.rosterSize}-man rosters, ${cfg.scoringFormat}. Auto-bid cap: $${cfg.autoBidCap}.`,
  )
  if (cfg.dryRun) console.log('DRY RUN — decisions are logged, nothing will be clicked.\n')

  await page.goto(cfg.draftUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 1500))

  if (/login|signin|auth/i.test(page.url()) || (await bodyText(page)).match(/sign ?in|log ?in/i)) {
    banner('LOGIN REQUIRED — log in to Yahoo in the browser window, then press Enter here.')
    const rl = readline.createInterface({ input, output })
    await new Promise<void>((resolve) => {
      rl.question('Press Enter after you are logged in and back on the draft page... ', () => resolve())
    })
    rl.close()
    await page.goto(cfg.draftUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise((r) => setTimeout(r, 1500))
  }

  const rl = readline.createInterface({ input, output })
  const ask = makePrompt(rl)
  const tracker = new DraftTracker(cfg)

  console.log('Watching the draft room. Press Ctrl+C to stop.\n')
  let lastDecided = ''

  for (;;) {
    let snap: DraftSnapshot
    try {
      snap = await readSnapshot(page, selectors, cfg.myTeamName)
    } catch (err) {
      console.warn('[bot] snapshot failed, retrying:', err instanceof Error ? err.message : String(err))
      await new Promise((r) => setTimeout(r, cfg.pollMs))
      continue
    }

    tracker.update(snap)

    if (snap.phase === 'done') {
      banner('DRAFT COMPLETE')
      console.log(`Final roster: ${tracker.myPicksSummary()}`)
      console.log(`Dollars spent: $${cfg.budget - tracker.remainingBudget()}`)
      break
    }

    if (snap.phase === 'lobby') {
      const entered = await enterDraft(page, selectors)
      if (!entered && lastDecided !== 'lobby') {
        console.log('[bot] In the draft lobby — waiting for the draft to open...')
        lastDecided = 'lobby'
      } else if (entered) {
        console.log('[bot] Entered the draft room.')
        lastDecided = ''
      }
      await new Promise((r) => setTimeout(r, cfg.pollMs))
      continue
    }

    const myBidTurn = await isMyTurnToBid(page, selectors)
    const myNomTurn = await isMyTurnToNominate(page, selectors)

    if (snap.phase === 'bidding' && myBidTurn && snap.currentBid != null) {
      lastDecided = await handleBidTurn(cfg, values, tracker, page, selectors, rl, ask, snap, lastDecided)
      await new Promise((r) => setTimeout(r, cfg.pollMs))
      continue
    }

    if (myNomTurn && snap.nominatedPlayer == null) {
      lastDecided = await handleNominationTurn(cfg, values, tracker, page, selectors, rl, ask, lastDecided)
      await new Promise((r) => setTimeout(r, cfg.pollMs))
      continue
    }

    await new Promise((r) => setTimeout(r, cfg.pollMs))
  }

  rl.close()
  await context.close()
}

async function handleBidTurn(
  cfg: BotConfig,
  values: ValueIndex,
  tracker: DraftTracker,
  page: Page,
  selectors: ReturnType<typeof selectorsFromEnv>,
  rl: readline.Interface,
  ask: (p: string) => Promise<string>,
  snap: DraftSnapshot,
  lastDecided: string,
): Promise<string> {
  const name = snap.nominatedPlayer
  if (!name) return lastDecided

  const row = lookup(values, name)
  const decisionKey = `bid:${normalizeName(name)}:${snap.currentBid}`
  if (decisionKey === lastDecided) return lastDecided

  if (!row) {
    console.log(`[bot] "${name}" is not in the model data — passing. (Check \`npm run values\` to verify matching.)`)
    if (!cfg.dryRun) await passBid(page, selectors)
    return decisionKey
  }

  const decision = decideBid({
    value: row.value,
    currentBid: snap.currentBid ?? 0,
    remainingBudget: tracker.remainingBudget(),
    remainingSlots: tracker.remainingSlots(),
    positionFilled: tracker.positionFilled(row.pos),
    unavailable: row.unavailable,
    autoBidCap: cfg.autoBidCap,
    maxShareOfBudget: cfg.maxShareOfBudget,
  })

  switch (decision.action) {
    case 'pass':
      console.log(`[bot] ${name} (${row.pos}/${row.team}) value $${row.value} — pass (${decision.reason}).`)
      if (!cfg.dryRun) await passBid(page, selectors)
      return decisionKey

    case 'auto-bid':
      console.log(`[bot] ${name} (${row.pos}/${row.team}) value $${row.value} — auto-bidding $${decision.amount}.`)
      if (cfg.dryRun) {
        console.log('      [dry-run] would click Bid.')
      } else {
        const ok = await placeBid(page, selectors, decision.amount)
        if (!ok) console.warn('      [bot] bid click failed — check selectors or bid manually!')
      }
      return decisionKey

    case 'prompt': {
      const flag = row.unavailable && row.unavailableReason ? ` [INJURY WATCH: ${row.unavailableReason}]` : ''
      const msg =
        `BIG BID NEEDED: ${name} (${row.pos}/${row.team}) — recommend $${decision.amount} ${decision.note}.` +
        `${flag} Budget left: $${tracker.remainingBudget()}, ${tracker.remainingSlots()} slots.`
      await alertUser(msg, cfg.pingUrl)
      console.log(`[bot] ${msg}`)
      const answer = await promptWithWatch(
        rl,
        ask,
        page,
        selectors,
        cfg,
        snap,
        `  [Enter]=bid $${decision.amount} | number=custom bid | p=pass | s=skip > `,
      )
      if (answer === 'STATE_CHANGED') {
        console.log('[bot] Room moved while you decided — re-evaluating.')
        return ''
      }
      if (answer === 'p' || answer === 'P') {
        if (!cfg.dryRun) await passBid(page, selectors)
        return decisionKey
      }
      if (answer === 's' || answer === 'S') {
        return decisionKey
      }
      const custom = Number(answer)
      const amount = answer.trim() === '' ? decision.amount : custom
      if (!Number.isFinite(amount) || amount <= (snap.currentBid ?? 0)) {
        console.log('  [bot] invalid bid amount — passing.')
        if (!cfg.dryRun) await passBid(page, selectors)
        return decisionKey
      }
      if (cfg.dryRun) {
        console.log(`      [dry-run] would bid $${amount}.`)
      } else {
        const ok = await placeBid(page, selectors, amount)
        if (!ok) console.warn('      [bot] bid click failed — bid manually!')
      }
      return decisionKey
    }
  }
}

async function handleNominationTurn(
  cfg: BotConfig,
  values: ValueIndex,
  tracker: DraftTracker,
  page: Page,
  selectors: ReturnType<typeof selectorsFromEnv>,
  rl: readline.Interface,
  ask: (p: string) => Promise<string>,
  lastDecided: string,
): Promise<string> {
  const suggestions = suggestNominations({
    rows: values.rows.map((r) => ({
      name: r.name,
      pos: r.pos,
      team: r.team,
      value: r.value,
      surplus: r.surplus,
    })),
    pickedKeys: tracker.pickedKeys,
    myByPos: tracker.byPos(),
    starters: cfg.starters,
    rosterSize: cfg.rosterSize,
    remainingBudget: tracker.remainingBudget(),
  })

  if (lastDecided.startsWith('nom:')) return lastDecided

  if (suggestions.length === 0) {
    console.log('[bot] Nomination turn, but no affordable suggestions — nominate manually or pass the clock.')
    return 'nom:empty'
  }

  const lines = suggestions
    .map((s, i) => `    ${i + 1}. ${s.name} (${s.pos}/${s.team}) — value $${s.value}`)
    .join('\n')
  console.log(`[bot] Your turn to nominate. Suggestions:\n${lines}`)

  if (cfg.autoNominate) {
    const target = suggestions[0] as NominationCandidate
    console.log(`[bot] AUTO_NOMINATE — nominating ${target.name}.`)
    if (cfg.dryRun) {
      console.log('      [dry-run] would nominate.')
      return `nom:${normalizeName(target.name)}`
    }
    const ok = await nominatePlayer(page, selectors, target.name)
    if (!ok) console.warn('      [bot] nomination click failed — nominate manually!')
    return `nom:${normalizeName(target.name)}`
  }

  const answer = await promptWithWatch(
    rl,
    ask,
    page,
    selectors,
    cfg,
    await readSnapshot(page, selectors, cfg.myTeamName),
    `  [Enter]=nominate #1 | 1-${suggestions.length}=that one | type a player name | s=skip > `,
  )
  if (answer === 'STATE_CHANGED') return ''

  const sel = Number(answer)
  let target: NominationCandidate | null = null
  if (answer.trim() === '') {
    target = suggestions[0] ?? null
  } else if (Number.isFinite(sel) && sel >= 1 && sel <= suggestions.length) {
    target = suggestions[sel - 1] ?? null
  } else if (answer.toLowerCase() !== 's') {
    const row = lookup(values, answer)
    if (row && !tracker.pickedKeys.has(normalizeName(row.name))) target = row
    else console.log(`  [bot] "${answer}" not found — pick one of the suggestions or type a name from the pool.`)
  }

  if (!target) {
    console.log('  [bot] Skipping this nomination turn.')
    return 'nom:skipped'
  }

  if (cfg.dryRun) {
    console.log(`      [dry-run] would nominate ${target.name}.`)
  } else {
    const ok = await nominatePlayer(page, selectors, target.name)
    if (!ok) console.warn('      [bot] nomination click failed — nominate manually!')
  }
  return `nom:${normalizeName(target.name)}`
}
