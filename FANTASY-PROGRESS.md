# Fantasy Integration — Build Progress

**Branch:** `feat/fantasy-integration`  
**Started:** 2026-07-23  

---

## Status

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Pre-flight & Repo Hygiene | 🔲 Not started |
| 1 | Type System | 🔲 Not started |
| 2 | Sleeper Players Dump | 🔲 Not started |
| 3 | ESPN Fantasy Provider | 🔲 Not started |
| 4 | Steal Score Engine | 🔲 Not started |
| 5 | Cache Layer | 🔲 Not started |
| 6 | Frontend: Standalone Fantasy Route | 🔲 Not started |
| 7 | Edge Cases & Hardening | 🔲 Not started |
| 8 | Performance & Caching Polish | 🔲 Not started |
| 9 | Documentation | 🔲 Not started |
| 10 | Final Pre-Merge Gates | 🔲 Not started |

---

## Phase 0 — Pre-flight & Repo Hygiene

### 0.1 Confirm environment

- [x] Node version matches package.json (v24.18.0 — Next.js 16 needs ≥20)
- [x] `npm run lint` (no eslint config; Next.js 16 handles internally)
- [x] `npm run build` passes (baseline green)
- [x] `npm run test` passes (no test files yet — baseline is "no files found")
- [x] `git status` clean
- [x] Branch created: `feat/fantasy-integration`

### 0.2 Inventory provider pattern

- [x] Read `src/lib/providers/index.ts`
- [x] Read `src/lib/providers/espn.ts` end-to-end
- [x] Read `src/lib/sports-api.ts`
- [x] Read `src/data/teams.ts`

### 0.3 Create constants

- [x] Create `src/lib/providers/fantasy-constants.ts`

### ✅ Phase 0 gate

- [x] Lint + build still pass
- [x] Constants file imports cleanly
- [x] You can name from memory: orchestrator file, cache pattern, player join key

---

## Phase 1 — Type System

### 1.1 Create `src/lib/fantasy-types.ts`

- [ ] Define `FantasySport`, `EspnFantasyPlayer`, `EspnFantasyResponse`
- [ ] Define `SleeperPlayer`, `DraftType`, `ScoringFormat`
- [ ] Define `StealScore`, `FantasyPlayerEnriched`
- [ ] Define `proTeamIdMap`

### 1.2 Sanitize ESPN shapes

- [ ] `assertEspnShape()` helper

### ✅ Phase 1 gate

- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] Smoke test creates and compiles

---

## Phase 2 — Sleeper Players Dump

### 2.1 Provider scaffold

- [ ] Create `src/lib/providers/sleeper.ts`
- [ ] `sleeperPlayersCache` Map
- [ ] `getSleeperPlayers(sport)`
- [ ] `getSleeperByEspnId(sport, espnId)`

### 2.2 API route

- [ ] Create `src/app/api/fantasy/sleeper-players/[sport]/route.ts`

### ✅ Phase 2 gate

- [ ] `/api/fantasy/sleeper-players/nfl` returns 200 with count > 1500
- [ ] `/api/fantasy/sleeper-players/nba` returns count > 600
- [ ] `/api/fantasy/sleeper-players/mlb` returns count > 1800
- [ ] Cache hit timing < 50ms
- [ ] Invalid sport returns 400
- [ ] Lint + build pass
- [ ] Unit tests pass

---

## Phase 3 — ESPN Fantasy Provider

### 3.1 Core fetcher

- [ ] Create `src/lib/providers/fantasy.ts`
- [ ] `espnFantasyCache` Map
- [ ] `fetchEspnFantasySport(sport, season)`
- [ ] `normalizeEspnPlayer(raw, sport)`

### 3.2 Enrichment join

- [ ] `enrichWithSleeper(player, sport)`

### 3.3 API route

- [ ] Create `src/app/api/fantasy/players/[sport]/route.ts`

### ✅ Phase 3 gate

- [ ] `/api/fantasy/players/nfl?season=2025` returns 200 with count > 600
- [ ] Normalized positions and mapped team abbreviations
- [ ] Projection points populated
- [ ] Sleeper cross-reference > 60%
- [ ] Cache hit < 30ms
- [ ] Unit tests pass

---

## Phase 4 — Steal Score Engine

### 4.1 Core math

- [ ] Create `src/lib/fantasy/steal-engine.ts`
- [ ] `calcStealScore(player, config)` with draft type modifiers
- [ ] Snake, Auction, Dynasty, Best-Ball logic

### 4.2 Aggregation API

- [ ] Create `src/app/api/fantasy/steals/[sport]/route.ts`

### ✅ Phase 4 gate

- [ ] Snake steal scores positive direction verified
- [ ] Dynasty skews younger
- [ ] Auction uses valuePerDollar
- [ ] Different draft types reorder results
- [ ] Unit tests pass with deterministic fixtures

---

## Phase 5 — Cache Layer

### 5.1 Unified cache service

- [ ] Create `src/lib/cache/fantasy-cache.ts`
- [ ] `getStats()`, `invalidateSport(sport)`
- [ ] Refactor Phase 2+3 to use service

### 5.2 Cache warming

- [ ] Parallel fetch on cold start

### ✅ Phase 5 gate

- [ ] Cold start < 2s
- [ ] Warm cache < 30ms
- [ ] Graceful corruption fallback

---

## Phase 6 — Frontend UI

### 6.1 Route scaffold

- [ ] `src/app/fantasy/page.tsx`
- [ ] `src/app/fantasy/[sport]/page.tsx`

### 6.2 Header / controls

- [ ] Sport selector, Draft type, Scoring format
- [ ] Refresh button
- [ ] Loading / error / empty states

### 6.3 Steals table

- [ ] Table with all columns
- [ ] Steal score bar
- [ ] Expand to methodology
- [ ] Mobile responsive

### 6.4 Team dashboard integration

- [ ] Fantasy widget on team pages

### ✅ Phase 6 gate

- [ ] Page loads, controls work
- [ ] Draft types re-fetch data
- [ ] Mobile scrollable
- [ ] Team widget shows ≤3 players
- [ ] Error state handled
- [ ] Component tests pass

---

## Phase 7 — Edge Cases & Hardening

- [ ] Offseason empty state
- [ ] Injured/retired filtering
- [ ] Position mismatches (DST, K, two-way)
- [ ] Rate limiting & exponential backoff

### ✅ Phase 7 gate

- [ ] Downstream failure returns cached data
- [ ] Injured player UI red dot
- [ ] Burst calls use cache
- [ ] Backoff tests
- [ ] Offseason fallback tests

---

## Phase 8 — Performance & Caching Polish

- [ ] `?fields=minimal` mode
- [ ] Gzip/brotli headers
- [ ] Stale-while-revalidate verification
- [ ] Client-side memoization

### ✅ Phase 8 gate

- [ ] Compression headers confirmed
- [ ] Payload size reduction > 60%
- [ ] 60fps table scrolling

---

## Phase 9 — Documentation

- [ ] Update AGENTS.md
- [ ] Inline documentation in steal-engine.ts

### ✅ Phase 9 gate

- [ ] New contributor can follow docs
- [ ] Lint + build + test green

---

## Phase 10 — Final Pre-Merge Gates

- [ ] Full test suite passes
- [ ] Coverage threshold met (>70%)
- [ ] Build passes (no new warnings)
- [ ] Integration smoke test on all pages
- [ ] PR prep

### ✅ Final gate

- [ ] All three commands green
- [ ] User signs off
- [ ] PR not merged until approval
