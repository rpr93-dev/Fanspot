# Prop-model honest report (supersedes the 2026 season-backtest write-up)

*Compiled 2026-10-14/15 against the current tree. Every number here is
reproducible from the cached nflverse weekly frame with the commands at the
bottom; the development and forward splits are reported separately and never
pooled.*

This report replaces the earlier "Season Backtest — Prop Model" summary. That
summary's headline accuracies were computed on a forward-test harness whose
`--as-of` cutoff came from a **synthetic** gameday mapping
(`YYYY-09-08 + 7·(week-1)`), which for 2026 week 7 is `2026-10-20` — after the
date the snapshot was said to be locked. It also drew causal conclusions
("injured/exited", "legitimate edge") the data cannot support. Both classes of
defect are corrected below and guarded by code.

---

## 1. What changed (repair items 1, 3, 4, 5)

| Area | Change | Where |
|---|---|---|
| Role / workload | Timestamped pregame depth-chart + availability → expected opportunities; backup→starter projects at starter volume; returning starters keep pre-absence volume; missing/contradictory role is flagged and capped; `OUT` abstains | `propmodel/role.py`, `propmodel/model.py::project`, `propmodel/cli.py` |
| Market disagreement | A large model-vs-line gap raises `market_disagreement` — the projection is **never** moved toward the line | `model.py::project` |
| Coverage | Verified stable-ID aliases (Cameron/Cam Skattebo, Chigoziem/Chig Okonkwo); thin-history/rookie prior is wired in production and tagged (`inputs.prior_source`, reported separately); cross-position markets are supported when evaluable, else refused as `UNSUPPORTED_MARKET` | `players.py`, `cli.py`, `model.py::position_guard_reason` |
| Confidence | The high/medium/low label no longer gates pick strength (`compute_edge`) — it failed to separate accuracy | `model.py::compute_edge` |
| Evaluation | New harness comparing the model to the weighted-8 baseline on **identical rows**, per stat, with clustered uncertainty, component ablations, workload-grouped coverage and a freeze manifest | `eval_honest.py` |
| Forward test | Slate/week-label verification, future-cutoff refusal, immutable timestamped snapshots | `forward/forward_test.py` |

---

## 2. Method

- **Source:** cached nflverse weekly frame (`cache/*.pkl`), seasons 2023–2025
  (development) and 2026 weeks 1–5 (forward).
- **Rows:** sampled player-weeks; every candidate (full model, baseline, every
  ablation) is scored on the *same rows* — the comparison sample never changes.
- **Baseline:** the **weighted 8-game** mean (same recency halflife, no
  opponent, no script, no shrinkage, no role). The plain mean-8 is shown for
  reference.
- **Uncertainty:** two-way cluster bootstrap (resample players; resample
  game-weeks); the wider interval is reported. Positive Δ = the model has
  *larger* error than the baseline.
- **Reproduce:** see §8.

---

## 3. Development split (2023–2025, n = 2,855)

| stat | n | model MAE | w8 MAE | plain-8 MAE | ΔMAE vs w8 | ΔRMSE vs w8 | cov68 | width | 95% CI ΔMAE (player) |
|---|---|---|---|---|---|---|---|---|---|
| passing_yards | 565 | 73.57 | 74.03 | 73.71 | −0.47 | −0.26 | 0.609 | 162.6 | [−1.52, +0.68] |
| rushing_yards | 561 | 16.26 | 16.37 | 16.32 | −0.11 | **+0.33** | 0.701 | 41.7 | [−0.53, +0.29] |
| receiving_yards | 580 | 17.32 | 17.20 | 17.28 | +0.11 | +0.46 | 0.679 | 35.5 | [−0.22, +0.49] |
| receptions | 580 | 1.37 | 1.37 | 1.37 | +0.01 | +0.02 | 0.700 | 3.1 | [−0.02, +0.04] |
| tds | 569 | 0.38 | 0.38 | 0.38 | +0.00 | +0.00 | 0.689 | 0.6 | [−0.00, +0.00] |
| **pooled** | **2,855** | **21.63** | **21.72** | **21.72** | **−0.09** | **−0.02** | **0.676** | 48.3 | [−0.31, +0.18] |

**Read honestly:** the model's edge over the weighted-8 baseline is *within
noise* on every stat in the development split. Passing is the only stat whose
point estimate is both better and materially sized (−0.47 MAE); its CI still
crosses zero.

### Ablations (mean ΔMAE vs full; positive = the component helped)

| component off | pooled | passing | rushing | receiving |
|---|---|---|---|---|
| opponent adjustment | +0.00 | +0.00 | +0.05 | +0.18 |
| factor clamp | +0.00 | +0.00 | −0.00 | +0.00 |
| shrinkage **on** (prior=1.0) | −0.09 | −0.65 | −0.05 | +0.27 |

There is no measured evidence that the opponent adjustment, the combined-factor
clamp, or position-prior shrinkage improve pooled accuracy on this sample.
Passing is the one place shrinkage clearly hurts; it is left off by default.

### Workload-grouped coverage (dev)

| stat | low workload | mid | high |
|---|---|---|---|
| passing_yards | 0.604 | 0.601 | 0.622 |
| rushing_yards | 0.647 | 0.755 | 0.699 |
| receiving_yards | 0.722 | 0.636 | 0.682 |
| receptions | 0.823 | 0.665 | 0.602 |

Passing is under-covered in every workload group (~0.61 vs the 0.68 target);
receptions are over-covered at low workload (0.82) and under at high (0.60).
The model is **not** uniformly calibrated ("intervals are fine on average" was
too generous).

---

## 4. Forward split (2026 weeks 1–5, n = 92) — untouched

| stat | n | model MAE | w8 MAE | ΔMAE vs w8 | ΔRMSE vs w8 | cov68 | 95% CI ΔMAE (player) |
|---|---|---|---|---|---|---|---|
| passing_yards | 18 | 65.80 | 63.16 | +2.64 | +5.90 | 0.556 | [−5.08, +11.16] |
| rushing_yards | 14 | 24.57 | 23.36 | +1.22 | +1.93 | 0.714 | [−0.65, +3.04] |
| receiving_yards | 21 | 18.69 | 18.94 | −0.25 | −1.89 | 0.667 | [−2.55, +1.71] |
| receptions | 21 | 1.59 | 1.60 | −0.01 | −0.06 | 0.714 | [−0.14, +0.11] |
| tds | 18 | 0.53 | 0.52 | +0.01 | +0.00 | 0.667 | [−0.01, +0.02] |
| **pooled** | **92** | **21.34** | **20.70** | **+0.64** | **+0.70** | 0.663 | [−1.09, +2.40] |

**On the untouched forward sample the model does not beat the weighted-8
baseline** (pooled +0.64 MAE; the by-game cluster CI, [+0.55, +0.75], excludes
zero). The sample is small (n = 92), so this is a warning, not a verdict — but
it is reported, not hidden.

---

## 5. Role-change handling, using pregame information only

`demos/role_change_demo.py` rebuilds each case's pregame information set
(history strictly before the game; the depth-chart row effective before
kickoff) and projects it with and without the role feed:

| case | history games | history-only proj | role-aware proj | expected vol | actual att/yds |
|---|---|---|---|---|---|
| Bagent wk4 (promoted backup) | 8 | 23.1 | **244.1** | 31.0 | 34 / 268 |
| Huntley wk5 (promoted backup) | 8 | 110.9 | 110.9 | 31.0 | 32 / 201 |
| Dart wk2 (starter exited in-game) | 8 | 206.5 | 206.5 | 32.0 | 5 / 20 |

- **Bagent** is the flagship repair: history-only prices a mop-up backup at
  23 yards; naming him the starter from a pregame chart projects starter volume
  (31 attempts) → 244 yards, close to the realized 268.
- **Huntley's** career history already contains previous *starts*, so the
  relief-only trigger does not fire — a known limitation (a long-ago starter
  who is now a backup is not flagged by start-volume alone).
- **Dart** did not exit until in-game; no pregame feed can know that. This case
  is *not* "fixed" by role awareness and is listed so the claim isn't
  overstated. An `availability=out` pregame row would abstain.

Unit coverage: `tests/test_role.py`, `tests/test_coverage.py`,
`tests/test_forward.py`, `tests/test_eval_honest.py`.

---

## 6. Corrections to the previous report's conclusions

1. **"Benched / injured / exited QBs (19% of passing error)."** The repo data
   (`cache/*.pkl`) has no participation or game reports, so *injury* cannot be
   verified. What is verifiable is recorded usage: e.g. 2026 Tua wk5 = 3
   attempts, J.J. McCarthy wk5 = 0, Shedeur Sanders wk3 = 1, Dalton wk3 = 1,
   Dart wk2 = 5. **Reworded:** these are games with negligible recorded passing
   volume (exited or non-starter role); the cause is not established from this
   data. The model's error here is a *role/availability* miss, which the new
   pregame `OUT` gate now addresses only when availability is actually known.
2. **"Legitimate edge."** Replaced with **"unexplained market disagreement."**
   The model-vs-line gaps that the old summary called edges were dominated by
   role artifacts (Bagent-class). Until a disagreement is explained by an input
   the market lacks, the honest label is "unexplained". `market_disagreement`
   is emitted as a diagnostic and never adjusts the projection.
3. **"Rushing RMSE loses to the weighted baseline."** Acknowledged and now
   measured: development ΔRMSE **+0.33** (MAE −0.11); forward ΔRMSE **+1.93**
   and ΔMAE **+1.22**. The model trails the weighted-8 baseline on rushing by
   RMSE in both splits.
4. **Confidence labels.** Confirmed non-discriminative; the label no longer
   ranks picks (`compute_edge.strong` is edge-only now).
5. **Development vs forward.** Kept strictly separate (§3 vs §4); no pooled
   headline is quoted across them.

---

## 7. Limitations / what is NOT proven

- The forward sample is 5 weeks (n = 92) — too small for stat-level verdicts.
- No posted-sportsbook-lines file is available in-tree, so the
  "players with posted props" subset is reported as **unavailable** rather than
  silently dropped. Supply `--prop-lines` to populate it.
- The role layer needs a timestamped depth-chart/availability feed to act; with
  none, it flags uncertainty and behaves like history-only. The 2026 backtest
  did not have such a feed, so **the role change is validated by mechanism and
  the Bagent demonstration, not by a season-wide MAE delta.**
- Game-script is neutral throughout (no historical Vegas lines cached), so its
  ablation is uninformative here.
- Position-prior shrinkage, the opponent adjustment and the factor clamp have
  no demonstrated pooled benefit on this sample; they remain as guardrails only.

---

## 8. Reproduce

```bash
cd prop-model
.venv/bin/python -m pytest tests/ -q

# Honest evaluation, development and forward splits (writes JSON + manifest):
.venv/bin/python eval_honest.py --per-week-cap 12 --n-boot 500 --out eval_out
.venv/bin/python eval_honest.py --forward --per-week-cap 12 --n-boot 500 --out eval_out

# Role-change demonstration:
.venv/bin/python demos/role_change_demo.py

# Forward-test harness (slate verification + frozen snapshot):
.venv/bin/python forward/forward_test.py --season 2026 --week 5 --locked-at 2026-10-13 --allow-unverified
```
