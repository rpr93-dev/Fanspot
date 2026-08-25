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
 * No browser automation — you run the clicks yourself.
 *
 * Commands:
 *   bid <player> <current bid>  – should you bid, and how much?
 *   n                           – show nomination suggestions
 *   add <player> <price> [pos]  – track a player you won
 *   picked <player>             – mark a player as taken (by anyone)
 *   undo                        – remove the last player you added
 *   status                      – show your roster, budget, and position caps
 *   help                        – show this message
 *   quit                        – exit
 */

const AUCTION_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'] as const

interface RosterEntry {
  name: string
  price: number
  pos: string | null
}

interface Session {
  cfg: BotConfig
  values: ValueIndex
  myRoster: RosterEntry[]
  pickedKeys: Set<string>
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

function cmdHelp(): void {
  console.log(`
Commands:
  bid <player> <$current bid>   Ask whether to bid on a nominated player
  n                             Show the best players to nominate now
  add <player> <$price> [pos]   Track a player you won
  picked <player>               Mark a player as taken off the board
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
  console.log(`Picked off the board: ${session.pickedKeys.size} players`)

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
      const bar = '■'.repeat(count) + '□'.repeat(Math.max(0, cap - count))
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
    console.log(`Invalid bid amount: "${args[args.length - 1]}" — use a number, e.g. bid "Bijan Robinson" 35`)
    return
  }

  const name = args.slice(0, -1).join(' ')
  const row = lookup(session.values, name)

  if (!row) {
    console.log(`\n"${name}" — NOT FOUND in the value index.`)
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

  const market = row.market != null ? ` — market $${row.market}` : ''
  const source = `[${row.source}]`
  const flag = row.unavailable && row.unavailableReason ? ` ⚠ ${row.unavailableReason.toUpperCase()}` : ''

  console.log(`\n${row.name} (${row.pos}/${row.team}) — model value $${row.value}${market} ${source}${flag}`)

  switch (decision.action) {
    case 'pass':
      console.log(`Decision: PASS — ${decision.reason}\n`)
      break
    case 'auto-bid': {
      const next = Math.min(decision.amount, bid + bidIncrement(bid))
      console.log(`Decision: BID $${next} (auto — ${decision.note})\n`)
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
    const market = v.market != null ? ` — market $${v.market}` : ''
    const flag = v.unavailable ? ' ⚠' : ''
    console.log(`  ${v.name.padEnd(22)} ${v.pos.padEnd(5)} ${v.team.padEnd(3)} value $${v.value}${market} [${v.source}]${flag}`)
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
    console.log('\nNo affordable nomination suggestions — positions may be full or budget too tight.\n')
    return
  }

  console.log('\nBest players to nominate (highest surplus first):')
  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i]!
    const surplus = s.surplus != null ? ` (surplus +$${s.surplus})` : ''
    const market = session.values.byKey.get(normalizeName(s.name))?.market
    const mkt = market != null ? ` — market $${market}` : ''
    console.log(`  ${i + 1}. ${s.name.padEnd(22)} ${s.pos.padEnd(5)} ${s.team.padEnd(3)} value $${s.value}${mkt}${surplus}`)
  }
  console.log(`\nTop pick: ${suggestions[0]!.name} — nominate them.\n`)
}

function cmdAdd(session: Session, args: string[]): void {
  if (args.length < 2) {
    console.log('Usage: add <player name> <price> [position]')
    console.log('Example: add "Bijan Robinson" 48 RB')
    return
  }

  const price = Number(args[args.length - 1])
  if (!Number.isFinite(price) || price < 1) {
    // Price might not be last if position was given
    const maybePrice = Number(args[args.length - 2])
    if (Number.isFinite(maybePrice) && maybePrice >= 1) {
      // Position was given
      const pos = args[args.length - 1]!
      const name = args.slice(0, -2).join(' ')
      const row = lookup(session.values, name)
      const resolvedPos = row?.pos ?? pos.toUpperCase()
      session.myRoster.push({ name, price: maybePrice, pos: resolvedPos })
      const rem = remainingBudget(session)
      console.log(`Added: ${name} (${resolvedPos}) — $${maybePrice}. Budget left: $${rem}, ${remainingSlots(session)} slots.\n`)
      return
    }
    console.log(`Invalid price: "${args[args.length - 1]}"`)
    return
  }

  // No explicit position — try to resolve from the value index
  const name = args.slice(0, -1).join(' ')
  const row = lookup(session.values, name)
  const pos = row?.pos ?? null
  if (!pos) {
    console.log(`Warning: "${name}" not found in value index. Add a position hint: add "${name}" ${price} QB`)
    console.log('Player added without position — position caps will not apply.\n')
  }
  session.myRoster.push({ name, price, pos })
  const rem = remainingBudget(session)
  console.log(`Added: ${name}${pos ? ` (${pos})` : ''} — $${price}. Budget left: $${rem}, ${remainingSlots(session)} slots.\n`)
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
  console.log(`Marked off the board: "${name}" (${session.pickedKeys.size} players tracked).\n`)
}

function cmdUndo(session: Session): void {
  const last = session.myRoster.pop()
  if (last) {
    console.log(`Removed: ${last.name} (${last.pos ?? '?'}) — $${last.price}. Budget left: $${remainingBudget(session)}.\n`)
  } else {
    console.log('Nothing to undo — roster is empty.\n')
  }
}

export async function runAssist(cfg: BotConfig, values: ValueIndex): Promise<void> {
  const session: Session = {
    cfg,
    values,
    myRoster: [],
    pickedKeys: new Set(),
  }

  banner(`Fanspot Draft Assistant — manual mode`)
  console.log(
    `Model: ${values.rows.length} players priced (${values.source}), $${cfg.budget} budget, ` +
      `${cfg.teams} teams, ${cfg.rosterSize}-man, ${cfg.scoringFormat}. Auto-bid cap: $${cfg.autoBidCap}.\n`,
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

    // Split on whitespace, respecting the last token as a potential number for bid/add commands
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
        console.log('\nGood luck in the draft! 🏈\n')
        rl.close()
        return
      default:
        console.log(`Unknown command: "${cmd}". Type "help" for available commands.\n`)
    }

    rl.prompt()
  }
}