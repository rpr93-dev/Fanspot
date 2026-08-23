"""STAGE 4 — Combine everything into a projection.

    baseline   = recency-weighted mean of the player's last N game values,
                 shrunk toward a position prior in proportion to sample noise
    projection = baseline × (opponent_factor)^w_opp × (game_script_factor)^w_gs

Weights (tunable, defaults shown in :class:`ModelWeights`):
    halflife        = 4 games — a game is half as important 4 games later
    w_opp           = 1.0     — 1 = full opponent adjustment, 0 = ignore
    w_gs            = 1.0     — 1 = full game-script adjustment, 0 = ignore
    prior_strength  = pseudo-games of weight given to the position prior
    opp_shrink      = pseudo-games of weight given to "league average defense"
                      when shrinking STAGE 2's ratio (used by :mod:`opponent`)
    sd_mult_*       = interval calibration multipliers, fitted so the stated
                      ~68% range actually covers ~68% of out-of-sample outcomes

Statistical assumptions (plain language)
----------------------------------------
- *Recent form matters more*: game values are weighted by an exponential decay
  over games-ago (not days, so byes don't distort the decay). A halflife of 4
  games means last week counts ~2× a game from a month ago.
- *Small samples are noisy, so they shrink*: an 8-game history carries real
  information; a 3-game history is mostly luck. The baseline blends the
  player's recency-weighted mean with a position-level prior, weighted by the
  *effective* sample size of the decayed window (ESS = 1/Σwᵢ²) against
  ``prior_strength`` pseudo-games. Full-history starters barely move; a
  3-game backup lands most of the way at the position average instead of
  inheriting a hot streak or a garbage-time mirage.
- *Multiplicative adjustments*: a defense allowing 20% more yards should add
  ~20% to the line, and a shootout total scales volume on top of that. The
  weight exponents let you soften a factor toward 1.0 (no effect) when you
  don't trust that input, rather than deleting the term.
- *Confidence interval*: the range must cover outcome spread **and** the fact
  that the baseline itself was estimated from a finite sample:
      predictive_sd = eff_std × sqrt(1 + 1/ESS) × calibration_multiplier
    - continuous stats (yards, receptions): ``eff_std`` is the recency-weighted
      game-to-game std about the projected baseline;
    - count stats (TDs): small integer counts are better described by a Poisson
      (std ≈ √mean); we use that when the mean is small, falling back to the
      sample std when it isn't.
  The calibration multipliers are fitted on held-out seasons so the interval
  covers ≈ its stated fraction of outcomes rather than assuming perfect
  normality (real yardage distributions are heavier-tailed than normal).
- *Refusal over fabrication*: fewer than ``min_games`` played games (or any
  error-severity data flag) refuses the projection loudly instead of emitting
  a number built on sand.

Confidence labels: high / medium / low, from history size, opponent sample
size, game-script availability, and data freshness.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .data_pipeline import PlayerHistory
from .stats import StatSpec

# Interval calibration multipliers (see module docstring). Fitted by walking
# the 2024 and 2025 seasons against cached nflverse weekly data
# (prop-model/backtest.py): c = q68(|actual − projection| / predictive_sd)
# per stat kind pooled across both seasons, so the stated ~68% range covers
# ≈68% of held-out outcomes.
CALIBRATED_SD_MULT_CONTINUOUS = 1.01
CALIBRATED_SD_MULT_COUNT = 0.63


@dataclass(frozen=True)
class ModelWeights:
    halflife: float = 4.0            # games; recent games weighted 2× at this distance
    opponent: float = 1.0            # exponent on the opponent factor (0 = ignore)
    game_script: float = 1.0         # exponent on the game-script factor (0 = ignore)
    min_games: int = 3               # refuse to project below this
    prior_strength: float = 2.0      # pseudo-games pulling the baseline toward the prior
    opp_shrink: float = 3.0          # pseudo-games pulling the opponent ratio toward 1.0
    sd_mult_continuous: float = CALIBRATED_SD_MULT_CONTINUOUS
    sd_mult_count: float = CALIBRATED_SD_MULT_COUNT


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
    note: str | None = None      # e.g. "ESPN prior — no NFL history (rookie)"
    pred_sd: float | None = None  # predictive std behind [low, high] (not serialized)

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
            "note": self.note,
        }


def recency_weights(n: int, halflife: float = 4.0) -> np.ndarray:
    """Exponential decay weights over games-ago (0 = most recent game)."""
    if n <= 1:
        return np.ones(n)
    age = np.arange(n - 1, -1, -1, dtype=float)  # most recent = 0
    w = 0.5 ** (age / halflife)
    return w / w.sum()


def effective_sample_size(weights: np.ndarray) -> float:
    """Kish ESS of (normalized) weights: 1/Σwᵢ² — how many games the window
    really carries once recency decay is applied."""
    denom = float(np.sum(np.asarray(weights, dtype=float) ** 2))
    return 1.0 / denom if denom > 0 else 0.0


def _weighted_var(values: np.ndarray, weights: np.ndarray, center: float) -> float:
    """Unbiased weighted variance about ``center`` (small-sample corrected)."""
    var = float(np.average((values - center) ** 2, weights=weights))
    denom = 1.0 - float(np.sum(weights**2))
    if denom > 0 and len(values) > 1:
        var = var / denom
    return max(0.0, var)


def _confidence(
    n_games: int,
    history_ok: bool,
    opp_ok: bool,
    script_ok: bool,
    stale_warn: bool,
    min_games: int,
) -> str:
    """Rule-based confidence: high / medium / low.

    Only *warn*-severity staleness downgrades confidence. Offseason runs are
    always informationally "stale" (the last game is months old) — treating
    that as a confidence killer would make every August projection low.
    """
    if not history_ok or n_games < min_games:
        return "low"
    if n_games >= 8 and opp_ok and script_ok and not stale_warn:
        return "high"
    if n_games >= 5 and opp_ok and not stale_warn:
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


def _shrunk_baseline(
    raw_mean: float,
    ess: float,
    position_prior: float | None,
    prior_strength: float,
) -> float:
    """Blend the player's weighted mean toward the position prior.

    Weight on the player's own mean is ESS/(ESS + prior_strength): a full
    recency-decayed 8-game window (ESS ≈ 5) keeps ~2/3 of its signal at the
    default strength, while a 3-game window leans mostly on the prior.
    """
    if position_prior is None or prior_strength <= 0:
        return raw_mean
    k = ess / (ess + prior_strength)
    return k * raw_mean + (1.0 - k) * float(position_prior)


def project(
    history: PlayerHistory,
    opponent_factor: dict | float,
    script_factor: dict | float,
    weights: ModelWeights | None = None,
    position_prior: float | None = None,
) -> Projection:
    """Project the next game value for ``history``'s player+stat.

    ``opponent_factor`` is the STAGE 2 output (``{"factor", ...}``) or a float;
    ``script_factor`` is the STAGE 3 output (``{"factor", ...}``) or a float.
    ``position_prior`` is the position-level average per player-game for this
    stat (e.g. from the same weekly frame); when given, thin histories shrink
    toward it instead of trusting a tiny raw sample.
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

    stale_warn = any(
        f.code == "STALE" and f.severity == "warn" for f in history.flags
    )
    values = np.asarray(history.games["value"].tolist(), dtype=float)
    w = recency_weights(len(values), weights.halflife)
    ess = effective_sample_size(w)
    raw_mean = float(np.average(values, weights=w))

    baseline = _shrunk_baseline(raw_mean, ess, position_prior, weights.prior_strength)
    std = math.sqrt(_weighted_var(values, w, baseline)) if len(values) > 1 else 0.0

    # Outcome spread plus estimation error of the baseline itself (σ/√ESS):
    # a short window produces a fuzzy mean, and pretending otherwise is why
    # thin-player ranges used to under-cover badly.
    if history.stat.kind == "count":
        # Poisson assumption for small integer counts: std ≈ √mean.
        core_std = math.sqrt(max(baseline, 0.0)) if baseline < 5 else std
        sd_mult = weights.sd_mult_count
    else:
        core_std = std
        sd_mult = weights.sd_mult_continuous
    pred_sd = core_std * math.sqrt(1.0 + 1.0 / ess) * sd_mult if ess > 0 else core_std * sd_mult

    projection = baseline * (opp_f**weights.opponent) * (gs_f**weights.game_script)

    return Projection(
        player_name=history.player_name,
        stat=history.stat,
        projection=projection,
        baseline=baseline,
        low=max(0.0, projection - pred_sd),
        high=projection + pred_sd,
        confidence=_confidence(n, history.ok, opp_ok, gs_ok, stale_warn, weights.min_games),
        n_games=n,
        opponent_factor=round(opp_f, 3),
        script_factor=round(gs_f, 3),
        pred_sd=pred_sd,
    )


def _refusal_reason(history: PlayerHistory, min_games: int) -> str:
    for f in history.flags:
        if f.severity == "error":
            return f"{f.code}: {f.message}"
    return f"fewer than {min_games} games"
