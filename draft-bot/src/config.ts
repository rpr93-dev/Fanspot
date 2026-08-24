import type { ScoringFormat } from '@/lib/fantasy-types'
import type { AuctionSettings, StarterSlots } from '@/lib/fantasy/auction-engine'
import type { ValueSource } from './engine/types'

export interface BotConfig {
  leagueId: string
  season: number
  budget: number
  teams: number
  rosterSize: number
  scoringFormat: ScoringFormat
  starters: StarterSlots
  /** Which pricing source drives bid amounts. */
  valueSource: ValueSource
  autoBidCap: number
  maxShareOfBudget: number
  autoNominate: boolean
  pollMs: number
  headless: boolean
  userDataDir: string
  pingUrl: string | null
  dryRun: boolean
  myTeamName: string | null
  draftUrl: string
}

const VALID_SCORING = new Set<string>(['ppr', 'half-ppr', 'standard'])
const VALID_SOURCES = new Set<string>(['fanspot', 'fantasypros', 'blend'])

function envStr(key: string, fallback = ''): string {
  const v = process.env[key]
  return v == null || v.trim() === '' ? fallback : v.trim()
}

function envNum(key: string, fallback: number): number {
  const v = Number(envStr(key, String(fallback)))
  return Number.isFinite(v) ? v : fallback
}

function envBool(key: string, fallback: boolean): boolean {
  const v = envStr(key)
  if (v === '') return fallback
  return v === 'true' || v === '1' || v === 'yes'
}

/** Parse "QB:1,RB:2,WR:3,TE:1,FLEX:1,K:1,D/ST:1" into a StarterSlots. */
function parseStarters(raw: string): StarterSlots {
  const out: StarterSlots = { QB: 1, RB: 2, WR: 3, TE: 1, K: 1, 'D/ST': 1, FLEX: 1 }
  for (const part of raw.split(',')) {
    const [key, val] = part.split(':')
    const n = Number(val)
    if (!key || !Number.isFinite(n) || n < 0) continue
    const k = key.trim().toUpperCase() as keyof StarterSlots
    if (k in out) out[k] = Math.round(n)
  }
  return out
}

/** League id is only required for the browser commands (bot/inspect). */
export function configFromEnv(opts: { requireLeague?: boolean } = {}): BotConfig {
  const leagueId = envStr('YAHOO_LEAGUE_ID')
  if (!leagueId && opts.requireLeague !== false) {
    throw new Error(
      'YAHOO_LEAGUE_ID is required. Copy draft-bot/.env.example to draft-bot/.env and set it.',
    )
  }

  const scoring = envStr('SCORING', 'ppr')
  if (!VALID_SCORING.has(scoring)) {
    throw new Error(`SCORING must be one of: ppr, half-ppr, standard (got "${scoring}")`)
  }

  const valueSource = envStr('VALUE_SOURCE', 'fantasypros')
  if (!VALID_SOURCES.has(valueSource)) {
    throw new Error(`VALUE_SOURCE must be one of: fanspot, fantasypros, blend (got "${valueSource}")`)
  }

  const season = envNum('SEASON', new Date().getFullYear())
  const budget = envNum('BUDGET', 200)
  const teams = envNum('TEAMS', 12)
  const rosterSize = envNum('ROSTER_SIZE', 16)
  const pollMs = Math.max(500, envNum('POLL_MS', 1500))

  return {
    leagueId,
    season,
    budget,
    teams,
    rosterSize,
    scoringFormat: scoring as ScoringFormat,
    valueSource: valueSource as ValueSource,
    starters: parseStarters(envStr('STARTERS', 'QB:1,RB:2,WR:3,TE:1,FLEX:1,K:1,D/ST:1')),
    autoBidCap: envNum('AUTO_BID_CAP', 15),
    maxShareOfBudget: Math.min(1, Math.max(0.05, envNum('MAX_SHARE_OF_BUDGET', 0.4))),
    autoNominate: envBool('AUTO_NOMINATE', false),
    pollMs,
    headless: envBool('HEADLESS', false),
    userDataDir: envStr('USER_DATA_DIR', './profile'),
    pingUrl: envStr('PING_URL') || null,
    dryRun: envBool('DRY_RUN', false),
    myTeamName: envStr('YAHOO_TEAM_NAME') || null,
    draftUrl: `https://football.fantasysports.yahoo.com/f1/${leagueId}/draftclient`,
  }
}

export function auctionSettings(cfg: BotConfig): AuctionSettings {
  return {
    budget: cfg.budget,
    teams: cfg.teams,
    rosterSize: cfg.rosterSize,
    scoringFormat: cfg.scoringFormat,
  }
}
