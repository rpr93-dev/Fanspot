import readline from 'node:readline'
import { stdin as input, stdout as output } from 'node:process'
import type { StarterSlots } from '@/lib/fantasy/auction-engine'
import type { BotConfig } from './config'
import type { ValueIndex } from './engine/values'
import { lookup } from './engine/values'
import { decideBid, suggestNominations, bidIncrement } from './engine/strategy'
import { normalizeName } from './names'
import { banner } from './notify'
import { positionCapacity, type MockPosition } from '@/lib/fantasy/mock-draft'

/**
 * Interactive manual draft assistant.
 *
 * You feed it the situation from your draft room; it tells you what to do.
 * No browser automation - you run the clicks yourself.
 */

const AUCTION_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'] as const

interface RosterEntry {
  name: string
  price: number
  pos: string | null
}

interface KeeperEntry {
  owner: string
  name: string
  price: number
  pos?: string
}

const KEEPERS_2026: KeeperEntry[] = [
  { owner: 'Ethan', name: 'Josh Allen', price: 58, pos: 'QB' },
  { owner: 'Ethan', name: 'Tyler Shough', price: 15, pos: 'QB' },
  { owner: 'Ethan', name: "K'Aimi Fairbairn", price: 1, pos: 'K' },
  { owner: 'Brian', name: 'Bijan Robinson', price: 44, pos: 'RB' },
  { owner: 'Brian', name: 'Amon-Ra St Brown', price: 40, pos: 'WR' },
  { owner: 'Brian', name: 'Cameron Dicker', price: 1, pos: 'K' },
  { owner: 'Ravi', name: 'Matthew Stafford', price: 18, pos: 'QB' },
  { owner: 'Ravi', name: 'Christian Watson', price: 5, pos: 'WR' },
  { owner: 'Ravi', name: 'Houston Texans DEF', price: 1, pos: 'D/ST' },
  { owner: 'Matt Taylor', name: 'Jahmyr Gibbs', price: 43, pos: 'RB' },
  { owner: 'Matt Taylor', name: 'George Pickens', price: 19, pos: 'WR' },
  { owner: 'Dave Song', name: 'Joe Burrow', price: 48, pos: 'QB' },
  { owner: 'Dave Song', name: 'Colston Loveland', price: 9, pos: 'TE' },
  { owner: 'Dave Song', name: 'LA Rams DEF', price: 1, pos: 'D/ST' },
  { owner: 'Josh', name: 'Rashee Rice', price: 17, pos: 'WR' },
  { owner: 'Josh', name: 'Terry McLaurin', price: 14, pos: 'WR' },
  { owner: 'Jeff', name: 'Bo Nix', price: 29, pos: 'QB' },
  { owner: 'Jeff', name: 'James Cook', price: 21, pos: 'RB' },
  { owner: 'Jeff', name: 'Jason Myers', price: 1, pos: 'K' },
  { owner: 'Dave Giraldo', name: 'Jaxson Dart', price: 21, pos: 'QB' },
  { owner: 'Dave Giraldo', name: 'Brock Bowers', price: 19, pos: 'TE' },
  { owner: 'Eric', name: 'Caleb Williams', price: 27, pos: 'QB' },
  { owner: 'Eric', name: 'Drake Maye', price: 34, pos: 'QB' },
  { owner: 'Big Money Mark', name: 'Ladd McConkey', price: 13, pos: 'WR' },
  { owner: 'Big Money Mark', name: 'Jake Elliott', price: 1, pos: 'K' },
  { owner: 'David Rosen', name: 'Christian McCaffrey', price: 47, pos: 'RB' },
  { owner: 'David Rosen', name: 'Chris Olave', price: 15, pos: 'WR' },
  { owner: 'Varun', name: 'Malik Nabers', price: 20, pos: 'WR' },
  { owner: 'Varun', name: 'Jared Goff', price: 28, pos: 'QB' },
  { owner: 'Varun', name: 'Brandon Aubrey', price: 2, pos: 'K' },
]

interface Session {
  cfg: BotConfig
  values: ValueIndex
  myRoster: RosterEntry[]
  pickedKeys: Set<string>
  keepers: KeeperEntry[]
}

function remainingBudget(session: Session): number {
  const spent = session.myRoster.reduce((s, p) => s + p.price, 0)
  return session.cfg.budget - spent
}

function remainingSlots(session: Session): number {
  return Math.max(0, session.cfg.rosterSize - session.myRoster.length)
}

function byPos(session: Session): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of session.myRoster) {
    if (p.pos) out[p.pos] = (out[p.pos] ?? 0) + 1
  }
  return out
}

function posCapacity(session: Session, pos: string): number {
  const posKey = pos as MockPosition
  return positionCapacity(session.cfg.starters, session.cfg.rosterSize, posKey)
}

function normalizePos(pos: string | undefined | null): string | null {
  if (!pos) return null
  const p = pos.trim().toUpperCase()
  if (p === 'DEF' || p === 'DST' || p === 'D') return 'D/ST'
  if (p === 'D/ST') return 'D/ST'
  if (p === 'QB' || p === 'RB' || p === 'WR' || p === 'TE' || p === 'K') return p
  return p
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

const OWNER_ALIASES: Record<string, string[]> = {
  varun: ['nfcleast', 'nfcleast', 'nfceast', 'nfc(l)east', 'nfc (l)east'],
}

function ownerMatches(owner: string, hint: string): boolean {
  const ownerNorm = normalizeIdentity(owner)
  const hintNorm = normalizeIdentity(hint)
  if (ownerNorm === hintNorm) return true

  const aliases = OWNER_ALIASES[ownerNorm] ?? []
  return aliases.some((alias) => normalizeIdentity(alias) === hintNorm)
}

function keeperOwnerHint(): string {
  const envOwner = process.env.ASSIST_OWNER?.trim()
  if (envOwner) return envOwner
  return 'NFC (L)East'
}

function keeperLabel(session: Session, name: string): string | null {
  const key = normalizeName(name)
  const hit = session.keepers.find((k) => normalizeName(k.name) === key)
  if (!hit) return null
  return `${hit.owner} ($${hit.price})`
}

function buildInitialSession(cfg: BotConfig, values: ValueIndex): Session {
  const session: Session = {
    cfg,
    values,
    myRoster: [],
    pickedKeys: new Set(),
    keepers: KEEPERS_2026,
  }

  for (const k of session.keepers) {
    session.pickedKeys.add(normalizeName(k.name))
  }

  const me = keeperOwnerHint()
  const myKeepers = session.keepers.filter((k) => ownerMatches(k.owner, me))
  for (const k of myKeepers) {
    const row = lookup(values, k.name)
    session.myRoster.push({ name: k.name, price: k.price, pos: row?.pos ?? normalizePos(k.pos) })
  }

  return session
}

function cmdHelp(): void {
  console.log(`
Commands:
  bid <player> <$current bid>   Ask whether to bid on a nominated player
  n                             Show the best players to nominate now
  add <player> <$price> [pos]   Track a player you won
  picked <player>               Mark a player as taken off the board
  keepers [owner]               Show loaded keepers (all or by owner)
  undo                          Remove the last tracked player from your roster
  status                        Show your roster, budget, and position caps
  players <query>               Search for a player in the value index
  help                          Show this message
  quit / q                      Exit

Shortcuts: b=bid, a=add, p=picked, s=status, h=help, q=quit
`)
}

function cmdStatus(session: Session): void {
  const spent = session.myRoster.reduce((s, p) => s + p.price, 0)
  const rem = remainingBudget(session)
  const slots = remainingSlots(session)
  console.log(`\nBudget: $${rem} remaining ($${spent} spent of $${session.cfg.budget})`)
  console.log(`Roster: ${session.myRoster.length}/${session.cfg.rosterSize} slots filled (${slots} open)`)
  console.log(`Picked off the board: ${session.pickedKeys.size} players (${session.keepers.length} keepers preloaded)`)

  if (session.myRoster.length > 0) {
    console.log('\nYour roster:')
    const bp = byPos(session)
    for (const e of session.myRoster) {
      console.log(`  ${e.name.padEnd(22)} ${(e.pos ?? '?').padEnd(5)} $${e.price}`)
    }
    console.log('\nPosition counts:')
    for (const pos of AUCTION_POSITIONS) {
      const count = bp[pos] ?? 0
      const cap = posCapacity(session, pos)
      const bar = '#'.repeat(count) + '.'.repeat(Math.max(0, cap - count))
      console.log(`  ${pos.padEnd(5)} ${bar} ${count}/${cap}`)
    }
  }
  console.log()
}

function cmdBid(session: Session, args: string[]): void {
  if (args.length < 2) {
    console.log('Usage: bid <player name> <current bid in dollars>')
    console.log('Example: bid "Bijan Robinson" 35')
    return
  }

  const bid = Number(args[args.length - 1])
  if (!Number.isFinite(bid) || bid < 0) {
    console.log(`Invalid bid amount: "${args[args.length - 1]}" - use a number, e.g. bid "Bijan Robinson" 35`)
    return
  }

  const name = args.slice(0, -1).join(' ')
  const key = normalizeName(name)
  const keeperTag = keeperLabel(session, name)
  if (session.pickedKeys.has(key) && keeperTag) {
    console.log(`\n"${name}" is a keeper and not draftable (${keeperTag}).`) 
    console.log('Decision: PASS - unavailable (already kept).\n')
    return
  }

  const row = lookup(session.values, name)

  if (!row) {
    console.log(`\n"${name}" - NOT FOUND in the value index.`)
    console.log('The bot would pass on this player. Check `npm run values` to verify name matching.')
    console.log(`Try: players "${name.split(' ')[0]}" to search for similar names.\n`)
    return
  }

  const decision = decideBid({
    value: row.value,
    currentBid: bid,
    remainingBudget: remainingBudget(session),
    remainingSlots: remainingSlots(session),
    positionFilled: row.pos ? (byPos(session)[row.pos] ?? 0) >= posCapacity(session, row.pos) : false,
    unavailable: row.unavailable,
    autoBidCap: session.cfg.autoBidCap,
    maxShareOfBudget: session.cfg.maxShareOfBudget,
  })

  const market = row.market != null ? ` - market $${row.market}` : ''
  const source = `[${row.source}]`
  const flag = row.unavailable && row.unavailableReason ? ` ! ${row.unavailableReason.toUpperCase()}` : ''

  console.log(`\n${row.name} (${row.pos}/${row.team}) - model value $${row.value}${market} ${source}${flag}`)

  switch (decision.action) {
    case 'pass':
      console.log(`Decision: PASS - ${decision.reason}\n`)
      break
    case 'auto-bid': {
      const next = Math.min(decision.amount, bid + bidIncrement(bid))
      console.log(`Decision: BID $${next} (auto - ${decision.note})\n`)
      break
    }
    case 'prompt':
      console.log(`Decision: CONSIDER BIDDING up to $${decision.amount}`)
      console.log(`  Reason: ${decision.note}`)
      console.log(`  Next increment would be $${bid + bidIncrement(bid)}`)
      console.log(`  Budget left: $${remainingBudget(session)}, ${remainingSlots(session)} slots open\n`)
      break
  }
}

function cmdPlayers(session: Session, args: string[]): void {
  const query = args.join(' ')
  if (!query) {
    console.log('Usage: players <name fragment>')
    return
  }
  const key = normalizeName(query)
  const matches = [...session.values.byKey.entries()]
    .filter(([k]) => k.includes(key))
    .slice(0, 15)

  if (matches.length === 0) {
    console.log(`No players matching "${query}".`)
    return
  }
  console.log(`\nPlayers matching "${query}":`)
  for (const [, v] of matches) {
    const market = v.market != null ? ` - market $${v.market}` : ''
    const flag = v.unavailable ? ' !' : ''
    const keeper = keeperLabel(session, v.name)
    const keeperNote = keeper ? ` [KEEPER: ${keeper}]` : ''
    console.log(`  ${v.name.padEnd(22)} ${v.pos.padEnd(5)} ${v.team.padEnd(3)} value $${v.value}${market} [${v.source}]${flag}${keeperNote}`)
  }
  console.log()
}

function cmdNominate(session: Session): void {
  const suggestions = suggestNominations({
    rows: session.values.rows.map((r) => ({
      name: r.name,
      pos: r.pos,
      team: r.team,
      value: r.value,
      surplus: r.surplus,
    })),
    pickedKeys: session.pickedKeys,
    myByPos: byPos(session),
    starters: session.cfg.starters,
    rosterSize: session.cfg.rosterSize,
    remainingBudget: remainingBudget(session),
  })

  if (suggestions.length === 0) {
    console.log('\nNo affordable nomination suggestions - positions may be full or budget too tight.\n')
    return
  }

  console.log('\nBest players to nominate (highest surplus first):')
  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i]!
    const surplus = s.surplus != null ? ` (surplus +$${s.surplus})` : ''
    const market = session.values.byKey.get(normalizeName(s.name))?.market
    const mkt = market != null ? ` - market $${market}` : ''
    console.log(`  ${i + 1}. ${s.name.padEnd(22)} ${s.pos.padEnd(5)} ${s.team.padEnd(3)} value $${s.value}${mkt}${surplus}`)
  }
  console.log(`\nTop pick: ${suggestions[0]!.name} - nominate them.\n`)
}

function cmdAdd(session: Session, args: string[]): void {
  if (args.length < 2) {
    console.log('Usage: add <player name> <price> [position]')
    console.log('Example: add "Bijan Robinson" 48 RB')
    return
  }

  const price = Number(args[args.length - 1])
  if (!Number.isFinite(price) || price < 1) {
    const maybePrice = Number(args[args.length - 2])
    if (Number.isFinite(maybePrice) && maybePrice >= 1) {
      const pos = args[args.length - 1]!
      const name = args.slice(0, -2).join(' ')
      const row = lookup(session.values, name)
      const resolvedPos = row?.pos ?? normalizePos(pos)
      session.myRoster.push({ name, price: maybePrice, pos: resolvedPos })
      session.pickedKeys.add(normalizeName(name))
      const rem = remainingBudget(session)
      console.log(`Added: ${name} (${resolvedPos ?? '?'}) - $${maybePrice}. Budget left: $${rem}, ${remainingSlots(session)} slots.\n`)
      return
    }
    console.log(`Invalid price: "${args[args.length - 1]}"`)
    return
  }

  const name = args.slice(0, -1).join(' ')
  const row = lookup(session.values, name)
  const pos = row?.pos ?? null
  if (!pos) {
    console.log(`Warning: "${name}" not found in value index. Add a position hint: add "${name}" ${price} QB`)
    console.log('Player added without position - position caps will not apply.\n')
  }
  session.myRoster.push({ name, price, pos })
  session.pickedKeys.add(normalizeName(name))
  const rem = remainingBudget(session)
  console.log(`Added: ${name}${pos ? ` (${pos})` : ''} - $${price}. Budget left: $${rem}, ${remainingSlots(session)} slots.\n`)
}

function cmdPicked(session: Session, args: string[]): void {
  const name = args.join(' ')
  if (!name) {
    console.log('Usage: picked <player name>')
    console.log('Example: picked "CeeDee Lamb"')
    return
  }
  const key = normalizeName(name)
  session.pickedKeys.add(key)
  const keeperTag = keeperLabel(session, name)
  const note = keeperTag ? ` [keeper: ${keeperTag}]` : ''
  console.log(`Marked off the board: "${name}" (${session.pickedKeys.size} players tracked).${note}\n`)
}

function cmdKeepers(session: Session, args: string[]): void {
  const ownerFilter = args.join(' ').trim().toLowerCase()
  const rows = ownerFilter
    ? session.keepers.filter((k) => k.owner.toLowerCase() === ownerFilter)
    : session.keepers

  if (rows.length === 0) {
    console.log(`No keepers found for owner "${args.join(' ')}".`)
    return
  }

  const totalSpend = rows.reduce((s, k) => s + k.price, 0)
  console.log(`\nLoaded keepers (${rows.length} players, $${totalSpend} total):`)
  for (const k of rows) {
    const pos = normalizePos(k.pos) ?? '?'
    console.log(`  ${k.owner.padEnd(14)} ${k.name.padEnd(24)} ${pos.padEnd(5)} $${k.price}`)
  }
  console.log()
}

function cmdUndo(session: Session): void {
  const last = session.myRoster.pop()
  if (last) {
    console.log(`Removed: ${last.name} (${last.pos ?? '?'}) - $${last.price}. Budget left: $${remainingBudget(session)}.\n`)
  } else {
    console.log('Nothing to undo - roster is empty.\n')
  }
}

export async function runAssist(cfg: BotConfig, values: ValueIndex): Promise<void> {
  const session = buildInitialSession(cfg, values)
  const me = keeperOwnerHint()
  const myKeepers = session.keepers.filter((k) => ownerMatches(k.owner, me))

  banner('Fanspot Draft Assistant - manual mode')
  console.log(
    `Model: ${values.rows.length} players priced (${values.source}), $${cfg.budget} budget, ` +
      `${cfg.teams} teams, ${cfg.rosterSize}-man, ${cfg.scoringFormat}. Auto-bid cap: $${cfg.autoBidCap}.\n`,
  )
  console.log(
    `Preloaded ${session.keepers.length} keepers as unavailable. ` +
      `Owner hint: "${me}" -> ${myKeepers.length} keeper(s) seeded into your roster.\n`,
  )
  console.log('Type "help" for commands, or start with "bid <player> <current bid>".\n')

  const rl = readline.createInterface({ input, output, prompt: '> ' })

  rl.prompt()

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) {
      rl.prompt()
      continue
    }

    const parts = trimmed.split(/\s+/)

    const cmd = parts[0]?.toLowerCase() ?? ''
    const args = parts.slice(1)

    switch (cmd) {
      case 'b':
      case 'bid':
        cmdBid(session, args)
        break
      case 'n':
      case 'nominate':
      case 'nom':
        cmdNominate(session)
        break
      case 'a':
      case 'add':
        cmdAdd(session, args)
        break
      case 'p':
      case 'picked':
        cmdPicked(session, args)
        break
      case 'keepers':
      case 'k':
        cmdKeepers(session, args)
        break
      case 'undo':
        cmdUndo(session)
        break
      case 's':
      case 'status':
        cmdStatus(session)
        break
      case 'players':
      case 'search':
        cmdPlayers(session, args)
        break
      case 'h':
      case 'help':
        cmdHelp()
        break
      case 'q':
      case 'quit':
      case 'exit':
        console.log('\nGood luck in the draft!\n')
        rl.close()
        return
      default:
        console.log(`Unknown command: "${cmd}". Type "help" for available commands.\n`)
    }

    rl.prompt()
  }
}
