"""STAGE 4 — Combine everything into a projection.

    baseline   = recency-weighted mean of the player's last N game values
    projection = baseline × (opponent_factor)^w_opp × (game_script_factor)^w_gs

Weights (tunable, defaults shown in :class:`ModelWeights`):
    halflife  = 4 games  — a game is half as important 4 games later
    w_opp     = 1.0      — 1 = full opponent adjustment, 0 = ignore
    w_gs      = 1.0      — 1 = full game-script adjustment, 0 = ignore

Statistical assumptions (plain language)
----------------------------------------
- *Recent form matters more*: game values are weighted by an exponential decay
  over games-ago (not days, so byes don't distort the decay). A halflife of 4
  games means last week counts ~2× a game from a month ago.
- *Multiplicative adjustments*: a defense allowing 20% more yards should add
  ~20% to the line, and a shootout total scales volume on top of that. The
  weight exponents let you soften a factor toward 1.0 (no effect) when you
  don't trust that input, rather than deleting the term.
- *Confidence interval*:
    - continuous stats (yards, receptions): game values are treated as roughly
      normal; the ~68% range is baseline ± recency-weighted std.
    - count stats (TDs): small integer counts are better described by a Poisson
      (std ≈ √mean); we use that when the mean is small, falling back to the
      sample std when it isn't.
  The range is the spread of *outcomes*, not the standard error of the mean —
  useful for spotting whether a market line sits outside it.

Confidence labels: high / medium / low, from history size, opponent sample
size, game-script availability, and data freshness.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .data_pipeline import PlayerHistory
from .stats import StatSpec

# 68% interval for the normal assumption.
Z_68 = 1.0


@dataclass(frozen=True)
class ModelWeights:
    halflife: float = 4.0      # games; recent games weighted 2× at this distance
    opponent: float = 1.0      # exponent on the opponent factor (0 = ignore)
    game_script: float = 1.0   # exponent on the game-script factor (0 = ignore)
    min_games: int = 3         # refuse to project below this


@dataclass
class Projection:
    player_name: str
    stat: StatSpec
    projection: float | None   # None = refused (bad history)
    baseline: float | None
    low: float | None
    high: float | None
    confidence: str
    n_games: int
    opponent_factor: float | None
    script_factor: float | None
    refused_reason: str | None = None

    def to_dict(self) -> dict:
        return {
            "player": self.player_name,
            "stat": self.stat.key,
            "stat_label": self.stat.label,
            "unit": self.stat.unit,
            "projection": None if self.projection is None else round(self.projection, 1),
            "baseline": None if self.baseline is None else round(self.baseline, 1),
            "low": None if self.low is None else round(self.low, 1),
            "high": None if self.high is None else round(self.high, 1),
            "confidence": self.confidence,
            "n_games": self.n_games,
            "opponent_factor": self.opponent_factor,
            "script_factor": self.script_factor,
            "refused_reason": self.refused_reason,
        }


def recency_weights(n: int, halflife: float = 4.0) -> np.ndarray:
    """Exponential decay weights over games-ago (0 = most recent game)."""
    if n <= 1:
        return np.ones(n)
    age = np.arange(n - 1, -1, -1, dtype=float)  # most recent = 0
    w = 0.5 ** (age / halflife)
    return w / w.sum()


def recency_weighted_stats(values: list[float] | np.ndarray, halflife: float = 4.0):
    """Recency-weighted mean and (unbiased) weighted std of game values."""
    x = np.asarray(values, dtype=float)
    w = recency_weights(len(x), halflife)
    mean = float(np.average(x, weights=w))
    # Unbiased weighted variance: divide by (1 - Σw²) so a small sample isn't
    # under-stated. Degenerate case (single game) → std 0.
    var = float(np.average((x - mean) ** 2, weights=w))
    denom = 1.0 - float(np.sum(w**2))
    if denom > 0 and len(x) > 1:
        var = var / denom
    return mean, math.sqrt(max(0.0, var))


def _confidence(
    n_games: int,
    history_ok: bool,
    opp_ok: bool,
    script_ok: bool,
    stale: bool,
    min_games: int,
) -> str:
    """Rule-based confidence: high / medium / low."""
    if not history_ok or n_games < min_games:
        return "low"
    if n_games >= 8 and opp_ok and script_ok and not stale:
        return "high"
    if n_games >= 5 and opp_ok and not stale:
        return "medium"
    return "low"


def _factor_value(f: dict | float) -> tuple[float, bool]:
    """Normalize a factor input → (value, reliable)."""
    if isinstance(f, dict):
        value = float(f.get("factor", 1.0))
        if "available" in f:
            reliable = bool(f["available"])
        else:
            reliable = not bool(f.get("low_sample", True))
        return value, reliable
    return float(f), True


def project(
    history: PlayerHistory,
    opponent_factor: dict | float,
    script_factor: dict | float,
    weights: ModelWeights | None = None,
) -> Projection:
    """Project the next game value for ``history``'s player+stat.

    ``opponent_factor`` is the STAGE 2 output (``{"factor", ...}``) or a float;
    ``script_factor`` is the STAGE 3 output (``{"factor", ...}``) or a float.
    """
    weights = weights or ModelWeights()
    opp_f, opp_ok = _factor_value(opponent_factor)
    gs_f, gs_ok = _factor_value(script_factor)

    n = history.n_games
    if not history.ok or n < weights.min_games or history.games.empty:
        return Projection(
            player_name=history.player_name, stat=history.stat,
            projection=None, baseline=None, low=None, high=None,
            confidence="low", n_games=n,
            opponent_factor=round(opp_f, 3), script_factor=round(gs_f, 3),
            refused_reason=_refusal_reason(history, weights.min_games),
        )

    stale = any(f.code == "STALE" for f in history.flags)
    mean, std = recency_weighted_stats(history.games["value"].tolist(), weights.halflife)
    baseline = mean

    if history.stat.kind == "count":
        # Poisson assumption for small integer counts: std ≈ √mean.
        eff_std = math.sqrt(max(mean, 0.0)) if mean < 5 else std
    else:
        eff_std = std

    projection = baseline * (opp_f**weights.opponent) * (gs_f**weights.game_script)

    return Projection(
        player_name=history.player_name,
        stat=history.stat,
        projection=projection,
        baseline=baseline,
        low=max(0.0, projection - Z_68 * eff_std),
        high=projection + Z_68 * eff_std,
        confidence=_confidence(n, history.ok, opp_ok, gs_ok, stale, weights.min_games),
        n_games=n,
        opponent_factor=round(opp_f, 3),
        script_factor=round(gs_f, 3),
    )


def _refusal_reason(history: PlayerHistory, min_games: int) -> str:
    for f in history.flags:
        if f.severity == "error":
            return f"{f.code}: {f.message}"
    return f"fewer than {min_games} games"
