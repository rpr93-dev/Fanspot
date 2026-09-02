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
size, and data freshness. Missing Vegas lines are reported as a note on the
projection, not as lower confidence.
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
    prior_strength: float = 0.5      # pseudo-games pulling the baseline toward the prior
    opp_shrink: float = 6.0          # pseudo-games pulling the opponent ratio toward 1.0
    sd_mult_continuous: float = CALIBRATED_SD_MULT_CONTINUOUS
    sd_mult_count: float = CALIBRATED_SD_MULT_COUNT
    # Count stats (TDs) behave differently from yardage: week-to-week "form"
    # in small integer counts is nearly pure noise (walk-forward: any recency
    # emphasis or position-prior pull *loses* MAE to a flat mean), and the
    # TD-allowed defense ratio is the pipeline's bluntest proxy. So counts get
    # their own, deliberately flatter treatment.
    halflife_count: float = 8.0      # near-flat recency
    opponent_count: float = 0.5      # softened exponent on the opponent factor
    prior_strength_count: float = 0.0  # no positional pull


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
    reliability_score: int = 0    # 0-100 composite reliability (not serialized, added at API layer)

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
            "reliability": self.reliability_score,
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
    stale_warn: bool,
    min_games: int,
    espn_lines: int = 0,
    total_markets: int = 0,
) -> str:
    """Rule-based confidence: high / medium / low.

    ESPN line coverage boosts the score — a starter with 4/5 ESPN lines
    backed by 8 NFL games earns high even when opponent data is thin.
    Offseason runs are always informationally "stale" (the last game is
    months old) — treating that as a confidence killer would make every
    August projection low.
    """
    if not history_ok or n_games < min_games:
        return "low"

    # ESPN line coverage ratio (how many stats the player has ESPN projections for)
    coverage_ratio = espn_lines / max(total_markets, 1)

    if n_games >= 8 and opp_ok and not stale_warn:
        return "high"
    if n_games >= 5 and opp_ok and not stale_warn:
        return "medium"
    if n_games >= 4 and coverage_ratio >= 0.6:
        return "medium"
    if n_games >= 3 and coverage_ratio >= 0.8:
        return "medium"
    return "low"


def reliability_score(
    n_games: int,
    history_ok: bool,
    opp_ok: bool,
    stale_warn: bool,
    min_games: int,
    espn_lines: int = 0,
    total_markets: int = 0,
    ess: float | None = None,
) -> float:
    """Composite reliability 0–100 from history quality, opponent data, and ESS.

    Returned as an integer for display as a reliability badge alongside
    the confidence tier.
    """
    score = 0.0

    # History size (0–40 pts)
    if n_games >= 12:
        score += 40
    elif n_games >= 8:
        score += 35
    elif n_games >= 5:
        score += 25
    elif n_games >= 3:
        score += 15
    else:
        score += 5

    # History quality (0–25 pts)
    if history_ok:
        score += 25

    # Opponent data (0–25 pts)
    if opp_ok:
        score += 25

    # ESPN coverage (0–5 pts) — small bonus, since we always pass ESPN priors
    coverage = espn_lines / max(total_markets, 1)
    score += int(coverage * 5)

    # ESS (effective sample size) — how spread out the games are (0–10 pts)
    # A 8-game window spread across 8 games (no byes) has higher ESS than
    # 8 games crammed into 4 weeks. ESS >= 5 = full marks.
    if ess is not None:
        if ess >= 5.0:
            score += 10
        elif ess >= 3.0:
            score += 7
        elif ess >= 2.0:
            score += 4
        elif ess >= 1.0:
            score += 2
        else:
            score += 0

    # Staleness penalty
    if stale_warn:
        score = max(0, score - 10)

    return min(100, max(0, int(round(score))))


def position_guard_reason(position: str, stat: StatSpec) -> str | None:
    """Reason string when ``position`` cannot produce ``stat``, else None.

    A recorded position that cannot produce the requested stat (a CB asked for
    receiving yards off eight zero-rows) is an impossible request. Unknown
    positions ("?") are allowed through — absence of evidence is not evidence.
    """
    pos = str(position or "").upper()
    if pos and pos != "?" and pos not in stat.positions:
        return (
            f"POSITION_MISMATCH: {pos} cannot produce {stat.key} "
            f"(valid positions: {'/'.join(stat.positions)})"
        )
    return None


def _absence_note(history: PlayerHistory) -> str | None:
    """Human-readable absence honesty for the note column.

    Production weekly frames carry no DNP rows, so injury absences are
    invisible directly; the calendar span of the window is the cheap proxy
    ("8 games spanning 84 days"). Roster-level missed weeks are surfaced too
    when the frame has them."""
    parts = []
    for f in history.flags:
        if f.code == "CALENDAR_GAP":
            parts.append(f.message)
        elif f.code == "MISSED_GAMES":
            parts.append(f"{len(history.missed_games)} missed week(s) in window")
    return " · ".join(parts) if parts else None


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
    espn_prior: float | None = None,
) -> Projection:
    """Project the next game value for ``history``'s player+stat.

    ``opponent_factor`` is the STAGE 2 output (``{"factor", ...}``) or a float;
    ``script_factor`` is the STAGE 3 output (``{"factor", ...}``) or a float.
    ``position_prior`` is the position-level average per player-game for this
    stat (e.g. from the same weekly frame); when given, thin histories shrink
    toward it instead of trusting a tiny raw sample.
    ``espn_prior`` is an ESPN projected line used as an additional fallback
    when the player has sparse NFL history (rookie / thin sample).
    """
    weights = weights or ModelWeights()
    opp_f, opp_ok = _factor_value(opponent_factor)
    gs_f, gs_ok = _factor_value(script_factor)

    # Per-kind treatment (see ModelWeights): counts get flatter recency, no
    # positional pull, and a softened opponent factor.
    if history.stat.kind == "count":
        halflife = weights.halflife_count
        w_opp = weights.opponent_count
        prior_k = weights.prior_strength_count
    else:
        halflife = weights.halflife
        w_opp = weights.opponent
        prior_k = weights.prior_strength

    n = history.n_games
    if not history.ok or n < weights.min_games or history.games.empty:
        return Projection(
            player_name=history.player_name, stat=history.stat,
            projection=None, baseline=None, low=None, high=None,
            confidence="low", n_games=n,
            opponent_factor=round(opp_f, 3), script_factor=round(gs_f, 3),
            refused_reason=_refusal_reason(history, weights.min_games),
            reliability_score=reliability_score(n, False, opp_ok, stale_warn, weights.min_games, 0, 0),
        )

    # Position guard: refuse the impossible request loudly instead of
    # emitting a confident 0.0 built on zero-rows.
    guard = position_guard_reason(getattr(history, "position", ""), history.stat)
    if guard:
        return Projection(
            player_name=history.player_name, stat=history.stat,
            projection=None, baseline=None, low=None, high=None,
            confidence="low", n_games=n,
            opponent_factor=round(opp_f, 3), script_factor=round(gs_f, 3),
            refused_reason=guard,
            reliability_score=reliability_score(n, False, opp_ok, stale_warn, weights.min_games, 0, 0),
        )

    stale_warn = any(
        f.code == "STALE" and f.severity == "warn" for f in history.flags
    )
    values = np.asarray(history.games["value"].tolist(), dtype=float)
    w = recency_weights(len(values), halflife)
    ess = effective_sample_size(w)
    raw_mean = float(np.average(values, weights=w))

    baseline = _shrunk_baseline(raw_mean, ess, position_prior, prior_k)
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

    projection = baseline * (opp_f**w_opp) * (gs_f**weights.game_script)

    # When history is thin (n_games < min_games * 2) and we have an ESPN prior,
    # blend it toward the model projection for a more reliable number.
    if espn_prior is not None and n < weights.min_games * 2:
        blend = 0.3 if n >= 1 else 0.6  # more ESPN for fewer games
        projection = projection * (1 - blend) + espn_prior * blend
        if not notes:
            notes.append("ESPN-prior blended (thin NFL history)")

    # Note: ESPN prior availability (regardless of blending) boosts confidence
    # and reliability — it signals the projection has external validation.
    has_espn_prior = espn_prior is not None

    # Honest-input notes: line absence is reported separately from confidence
    # (D9), and absence-honesty flags surface in the note column.
    notes = []
    if not gs_ok:
        notes.append("no Vegas lines — game-script neutral")
    absence = _absence_note(history)
    if absence:
        notes.append(absence)

    return Projection(
        player_name=history.player_name,
        stat=history.stat,
        projection=projection,
        baseline=baseline,
        low=max(0.0, projection - pred_sd),
        high=projection + pred_sd,
        confidence=_confidence(n, history.ok, opp_ok, stale_warn, weights.min_games, 1 if has_espn_prior else 0, 1),
        n_games=n,
        opponent_factor=round(opp_f, 3),
        script_factor=round(gs_f, 3),
        pred_sd=pred_sd,
        note=" · ".join(notes) if notes else None,
        reliability_score=_rel,
    )


def _refusal_reason(history: PlayerHistory, min_games: int) -> str:
    for f in history.flags:
        if f.severity == "error":
            return f"{f.code}: {f.message}"
    return f"fewer than {min_games} games"
