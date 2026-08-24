# Fanspot Draft Bot

A Playwright bot that helps you run your **Yahoo Fantasy Football auction draft**, priced by **Fanspot's auction engine**. It watches the draft room, auto-bids cheap players, and pings you — and waits — whenever a decision crosses a threshold you set.

```
        ┌─────────────────────┐        ┌──────────────────────┐
        │  Yahoo draft room   │◄──────►│  Playwright (browser) │
        └─────────────────────┘        └──────────┬───────────┘
                                                  │ snapshot: nominated player,
        ┌─────────────────────┐                   │ current bid, my budget/roster
        │ Fanspot value index │◄──────────────────┘
        │ (Sleeper + ESPN +   │   decision: bid / pass / prompt
        │  Vegas → auction $) │
        └─────────────────────┘
```

## What it does

- **Builds a value index once, before the draft**: Fanspot's unified player database (Sleeper master list joined to ESPN projections/ADP/ownership, plus Vegas team environments) is run through the same auction engine the web app uses (`buildAuctionBoard`), producing a dollar value for every player in your league's specific setup (budget, teams, roster size, scoring, starter slots).
- **Watches the Yahoo draft room** (persistent browser profile, so you log in once) and reads the nominated player, current bid, your budget, and your picks.
- **Hybrid bidding**: 
  - Bids automatically, one clean increment at a time, up to `AUTO_BID_CAP`.
  - When the next bid would cross the cap, it **pings you** (terminal banner + beep + optional webhook) and waits: `[Enter]` to bid the recommended amount, a number for a custom bid, `p` to pass, `s` to skip. If you get outbid while deciding, it re-evaluates instead of firing a stale bid.
  - Injury-watch players (per Fanspot's injury gate) are **never auto-bid** — you always get the call, because a stale `QUESTIONABLE` tag on a Week 1 starter shouldn't cost you the player.
- **Nominations**: on your nomination turns it suggests 3 affordable, open-position players with the highest surplus (biggest expected discount), and either auto-nominates (`AUTO_NOMINATE=true`) or waits for your pick.
- **Discipline**: never spends more than `MAX_SHARE_OF_BUDGET` of what's left on one player, and always keeps the $1-per-slot reserve so you never strand an empty roster.

## Setup

```bash
cd Fanspot/draft-bot
npm install
npx playwright install chromium      # downloads the browser (~150 MB)
cp .env.example .env
```

Edit `.env`:

| Variable | Meaning |
|---|---|
| `YAHOO_LEAGUE_ID` | From your league URL: `football.fantasysports.yahoo.com/f1/123456/draftclient` → `123456` |
| `YAHOO_TEAM_NAME` | Your team name as shown in the draft room — lets the bot find your budget and roster |
| `BUDGET` / `TEAMS` / `ROSTER_SIZE` / `SCORING` / `STARTERS` | Your league's exact settings — these drive every price |
| `AUTO_BID_CAP` | Auto-bid up to this amount; above it, the bot pauses and asks (default `15`) |
| `HEADLESS` | Keep `false` so you can watch (and for the first login) |
| `PING_URL` | Optional webhook (ntfy.sh, Slack, ...) POSTed `{text}` when the bot pauses |
| `DRY_RUN` | `true` logs every decision without clicking — safe to test against a live room |

## Workflow

```bash
# 1. Sanity-check pricing + name matching (no browser needed)
npm run values
#    Look at the "Name-matching spot checks" — anything NOT FOUND
#    will be passed on during the draft.

# 2. One-time: log in and verify the bot can see the room
npm run inspect
#    Opens the draft room, dumps the rendered text + which selectors matched.
#    If the Bid/Pass/Nominate probes say "not found", the selector defaults
#    need tuning (see below) — paste draft-bot/inspect-dump.txt for help.

# 3. Run the bot. Start it in the draft lobby before the draft opens.
npm run bot
#    It enters the draft when it opens, then watches and acts.
#    Ctrl+C stops it; your draft state is never at risk (worst case it just
#    doesn't bid while stopped).
```

The browser keeps a persistent profile in `draft-bot/profile/`, so you only log in once.

## How bidding works

For the player on the block the bot looks up the model value (value-over-replacement in *your* league's money), then caps it:

```
maxBid = min(modelValue, floor(remainingBudget × MAX_SHARE_OF_BUDGET),
              remainingBudget − (remainingSlots − 1))
```

- `maxBid <= currentBid` → **pass** (already out of your range).
- Next increment ≤ `AUTO_BID_CAP` → **auto-bid**.
- Next increment > `AUTO_BID_CAP` → **pause, ping, wait**.
- Injury watch / suspended → **always pause, ping, wait** (you know more than the tag).

Players the auction board doesn't price (projection sits at replacement level — e.g. mid-round RBs, most kickers, below-average D/STs) get a fallback value from the same replacement levels and dollars-per-point rate, so you can still grab them for $1-2 when you need a roster spot filled.

## Tuning selectors

Yahoo's draft client has no public DOM contract, so every interaction goes through a selector table (`src/yahoo/selectors.ts`) and each entry can be overridden in `.env`:

```
SEL_BID_INPUT=...# bid amount input
SEL_BID_BUTTON=...# Bid button
SEL_PASS_BUTTON=...
SEL_NOMINATE_BUTTON=...
SEL_NOMINATE_CONFIRM=...
SEL_SEARCH_BOX=...
SEL_ENTER_DRAFT_BUTTON=...
SEL_NOMINATED_PLAYER=...
```

Candidate syntax: plain CSS, `role:button:Bid`, or `text:Nominate` (comma-separated, tried in order). Run `npm run inspect` after any change to verify the probes go green.

## Limitations & sharp edges

- **ESPN data completeness**: before ESPN publishes full season projections (usually late August), the board only prices the top ~100-200 players and star values can look compressed. Re-run `npm run values` a few days before your draft.
- **Name matching** is best-effort (normalized names + position hints + team aliases for D/ST). Yahoo nicknames like "AC Slater" won't match — the bot logs and passes on unmatchable players, so check `npm run values` first.
- **Draft-room parsing** relies on rendered text heuristics; an unexpected Yahoo UI change can blind parts of the snapshot (budget/roster). The bot degrades gracefully — derived budget from tracked picks, positions treated as open — but re-run `inspect` before draft day.
- **Timing**: Yahoo auction clocks are short. `POLL_MS` defaults to 1500ms; if you're missing turns, lower it (not below 500).

## Files

```
draft-bot/
├── src/
│   ├── cli.ts            # bot / inspect / values commands
│   ├── config.ts         # .env → typed config
│   ├── env.ts            # .env loader (Node native)
│   ├── names.ts          # name normalization + NFL team aliases
│   ├── notify.ts         # banner / beep / webhook
│   ├── controller.ts     # hybrid state machine (watch → decide → act/prompt)
│   ├── engine/
│   │   ├── values.ts     # unified DB → auction board → lookup index + fallback
│   │   └── strategy.ts   # pure bid/nomination decisions (unit-tested)
│   └── yahoo/
│       ├── selectors.ts  # selector table + locator DSL
│       ├── draft-state.ts# room text → DraftSnapshot
│       └── actions.ts    # bid / pass / nominate / enter-draft
└── src/__tests__/        # vitest: names + strategy
```
