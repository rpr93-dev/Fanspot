import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
import { configFromEnv, auctionSettings } from './config'
import { buildValues, lookup } from './engine/values'
import { normalizeName } from './names'
import { selectorsFromEnv, bodyText, locatorFor } from './yahoo/selectors'
import { banner } from './notify'
import { runBot } from './controller'
import { loadEnv } from './env'

loadEnv()

const USAGE = `
Fanspot auction draft bot

Commands:
  bot      Run the draft bot (watches the Yahoo draft room, auto-bids, pauses for big bids)
  values   Build the player value index and spot-check name matching (no browser needed)
  inspect  Open the draft room and dump what the bot sees, for tuning selectors

Configuration lives in draft-bot/.env — see .env.example.
`

async function cmdValues(): Promise<void> {
  const cfg = configFromEnv({ requireLeague: false })
  banner(`Building player values for ${cfg.season} (${cfg.scoringFormat}, $${cfg.budget} budget, ${cfg.teams} teams)`)
  console.log(
    `Value source: ${cfg.valueSource}. This fetches Sleeper + ESPN + Vegas (and FantasyPros for fantasypros/blend) and can take a minute on first run.\n`,
  )

  const values = await buildValues(auctionSettings(cfg), cfg.starters, { season: cfg.season, source: cfg.valueSource })
  const a = values.assumptions
  console.log(
    `Priced ${values.rows.length} players (${values.injuryWatch.length} on injury watch) from ${values.source}. ` +
      `$${a.dollarsPerPoint}/FP over replacement, ${a.totalMoney} total money, ` +
      `${a.marketUnavailable ? 'no market reference (market column null)' : 'ESPN market rescaled'}.`,
  )

  console.log('\nTop 10 by value:')
  const byValue = [...values.rows].sort((x, y) => y.value - x.value).slice(0, 10)
  for (const r of byValue) {
    const market = values.byKey.get(normalizeName(r.name))?.market
    const m = market != null ? `, market $${market}` : ''
    console.log(`  ${r.name.padEnd(22)} ${r.pos.padEnd(4)} ${r.team.padEnd(3)} value $${r.value}${m}`)
  }

  console.log('\nName-matching spot checks:')
  for (const probe of ['Bijan Robinson', 'CeeDee Lamb', 'Patrick Mahomes', '49ers Defense', 'Chiefs D/ST', 'J.K. Dobbins', 'Amon-Ra St. Brown', 'Houston Texans D/ST']) {
    const row = lookup(values, probe)
    const fp = row?.fp ? `, ECR #${row.fp.ecr} (pos #${row.fp.posEcr}${row.fp.tier != null ? `, tier ${row.fp.tier}` : ''})` : ''
    console.log(
      `  "${probe}" -> ${row ? `${row.name} (${row.pos}/${row.team}) value $${row.value} [${row.source}${row.unavailable ? ', injury watch' : ''}]${fp}` : 'NOT FOUND'}`,
    )
  }
  console.log('\nIf a spot check comes back NOT FOUND, the bot will pass on that player during the draft.')
}

async function cmdInspect(): Promise<void> {
  const cfg = configFromEnv()
  const selectors = selectorsFromEnv()
  const context = await chromium.launchPersistentContext(cfg.userDataDir, {
    headless: cfg.headless,
    viewport: { width: 1440, height: 900 },
  })
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(cfg.draftUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 2000))

  const text = await bodyText(page)
  banner('DRAFT ROOM TEXT DUMP')
  console.log(text.slice(0, 12000))

  console.log('\n\nSelector probes:')
  for (const [key, candidates] of Object.entries(selectors)) {
    const loc = await locatorFor(page, candidates)
    const count = loc ? await loc.count() : 0
    console.log(`  ${key}: ${count > 0 ? `FOUND (${count})` : 'not found'}`)
  }

  writeFileSync('inspect-dump.txt', text)
  console.log('\nFull text saved to draft-bot/inspect-dump.txt — paste it to tune selectors.')
  await context.close()
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'bot'
  try {
    if (cmd === 'values') {
      await cmdValues()
    } else if (cmd === 'inspect') {
      await cmdInspect()
    } else if (cmd === 'bot') {
      const cfg = configFromEnv()
      const values = await buildValues(auctionSettings(cfg), cfg.starters, { season: cfg.season, source: cfg.valueSource })
      await runBot(cfg, values)
    } else {
      console.log(USAGE)
      process.exitCode = 1
    }
  } catch (err) {
    console.error(`[cli] ${cmd} failed:`, err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}

void main()
