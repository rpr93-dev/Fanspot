# Overnight Mission Progress Log

## 2026-09-04 — Baseline (Step 1)

**Time**: Session start
**FreeToken**: alive (`qwen3.6-35b-a3b` at 127.0.0.1:1919)
**Tests**: 137 passed

### Baseline backtest (season 2025, current tree)

| stat | MAE | baseline_MAE | bias | cover68 |
|------|-----|--------------|------|---------|
| passing_yards | 63.3 | 64.6 | -0.4 | 0.636 |
| rushing_yards | 17.4 | 17.5 | -3.2 | 0.617 |
| receiving_yards | 13.8 | 14.0 | 0.7 | 0.724 |
| receptions | 1.1 | 1.1 | -0.0 | 0.740 |
| tds | 0.4 | 0.4 | 0.0 | 0.718 |

Pooled coverage: continuous 0.680 / count 0.718

**Key issues identified:**
1. Rushing bias −3.2 (systematic under-prediction)
2. Passing coverage 0.636 — under-covered vs target ~0.68
3. Thin samples (3-4 games): passing MAE 81.8, bias −17.3; rushing MAE 13.7

### Backtest command
```
cd prop-model && .venv/bin/python backtest.py
```

---

## 2026-09-04 — Knob Sweep (Step 2)

### Run: halflife sweep (2, 4, 6, 8) — baseline priors
