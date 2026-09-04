# Overnight mission: make Fanspot prop-model WAY more accurate

You are running on **FreeToken Qwen 3.6** (`freetoken/qwen3.6-35b-a3b`,
served at `http://127.0.0.1:1919/v1`, model `qwen3.6-35b-a3b`).
This is an unattended overnight session. Work autonomously, keep notes in
`PROGRESS.md` in this directory, and leave the tree in a runnable state.

## 0. Do not break these (hard rules)

- Working tree is DIRTY on purpose (uncommitted model.py overhaul + new
  `prop-model/tests/test_model_enhancements.py`). NEVER `git checkout`,
  `git stash`, or `git reset`. Build on top of current changes.
- Do NOT commit unless the user asks in the morning. Leave changes uncommitted.
- After every change: `cd prop-model && .venv/bin/python -m pytest tests/ -q`
  must stay green (currently 137 passed). Also keep
  `tests/test_walkforward_acceptance.py` logic green (it skips without cache;
  cache exists at `prop-model/cache/` — do not delete it).
- Python: always use `prop-model/.venv/bin/python`, never system python
  (system has no pandas; also needs `pyarrow`, `requests`).
- Never `pkill -f "next start ..."` (kills your own shell). Ports: check
  `ss -tlnp` first. Do not start prod servers on odd ports overnight.
- Keep the FreeToken backend alive: `curl -s http://127.0.0.1:1919/v1/models`
  at least every ~20 min (the idle proxy stops the backend after 30 min idle;
  it auto-wakes in ~20 s, so a wake-up curl before big pushes is enough).

## 1. Baseline (measured 2026-09-04, backtest season 2025, current tree)

| stat | MAE | baseline_MAE | bias | cover68 |
|------|-----|--------------|------|---------|
| passing_yards | 63.3 | 64.6 | -0.4 | 0.636 |
| rushing_yards | 17.4 | 17.5 | -3.2 | 0.617 |
| receiving_yards | 13.8 | 14.0 | 0.7 | 0.724 |
| receptions | 1.1 | 1.1 | -0.0 | 0.740 |
| tds | 0.4 | 0.4 | 0.0 | 0.718 |

Pooled coverage: continuous 0.680 / count 0.718. Thin samples (3–4 games)
are the worst (e.g. passing MAE 81.8, n=12). Model barely beats the plain
mean-8 baseline — THAT is the gap to close. Command: `.venv/bin/python
backtest.py` from `prop-model/`. Knob sweeps: `backtest.py --help`
(halflife, prior-strength, opp-shrink, opponent-w, sd-mult-*).

## 2. Your tools for outside data (use them — this is the "playwright" part)

- `chrome-devtools-axi` (in PATH): real browser automation. `open <url>`,
  `snapshot`, `eval <js>`, `screenshot`, `wait`. Use it to pull:
  sportsbook prop lines (compare model vs books to find bias),
  ESPN/FantasyPros/PFR team defense + injury + depth-chart + weather pages,
  dome/outdoor + bye info. Be polite: small number of pages, cache to
  `.overnight-prop-model/web/` as JSON/MD, never hammer a site.
- Repo already has `propmodel/espn_fetcher.py` (training-data path) and
  `propmodel/train.py` — read them before re-scraping ESPN.
- Web search/fetch tools if configured; else `curl` + browser.
- nflverse parquet direct fallback exists in `data_pipeline.py`
  (no `nfl_data_py` on py3.13). Live pulls cache to `prop-model/cache/*.pkl`
  (24 h TTL, git-ignored).

## 3. Work list (in order, stop when morning comes — log where you got)

1. Re-run `backtest.py` + full pytest to confirm the baseline above.
2. Knob sweep with the browser closed: halflife (2–8), prior_strength
   (0–8), opp_shrink (2–12), opponent_w (0–1.5), per-stat overrides if
   justified. Record every run in PROGRESS.md. Keep the walk-forward gate
   (`ModelWeights` knob guidance in `Fanspot/AGENTS.md`) green.
3. Bias hunt: rushing bias −3.2 needs a fix; passing coverage 0.636 is
   under-covered (widen continuous sd_mult or fix heavy tails). Refit
   `CALIBRATED_SD_MULT_*` via the quantile method if the interval changes.
4. Features (only with backtest proof each): home/away splits, dome/weather,
   bye-week rest, totals/spread game-script from REAL lines scraped via the
   browser (persist samples under `.overnight-prop-model/web/`), opponent
   weighting by recency, position-prior by season. One feature at a time,
   backtest before/after.
5. Thin-sample honesty: 3–4 game histories lie the most. Improve shrinkage
   or refusal thresholds ONLY if pooled MAE drops and coverage stays ~0.68.
6. Sportsbook comparison: scrape a small sample of real prop lines for the
   current week (2026 season, week 1: games Sep 10–14 2026) and report
   model-vs-book MAE in PROGRESS.md. Do not bet, do not place anything.
7. Update `prop-model/README.md` formula section + `Fanspot/AGENTS.md`
   backtest line if constants change.

## 4. Logging

- Append timestamped entries to `.overnight-prop-model/PROGRESS.md`:
  what you tried, backtest numbers, keep/revert decision.
- Auto-compaction is ON (64k window): your context will be summarized when
  full. After every sweep or feature, write results to PROGRESS.md FIRST —
  that file is what the summary (and any resumed session) grounds on.
  Never hold results only in chat.
- Save raw sweep tables to `.overnight-prop-model/sweeps/`.
- If the FreeToken backend feels slow/flaky, note it and keep going
  (it pages weights from RAM; long contexts are slow — keep prompts tight,
  prefer small files over whole-repo reads).

Goal for the morning: lower MAE vs the table in §1 on at least
passing/rushing/receiving, bias nearer 0, coverage glued to ~0.68, tests
green, PROGRESS.md telling the story. Have fun. Good night.
