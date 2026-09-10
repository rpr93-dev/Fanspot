# Fanspot Prop Engine — Technical Brief

*Written 2026-09-08 for external review (accuracy/reliability improvements wanted before tomorrow's games). Covers the Python projection model, the sportsbook-line scraper, the Next.js serving layer, and the over/under edge display.*

---

## 1. What it is

An NFL player-prop projection system. Given (player, stat, team, opponent, game date), it outputs a point projection, an uncertainty distribution (p10–p90), confidence/reliability scores, and — new this week — an **OVER/UNDER pick** against the live sportsbook line with a win probability.

Three cooperating pieces:

| Piece | Location | Role |
|---|---|---|
| Projection model (Python) | `prop-model/propmodel/` | Historical stats → projection + distribution |
| Line scraper (Python, Docker) | `scraper/scraper_api.py` | Sportsbook prop lines (Action Network + Odds API) |
| Web layer (Next.js, PM2 prod) | `src/app/api/prop-model/route.ts`, `src/lib/propModel.ts`, `src/app/[sport]/[team]/NextGamePanel.tsx` | Runs the model per page view, scrapes lines, renders model-vs-line table with edge badges |

---

## 2. Data sources

1. **nflverse weekly player stats** (primary history). One row per player-week: `player_id`, `player_name`, `player_display_name`, `position`, `recent_team`, `opponent_team`, `season/week/gameday`, `games` (1 = played), plus stat columns (`passing_yards`, `rushing_yards`, `receiving_yards`, `receptions`, `passing_tds`, `rushing_tds`, `receiving_tds`). Fetched via `nfl_data_py`, with automatic fallback to direct nflverse parquet download on Python ≥3.13. Cached on disk (`prop-model/cache/*.pkl`, 24h TTL, atomic writes).
2. **ESPN fantasy season projections** (via the app's unified player DB). Used two ways: (a) as a *prior* blended in when NFL history is thin (rookies, <2× min_games), and (b) as a per-game "ESPN line" shown for context. Crude derivation: season total / 17 × Vegas multiplier, filtered to values > 0. Known-flaky (e.g. it once produced 113.4 pass yds for a starting QB — the model flags these via `model_vs_espn_large_disagreement`).
3. **Vegas lines** (total + spread + favorite per game, from the app's odds feed). Feed the game-script adjustment.
4. **Sportsbook prop lines** (the comparison target). Scraped per game from Action Network (Playwright) across ~10 books (DK, FanDuel, Caesars, BetMGM, bet365, …) plus a "Consensus" aggregate, with The Odds API as an optional second source (currently unkeyed/disabled). Stored in-memory keyed by game date.

### Stats modeled (5 keys)

`passing_yards`, `rushing_yards`, `receiving_yards`, `receptions`, `tds` — where `tds` = total TDs = `passing_tds + rushing_tds + receiving_tds` (columns summed; missing columns treated as 0). Continuous stats get normal treatment, `tds` gets count/Poisson-ish treatment (`kind="count"`).

### Markets modeled per position

- QB: `passing_yards`, `tds`
- RB: `rushing_yards`, `receptions`, `tds`
- WR/TE: `receiving_yards`, `receptions`, `tds`

Only confirmed starters are modeled (filtered against fantasy depth-chart starter sets).

---

## 3. Projection pipeline (Python, `propmodel/`)

**STAGE 0 — Batch CLI** (`cli.py`). Input: JSON list of `{player, stat, team, opponent, prior?}` (max 40 per request), plus `--as-of DATE` (strictly-prior data only: internally subtracts one day; fetch cutoffs are inclusive last-usable gameday), `--lines-json` (Vegas), `--weights-json` (knob overrides), `--data-source`, `--cache-dir`. Output: one JSON object per target with projection, distribution, diagnostics.

**STAGE 1 — History** (`data_pipeline.py`). Last N *played* games (`games >= 1`); inactive weeks are kept as reported gaps, never silently dropped. Refuses with `INSUFFICIENT_HISTORY` below `min_games` (default 3). Emits flags: `STALE` (sample spans too many days), absence notes.

**STAGE 2 — Opponent adjustment** (`opponent.py`). For the upcoming opponent, sums the stat allowed to opposing players at the stat's positions over the last 8 team-games, ratio vs league average over the same window. Empirical-Bayes shrinkage toward 1.0 with weight `games/(games + shrink_games)`, `shrink_games` default 6.0 (walk-forward preferred heavy shrinkage). Zero-game window → exactly 1.0 + `low_sample` flag. Strict `as_of` filtering (no leakage from already-played games).

**STAGE 3 — Game script** (`game_script.py`). Vegas total/spread → `implied_team_total = (total ± spread)/2` → `script_factor = implied / 22.0` (league-average team total), clamped to [0.75, 1.25], then scaled per stat (`passing_yards` 1.0, `rushing_yards` 0.6, `receptions` 0.8, `tds` 0.7, …). Neutral 1.0 when no line.

**STAGE 4 — Projection** (`model.py::project`), in order:
1. **Winsorize** game values (MAD-based cap) so one monster game can't dominate.
2. **Recency-weighted mean** (exponential decay, `halflife` default 4.0 games; separate `halflife_count` for TDs) + effective sample size (ESS).
3. **Opportunity decomposition** (when targets/carries/attempts available in ≥50% of games, ≥3 valid): models volume and efficiency separately — efficiency gets ~2× shrinkage because one 80-yard TD shouldn't double a projection. Blended with the raw mean, capped per stat (`receiving_yards`/`receptions` 0.60, `rushing_yards` 0.45, `passing_yards` 0.30), weight scaled by ESS.
4. **Empirical-Bayes shrinkage** toward the position prior: `k = ess/(ess + prior_strength)`, `prior_strength` default 0.5 (0.0 for counts).
5. **Multiply** by opponent factor × game-script factor (each with its own count-variant weight).
6. **Role-change detection** (diagnostic + applied factor): compares recent-half vs older-half means, preferring opportunity columns (targets/carries/attempts) over raw yards. Fires a `role_change_detected: {col} changed ±X% (recent A vs older B)` warning when |change| > 20%; applies `role_factor = 1 + 0.5×pct_change` clamped to [0.70, 1.30]. Shown in UI as `role ±x%`.
7. **Recent-form signal** (diagnostic only): last-3 vs rest; surfaced as `recent_form_factor`, not applied.
8. **ESPN prior blend** when history is thin (n < 2× min_games): blends toward the ESPN per-game line; also emits `model_vs_espn_large_disagreement` warning when model and ESPN differ by >~30%.
9. **Refusals**: < min_games history, failed history fetch, or position/stat mismatch (e.g. receptions for a QB) → `projection: null` + `refused_reason`. UI shows "refused".
10. **Distribution** (`build_distribution`): Monte-Carlo around the projection with calibrated sd (`sd_mult_continuous = 1.01`, `sd_mult_count = 0.63` — fitted on 2024+2025 walk-forwards; refit via `backtest.py` quantile method if the interval formula changes). Uses historical residuals when ≥5 exist. Outputs p10/p25/p50(p50)/p75/p90, mean, `pred_sd`. Observed coverage ≈ 0.71 continuous / 0.72 count.
11. **Confidence**: label (low/medium/high) + 0–1 score from sample size + ESPN coverage; **reliability 0–100** composite = games bucket (≤25) + history_ok (20) + role stability (15) + opponent ok (15) + freshness (10) + ESPN coverage (10) + ESS bucket (15). Thin-data, disagreement, and stale-sample cases get score penalties (×0.85/×0.9, caps).

**STAGE 5 — Infra** (`reliability.py`): retry with exponential backoff + jitter for fetches; `DiskCache` (pickle for frames, JSON otherwise); idempotent logging.

**Edge computation** (`model.py::compute_edge`, also mirrored in TS for the UI): given projection mean μ, `pred_sd` σ, and book line L: `P(over) = 1 − Φ((L−μ)/σ)` (A&S normal-CDF approximation), `edge = μ − L`, z = edge/σ. Pick `over`/`under` when |z| ≥ 0.3 else `fair`. `strong` when |z| ≥ 0.5 and P(over) ≥ 0.65 (over) or ≤ 0.35 (under). Note: normal approximation on a count stat (TDs) — known coarseness.

### Tunable knobs (`ModelWeights` defaults)

`halflife=4.0`, `min_games=3`, `prior_strength=0.5` (`prior_strength_count=0.0`), `opp_shrink=6.0`, `opponent=1.0` (opponent-factor weight), `game_script` weight, `sd_mult_continuous=1.01`, `sd_mult_count=0.63`, separate `*_count` variants, `winsor_mad_mult`. Tuned by grid search in `train.py` (halflife × prior_strength × opp_shrink × opponent weight), scored by walk-forward MAE in `backtest.py`. Regression gate: `tests/test_walkforward_acceptance.py` requires model MAE ≤ plain-mean-8 baseline on cached real data (needs populated `prop-model/cache`, git-ignored, so it skips in CI). 137 pytest tests, all green.

---

## 4. Serving layer (Next.js)

- `POST /api/prop-model` (`src/app/api/prop-model/route.ts`): validates targets (1–40), shells out to the venv CLI via temp files (`--input/--output/--cache-dir/--data-source/--weights-json/--as-of/--lines-json`), maps CLI rows to UI `ModelProjection` rows, normalizes the historically string-encoded `warnings` field. Cold start (empty cache → multi-MB download) returns 503 + `warmingUp` with friendly retry text; a boot-time warm-up (`lib/propModel.ts::warmPropModel`) pre-fetches. Route-level in-memory caches live per server process.
- Gotcha (documented): a git-ignored `prop-model/.venv` inside the repo breaks Turbopack builds (symlink tracing) — move it aside for `npm run build`, restore after. Also: a stale prod server holding the port makes a new one die silently on EADDRINUSE — check `ss -tlnp` first.
- UI (`NextGamePanel.tsx`): builds one target per (starter, modeled market), passes ESPN line as `prior`, runs the model, renders the model table (Model | Prop line | **Edge** | Distribution | Conf) plus ESPN projected-lines tables per position group.

### Scraped-line matching (`scrapedLineFor`) — current rules

1. **Exact stat match only**, with a QB exception: model `tds` → scraper `passing_tds` for QBs; non-QB `tds` → no match (books post no O/U total-TD line for RB/WR/TE; anytime/first/last TD are odds-only placeholders at line 0.0).
2. **Real O/U only**: line must be a number > 0 **and** carry both over and under odds. This excludes alternates (`25+ Rushing Yards`), milestones (`2+ Passing Touchdowns`), combo markets (`Pass + Rush Yds`), leader markets (`…Most…`), and odds-only TD markets.
3. **Token-based name matching** (suffixes Jr/Sr/III stripped): every token of one name must appear in the other — rejects `Bijan Robinson` vs `Brian Robinson`, accepts `Michael Pittman` vs `Michael Pittman Jr`, plus a single-token abbreviation fallback (`T.Tagovailoa` → `tagovailoa`).
4. Prefer **Consensus**, else median across books.
5. Bugs fixed this week: fuzzy TD matching pulled milestone lines (showed "2 TDs"); median-over-mixed-markets picked alternates (150 instead of 208 pass yds); last-name-only matching mixed up the Robinsons.

### Edge display rules (current)

- Badge (OVER % / UNDER % / FAIR %) **only when a real scraped sportsbook line exists**; otherwise `—` in both Prop-line and Edge columns (deliberate: no invented comparisons).
- Percentage = pick-direction probability, rounded; FAIR shows the majority side.
- Tooltip names the book, both sides' odds, book count, edge in units.
- `—` also when projection refused or `pred_sd` missing.

---

## 5. Known weaknesses / what to probe

1. **Normal approximation for TDs** (count stat, often μ < 1). P(over) vs 0.5/1.5 lines from a symmetric normal is coarse; a Poisson/NB treatment would be more honest.
2. **ESPN prior quality**. The keyless fallback (`season_total/17 × Vegas multiplier`) is crude and occasionally garbage (113.4 pass yds for a starter). It feeds both thin-history blending and the disagreement warning — a bad ESPN number can drag a thin-history projection.
3. **Thin-data honesty**. Rookies (< min_games) refuse outright — good — but 3–5 game samples still project with wide intervals; check the ESS/confidence penalties are sufficient.
4. **Opponent window = 8 team-games**; early season means prior-season data bleed and heavy shrinkage — verify September behavior specifically (first game is tomorrow).
5. **No injury/inactive handling at projection time** beyond history gaps; a late scratch/Q-tag isn't modeled (no news feed input).
6. **No weather input** (wind/cold historically moves totals and passing props).
7. **Scraper fragility**: Action Network HTML scraping (Playwright) breaks on site changes; in-memory result store (dies with container); separate Docker service the web tier depends on with 120s timeouts.
8. **Calibration constants** (`1.01`/`0.63`, coverage ~0.71) were fitted on 2024+2025; a regime change (new season, rule tweaks) can silently decalibrate them.
9. **The `strong` thresholds** (|z| ≥ 0.5, P ≥ 0.65) are heuristic, not fitted to pick profitability — no ROI/backtest of the picks themselves exists.
10. **Vig awareness**: P(over) is compared against a symmetric 50% break-even; real -110 lines need ~52.4%. The 0.3-z `fair` band partially absorbs this but it's not explicit.

## 6. Goal for the reviewer

Suggest concrete, implementable improvements that make the engine **reliable for tomorrow's first game** — prioritize correctness/robustness fixes over feature work. For each suggestion: what to change (file/function), why it helps, and how to validate it (which test or walk-forward check would prove it).
