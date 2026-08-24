import type { Page } from 'playwright'
import { bodyText, locatorFor, type SelectorConfig } from './selectors'

/**
 * Turns whatever Yahoo's draft room renders into a normalized DraftSnapshot. Parsing
 * is deliberately text-first (regexes over the rendered innerText) because class
 * names in Yahoo's draft client are unstable, with CSS locators only used where they
 * are cheap and safe. Every parse is best-effort: a null field just means the bot
 * falls back to derived state (e.g. budget = configured budget minus what I've spent
 * on tracked picks).
 */

export type DraftPhase = 'lobby' | 'nominating' | 'bidding' | 'done' | 'unknown'

export interface ParsedPick {
  name: string
  pos: string | null
  price: number | null
}

export interface DraftSnapshot {
  phase: DraftPhase
  /** Raw player name currently on the block (null when no nomination is live). */
  nominatedPlayer: string | null
  currentBid: number | null
  /** Dollars remaining, as displayed in the room (null if not parseable). */
  myBudget: number | null
  /** Completed picks visible in the room. */
  pickLog: ParsedPick[]
  /** Players on my roster panel (empty if not parseable). */
  myRoster: ParsedPick[]
  rawText: string
}

const POS_TOKENS = /\b(QB|RB|WR|TE|K|DEF|D\/ST|DST)\b/i

/** A plausible player-name line: 2-4 capitalized words with a period or apostrophe allowed. */
const NAME_LINE = /^[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){1,3}$/

export function parseCurrentBid(text: string): number | null {
  const patterns = [
    /(?:current|high|winning)\s+bid[:\s]*\$?\s*(\d+)/i,
    /bid\s+amount[:\s]*\$?\s*(\d+)/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) return Number(m[1])
  }
  return null
}

/**
 * The nomination card shows the player name as the strongest name-shaped line just
 * above the "Current Bid" text. Falls back to CSS candidates when the text heuristic
 * comes up empty.
 */
export async function parseNominatedPlayer(page: Page, text: string, selectors: SelectorConfig): Promise<string | null> {
  const bidIdx = text.split('\n').findIndex((l) => /current|high|winning\s+bid/i.test(l))
  if (bidIdx >= 0) {
    const window = text.split('\n').slice(Math.max(0, bidIdx - 12), bidIdx)
    for (let i = window.length - 1; i >= 0; i--) {
      const line = (window[i] ?? '').trim()
      if (!NAME_LINE.test(line)) continue
      if (/\$|bid|nominate|select|draft/i.test(line)) continue
      // Prefer lines near a position token (the card shows "QB - Kansas City" nearby).
      const near = window.slice(Math.max(0, i - 1), i + 3).some((l) => POS_TOKENS.test(l))
      if (near || i === window.length - 1) return line
    }
  }

  const loc = await locatorFor(page, selectors.nominatedPlayer)
  if (loc) {
    const t = (await loc.innerText().catch(() => '')).trim()
    if (NAME_LINE.test(t)) return t
  }
  return null
}

export function parseMyBudget(text: string, myTeamName: string | null): number | null {
  const lines = text.split('\n')
  if (myTeamName) {
    const idx = lines.findIndex((l) => l.toLowerCase().includes(myTeamName.toLowerCase()))
    if (idx >= 0) {
      const window = lines.slice(Math.max(0, idx - 2), idx + 6).join('\n')
      const m = window.match(/\$(\d+)/)
      if (m) return Number(m[1])
    }
  }
  const m = text.match(/(?:you|your team|your)\s+[^\n$]{0,40}\$(\d+)/i)
  return m ? Number(m[1]) : null
}

/** Completed-pick lines look like "Bijan Robinson — $48" or "CeeDee Lamb $52". */
export function parsePickLog(text: string): ParsedPick[] {
  const picks: ParsedPick[] = []
  const re = /([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){1,3})\s+[—–-]\s+\$(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const name = m[1]
    const price = Number(m[2])
    picks.push({ name, pos: posFromNameLine(name), price })
  }
  return picks
}

function posFromNameLine(_name: string): string | null {
  // Position isn't reliably on the same line as the pick; leave null and let the
  // tracker fill positions from the value index when it can.
  return null
}

/** Detect a "You are on the clock"-style indicator. */
export function hasOnClockText(text: string): boolean {
  return /(you|your team)[^\n]{0,60}(on the clock|are up|to bid|to nominate|make a bid)/i.test(text)
}

export function detectPhase(text: string, nominatedPlayer: string | null, currentBid: number | null): DraftPhase {
  if (/(draft\s+(is|has)\s+(complete|completed|finished)|draft\s+results|auction\s+complete)/i.test(text)) {
    return 'done'
  }
  if (/(enter\s+draft|draft\s+lobby|draft\s+starts|waiting\s+for|pre[- ]draft)/i.test(text)) {
    return 'lobby'
  }
  if (nominatedPlayer && currentBid != null) return 'bidding'
  if (/nominate/i.test(text)) return 'nominating'
  return 'unknown'
}

export async function readSnapshot(page: Page, selectors: SelectorConfig, myTeamName: string | null): Promise<DraftSnapshot> {
  const rawText = await bodyText(page)
  const currentBid = parseCurrentBid(rawText)
  const nominatedPlayer = await parseNominatedPlayer(page, rawText, selectors)
  const myBudget = parseMyBudget(rawText, myTeamName)
  const pickLog = parsePickLog(rawText)

  return {
    phase: detectPhase(rawText, nominatedPlayer, currentBid),
    nominatedPlayer,
    currentBid,
    myBudget,
    pickLog,
    myRoster: [],
    rawText,
  }
}
