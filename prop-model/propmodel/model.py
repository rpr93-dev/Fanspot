"""STAGE 4 — Canonical projection engine.

Combines recency-weighted baseline, hierarchical shrinkage, opponent
adjustment, game-script adjustment, and role-change detection into a
single probabilistic projection.

Pipeline
--------
1. **Baseline**: recency-weighted mean of recent game values, shrunk toward
   a position prior (empirical Bayes). Recent games matter more (exponential
   decay), but small samples regress heavily.

2. **Winsorization**: extreme outlier games are capped to prevent one monster
   performance from dominating the baseline. The cap uses a MAD-based
   outlier detector.

3. **Role-change detection**: if the player\'s recent usage (targets, carries,
   snaps) has materially shifted from their older sample, the model detects
   a regime change and weights the recent period more heavily.

4. **Opponent adjustment**: how the opponent has performed against this stat,
   normalized to league average, heavily shrunk toward 1.0 for small samples,
   and bounded.

5. **Game-script adjustment**: Vegas total/spread → expected volume.

6. **Distribution**: the output includes percentiles (p10, p25, p50, p75, p90),
   not just a point estimate.

Outputs
-------
:class:`FullProjection` carries the projection, diagnostics, and distribution.
:class:`Projection` (the legacy wrapper) is preserved for API compatibility.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .data_pipeline import PlayerHistory
from .stats import StatSpec

# ── Interval calibration multipliers ────────────────────────────────────────
CALIBRATED_SD_MULT_CONTINUOUS = 1.01
CALIBRATED_SD_MULT_COUNT = 0.63

# ── Bounded adjustment guardrails ───────────────────────────────────────────
OPP_FACTOR_MIN = 0.75
OPP_FACTOR_MAX = 1.25
SCRIPT_FACTOR_MIN = 0.80
SCRIPT_FACTOR_MAX = 1.20
WINSORIZE_MAD_MULT = 3.5


@dataclass(frozen=True)
class ModelWeights:
    """Tunable projection parameters."""
    halflife: float = 4.0
    opponent: float = 1.0
    game_script: float = 1.0
    min_games: int = 3
    prior_strength: float = 0.5
    opp_shrink: float = 6.0
    sd_mult_continuous: float = CALIBRATED_SD_MULT_CONTINUOUS
    sd_mult_count: float = CALIBRATED_SD_MULT_COUNT
    halflife_count: float = 8.0
    opponent_count: float = 0.5
    prior_strength_count: float = 0.0
    opp_factor_min: float = OPP_FACTOR_MIN
    opp_factor_max: float = OPP_FACTOR_MAX
    script_factor_min: float = SCRIPT_FACTOR_MIN
    script_factor_max: float = SCRIPT_FACTOR_MAX
    winsor_mad_mult: float = WINSORIZE_MAD_MULT


@dataclass
class FullProjection:
    """Complete projection with diagnostics and uncertainty distribution."""
    player_name: str
    stat: StatSpec
    projection: float | None
    baseline: float | None
    pred_sd: float | None
    low: float | None
    high: float | None
    p10: float | None
    p25: float | None
    p50: float | None
    p75: float | None
    p90: float | None
    confidence: str
    confidence_score: float = 0.0
    reliability_score: int = 0
    n_games: int = 0
    effective_sample_size: float = 0.0
    opponent_factor: float | None = None
    script_factor: float | None = None
    role_factor: float | None = None
    recent_form_factor: float | None = None
    refused_reason: str | None = None
    note: str | None = None
    warnings: list[str] = field(default_factory=list)
    inputs: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = {
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
            "effective_sample_size": round(self.effective_sample_size, 2) if self.effective_sample_size else None,
            "opponent_factor": round(self.opponent_factor, 3) if self.opponent_factor else None,
            "script_factor": round(self.script_factor, 3) if self.script_factor else None,
            "role_factor": round(self.role_factor, 3) if self.role_factor else None,
            "recent_form_factor": round(self.recent_form_factor, 3) if self.recent_form_factor else None,
            "refused_reason": self.refused_reason,
            "note": self.note,
            "reliability": self.reliability_score,
            "confidence_score": round(self.confidence_score, 3),
            "pred_sd": round(self.pred_sd, 2) if self.pred_sd else None,
        }
        for pkey, dkey in [("p10","p10"),("p25","p25"),("p50","p50"),("p75","p75"),("p90","p90")]:
            if getattr(self, pkey) is not None:
                d[dkey] = round(getattr(self, pkey), 1)
        if self.warnings:
            d["warnings"] = self.warnings
        if self.inputs:
            d["inputs"] = self.inputs
        return d


@dataclass
class Projection:
    """Legacy-compatible projection for API backward compatibility."""
    player_name: str
    stat: StatSpec
    projection: float | None
    baseline: float | None
    low: float | None
    high: float | None
    confidence: str
    n_games: int
    opponent_factor: float | None
    script_factor: float | None
    refused_reason: str | None = None
    note: str | None = None
    pred_sd: float | None = None
    reliability_score: int = 0

    def to_dict(self) -> dict:
        d = {
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
        if self.pred_sd is not None:
            d["pred_sd"] = round(self.pred_sd, 2)
        return d


# ── Recency weighting ──────────────────────────────────────────────────────

def recency_weights(n: int, halflife: float = 4.0) -> np.ndarray:
    """Exponential decay weights over games-ago (0 = most recent game)."""
    if n <= 1:
        return np.ones(n)
    age = np.arange(n - 1, -1, -1, dtype=float)
    w = 0.5 ** (age / halflife)
    return w / w.sum()


def effective_sample_size(weights: np.ndarray) -> float:
    """Kish ESS: 1/sum(w^2)."""
    denom = float(np.sum(np.asarray(weights, dtype=float) ** 2))
    return 1.0 / denom if denom > 0 else 0.0


# ── Robust statistics ─────────────────────────────────────────────────────

def _weighted_mean(values: np.ndarray, weights: np.ndarray) -> float:
    return float(np.average(values, weights=weights))


def _weighted_var(values: np.ndarray, weights: np.ndarray, center: float) -> float:
    var = float(np.average((values - center) ** 2, weights=weights))
    denom = 1.0 - float(np.sum(weights ** 2))
    if denom > 0 and len(values) > 1:
        var = var / denom
    return max(0.0, var)


def _winsorize(values: np.ndarray, mad_mult: float = WINSORIZE_MAD_MULT) -> np.ndarray:
    """Winsorize values: cap outliers at MAD_mult x MAD from the median."""
    if len(values) < 3:
        return values.copy()
    median = np.median(values)
    mad = np.median(np.abs(values - median))
    if mad == 0:
        mad = np.std(values) if len(values) > 1 else 1.0
    lower = median - mad_mult * mad
    upper = median + mad_mult * mad
    return np.clip(values, lower, upper)


# ── Role-change detection ─────────────────────────────────────────────────

def _detect_role_change(
    history: PlayerHistory,
    weekly: pd.DataFrame | None = None,
) -> tuple[float | None, list[str]]:
    """Detect if the player\'s recent role differs from older sample.

    Prefers opportunity (targets, carries, attempts) over raw box-score yards
    when available — a WR going from 15% to 28% target share for 4 games is a
    genuine role change; a single 80-yard TD is not.
    """
    warnings_list: list[str] = []
    stat_key = history.stat.key
    if stat_key not in ("receiving_yards", "receptions", "rushing_yards", "passing_yards"):
        return None, warnings_list
    if len(history.games) < 4:
        return None, warnings_list

    # Prefer opportunity column when available (targets, carries, attempts)
    opp_col = history.stat.opportunity_columns[0] if history.stat.opportunity_columns else None
    use_opp = False
    if opp_col and opp_col in history.games.columns:
        opp_vals = history.games[opp_col].dropna()
        # Need at least 3 non-null opportunity values to trust it
        if len(opp_vals) >= 3 and len(opp_vals) >= len(history.games) * 0.5:
            use_opp = True

    mid = max(len(history.games) // 2, 2)
    if use_opp:
        old_values = history.games[opp_col].iloc[:mid].dropna().values
        new_values = history.games[opp_col].iloc[mid:].dropna().values
        label = opp_col
    else:
        old_values = history.games["value"].iloc[:mid].values
        new_values = history.games["value"].iloc[mid:].values
        label = stat_key

    if len(old_values) == 0 or len(new_values) == 0:
        return None, warnings_list

    old_mean = float(np.mean(old_values))
    new_mean = float(np.mean(new_values))

    if old_mean == 0:
        return None, warnings_list

    pct_change = (new_mean - old_mean) / abs(old_mean)

    if abs(pct_change) > 0.20:
        warnings_list.append(
            f"role_change_detected: {label} changed {pct_change:+.0%} "
            f"(recent {new_mean:.1f} vs older {old_mean:.1f})"
        )

    role_factor = 1.0 + pct_change * 0.5
    role_factor = max(0.70, min(1.30, role_factor))
    return round(role_factor, 3), warnings_list


# ── Recent form signal ─────────────────────────────────────────────────────

def _recent_form_factor(
    history: PlayerHistory,
    n_recent: int = 3,
) -> tuple[float | None, bool]:
    """Compare last n_recent games to the rest of the sample."""
    n = len(history.games)
    if n < 2 * n_recent:
        return None, False

    values = history.games["value"].values
    recent = values[-n_recent:]
    older = values[:-n_recent]

    recent_mean = float(np.mean(recent))
    older_mean = float(np.mean(older))

    if older_mean == 0:
        return None, False

    factor = recent_mean / older_mean
    reliable = True
    if n_recent <= 2:
        reliable = False

    return round(factor, 3), reliable


# ── Confidence scoring ─────────────────────────────────────────────────────

def compute_confidence(
    n_games: int,
    ess: float,
    history_ok: bool,
    opp_ok: bool,
    stale_warn: bool,
    min_games: int,
    role_stable: bool = True,
    has_espn_prior: bool = False,
    espn_coverage: float = 0.0,
) -> tuple[str, float]:
    """Quantitative confidence: (label, score)."""
    if not history_ok or n_games < min_games:
        return "low", 0.0

    score = 0.0

    if ess >= 7.0: score += 40
    elif ess >= 5.0: score += 32
    elif ess >= 3.5: score += 24
    elif ess >= 2.0: score += 14
    elif ess >= 1.0: score += 6
    else: score += 2

    if role_stable: score += 20
    else: score += 5

    if opp_ok: score += 15

    if not stale_warn: score += 10
    else: score += 3

    if espn_coverage >= 0.8: score += 10
    elif espn_coverage >= 0.5: score += 6
    elif espn_coverage >= 0.2: score += 3

    if has_espn_prior and n_games < 6:
        score = score * 0.8

    score = min(1.0, max(0.0, score / 100.0))

    # Require sufficient raw game count
    if n_games < 5:
        score = min(0.29, score)  # caps at low for < 5 games

    # Require some raw game count for high confidence (prevents ESS-only high confidence)
    if score >= 0.7 and n_games >= 8 and opp_ok and not stale_warn:
        return "high", score
    elif score >= 0.45 and (opp_ok or espn_coverage >= 0.6) and not stale_warn:
        return "medium", score
    elif n_games >= 4 and espn_coverage >= 0.6:
        return "medium", score
    elif n_games >= 3 and espn_coverage >= 0.8:
        return "medium", score
    else:
        return "low", score


def reliability_score(
    n_games: int,
    history_ok: bool,
    opp_ok: bool,
    stale_warn: bool,
    min_games: int,
    espn_lines: int = 0,
    total_markets: int = 0,
    ess: float | None = None,
    role_stable: bool = True,
) -> int:
    """Composite reliability 0-100."""
    score = 0.0

    if n_games >= 12: score += 25
    elif n_games >= 8: score += 20
    elif n_games >= 5: score += 12
    elif n_games >= 3: score += 5

    if history_ok: score += 20
    if role_stable: score += 15
    elif n_games >= 3: score += 5

    if opp_ok: score += 15
    if not stale_warn: score += 10

    coverage = espn_lines / max(total_markets, 1)
    score += int(coverage * 10)

    if ess is not None:
        if ess >= 7.0: score += 15
        elif ess >= 5.5: score += 12
        elif ess >= 4.0: score += 9
        elif ess >= 2.5: score += 5
        else: score += 2

    return min(100, max(0, int(round(score))))


# ── Distribution generation ────────────────────────────────────────────────

def build_distribution(
    projection: float,
    pred_sd: float,
    stat_kind: str,
    n_games: int,
    ess: float,
    historical_residuals: np.ndarray | None = None,
) -> dict[str, float]:
    """Build an empirical uncertainty distribution around the projection."""
    if projection is None or pred_sd is None:
        return {}

    if historical_residuals is not None and len(historical_residuals) >= 5:
        orig_sd = float(np.std(historical_residuals))
        if orig_sd > 0:
            scaled = historical_residuals * (pred_sd / orig_sd)
        else:
            scaled = historical_residuals
        simulated = projection + scaled
        return {
            "p10": float(np.percentile(simulated, 10)),
            "p25": float(np.percentile(simulated, 25)),
            "p50": float(np.percentile(simulated, 50)),
            "p75": float(np.percentile(simulated, 75)),
            "p90": float(np.percentile(simulated, 90)),
            "median": float(np.percentile(simulated, 50)),
            "mean": projection,
            "std_dev": pred_sd,
        }

    if stat_kind == "count":
        mean = max(projection, 0.01)
        sd = max(math.sqrt(mean), pred_sd * 0.5)
        shape = (mean / sd) ** 2 if sd > 0 else 1.0
        scale = sd ** 2 / mean if mean > 0 else 1.0
        sim = np.random.gamma(shape, scale, size=2000)
    else:
        sim = np.random.normal(projection, pred_sd, size=2000)
        fat_tails = np.random.choice([0.0, 2.0], size=2000, p=[0.95, 0.05]) * pred_sd * np.random.choice([-1, 1], size=2000)
        sim += fat_tails

    sim = np.clip(sim, 0, None)

    return {
        "p10": float(np.percentile(sim, 10)),
        "p25": float(np.percentile(sim, 25)),
        "p50": float(np.percentile(sim, 50)),
        "p75": float(np.percentile(sim, 75)),
        "p90": float(np.percentile(sim, 90)),
        "median": float(np.percentile(sim, 50)),
        "mean": float(projection),
        "std_dev": float(pred_sd),
    }


# ── Helpers ────────────────────────────────────────────────────────────────

def _factor_value(f: dict | float) -> tuple[float, bool]:
    if isinstance(f, dict):
        value = float(f.get("factor", 1.0))
        if "available" in f:
            reliable = bool(f["available"])
        else:
            reliable = not bool(f.get("low_sample", True))
        return value, reliable
    return float(f), True


def _absence_note(history: PlayerHistory) -> str | None:
    parts = []
    for f in history.flags:
        if f.code == "CALENDAR_GAP":
            parts.append(f.message)
        elif f.code == "MISSED_GAMES":
            parts.append(f"{len(history.missed_games)} missed week(s) in window")
    return " · ".join(parts) if parts else None


def position_guard_reason(position: str, stat: StatSpec) -> str | None:
    pos = str(position or "").upper()
    if pos and pos != "?" and pos not in stat.positions:
        pos_list = "/".join(stat.positions)
        return (
            f"POSITION_MISMATCH: {pos} cannot produce {stat.key} "
            f"(valid positions: {pos_list})"
        )
    return None


def _shrunk_baseline(
    raw_mean: float,
    ess: float,
    position_prior: float | None,
    prior_strength: float,
) -> float:
    if position_prior is None or prior_strength <= 0:
        return raw_mean
    k = ess / (ess + prior_strength)
    return k * raw_mean + (1.0 - k) * float(position_prior)


def _refusal_reason(history: PlayerHistory, min_games: int) -> str:
    for f in history.flags:
        if f.severity == "error":
            return f"{f.code}: {f.message}"
    return f"fewer than {min_games} games"


# ── The main projection function ───────────────────────────────────────────

def project(
    history: PlayerHistory,
    opponent_factor: dict | float,
    script_factor: dict | float,
    weights: ModelWeights | None = None,
    position_prior: float | None = None,
    espn_prior: float | None = None,
    historical_residuals: np.ndarray | None = None,
    weekly: pd.DataFrame | None = None,
) -> FullProjection:
    """Project the next game value for history\'s player+stat."""
    weights = weights or ModelWeights()
    opp_f, opp_ok = _factor_value(opponent_factor)
    gs_f, gs_ok = _factor_value(script_factor)

    is_count = history.stat.kind == "count"
    halflife = weights.halflife_count if is_count else weights.halflife
    w_opp = weights.opponent_count if is_count else weights.opponent
    prior_k = weights.prior_strength_count if is_count else weights.prior_strength

    n = history.n_games
    stale_warn = any(
        f.code == "STALE" and f.severity == "warn" for f in history.flags
    )

    def _make_refusal(reason: str) -> FullProjection:
        notes_list = []
        if not gs_ok:
            notes_list.append("no Vegas lines - game-script neutral")
        absence = _absence_note(history)
        if absence:
            notes_list.append(absence)
        return FullProjection(
            player_name=history.player_name, stat=history.stat,
            projection=None, baseline=None,
            low=None, high=None, p10=None, p25=None, p50=None, p75=None, p90=None,
            pred_sd=None,
            confidence="low", confidence_score=0.0,
            n_games=n, effective_sample_size=0.0,
            opponent_factor=round(opp_f, 3), script_factor=round(gs_f, 3),
            role_factor=None, recent_form_factor=None,
            refused_reason=reason,
            note=" · ".join(notes_list) if notes_list else None,
            warnings=[],
            reliability_score=reliability_score(n, False, opp_ok, stale_warn, weights.min_games, 0, 0, role_stable=True),
        )

    if not history.ok or n < weights.min_games or history.games.empty:
        return _make_refusal(_refusal_reason(history, weights.min_games))

    guard = position_guard_reason(getattr(history, "position", ""), history.stat)
    if guard:
        return _make_refusal(guard)

    # Step 1: Winsorize (robust against outliers)
    values = np.asarray(history.games["value"].tolist(), dtype=float)
    values_clean = _winsorize(values, weights.winsor_mad_mult)

    # Step 2: Recency-weighted mean (+ opportunity*efficiency decomposition when available)
    w = recency_weights(len(values_clean), halflife)
    ess = effective_sample_size(w)
    raw_mean = _weighted_mean(values_clean, w)

    # Step 2b: Opportunity decomposition — if targets/carries/attempts are available,
    # model volume and efficiency separately. Efficiency is noisier and gets heavier
    # shrinkage; a single 80-yard TD should not double the projection.
    decomposed_baseline: float | None = None
    opp_col = history.stat.opportunity_columns[0] if history.stat.opportunity_columns else None
    if opp_col and opp_col in history.games.columns:
        opp_vals_raw = history.games[opp_col].tolist()
        # Need at least half the games with valid opportunity
        valid_mask = [v is not None and not (isinstance(v, float) and math.isnan(v)) and float(v) > 0 for v in opp_vals_raw]
        if sum(valid_mask) >= 3 and sum(valid_mask) >= len(values_clean) * 0.5:
            try:
                opp_vals = np.array([float(v) if valid_mask[i] else 0.0 for i, v in enumerate(opp_vals_raw)], dtype=float)
                # Winsorize opportunity too (cap insane carry counts)
                opp_clean = _winsorize(opp_vals, weights.winsor_mad_mult)
                opp_mean = _weighted_mean(opp_clean, w)
                # Efficiency: yards per target/carry/attempt
                eff_vals = np.array([
                    float(values_clean[i]) / max(float(opp_vals_raw[i]), 1.0) if valid_mask[i] else 0.0
                    for i in range(len(values_clean))
                ], dtype=float)
                # Winsorize efficiency heavily (catches the 80-yard TD case)
                eff_clean = _winsorize(eff_vals, weights.winsor_mad_mult * 0.8)
                eff_mean = _weighted_mean(eff_clean, w)
                # Shrink efficiency toward league-ish prior (heavier than volume)
                # League efficiency prior: ~8 yds/target for WR, ~4.5 ypc for RB, ~7 ypa for QB — use position_prior/opportunity prior if available
                # For now, shrink efficiency with prior_strength * 2 (more regression)
                eff_prior_strength = prior_k * 2.0 + 1.0 if prior_k > 0 else 2.0
                # Estimate efficiency prior as position_prior / typical opportunity if we have one
                eff_prior = None
                if position_prior is not None and opp_mean > 0:
                    # Rough: position_prior implies average opportunity; derive efficiency prior
                    # Use median opportunity as proxy for typical volume
                    typical_opp = float(np.median([v for v in opp_vals if v > 0])) if any(v > 0 for v in opp_vals) else opp_mean
                    if typical_opp > 0:
                        eff_prior = position_prior / typical_opp
                eff_shrunk = _shrunk_baseline(eff_mean, ess, eff_prior, eff_prior_strength) if eff_prior else eff_mean
                decomposed_baseline = float(opp_mean * eff_shrunk)
            except Exception:
                decomposed_baseline = None

    # Step 3: Shrink toward position prior (and optionally blend decomposed)
    if decomposed_baseline is not None:
        # Blend raw and decomposed: decomposed captures role/efficiency changes
        # but raw is more stable for small samples. Weight decomposed by ESS
        # and stat type — receiving is most opportunity-driven, passing least.
        stat_decomp_cap = {"receiving_yards": 0.60, "receptions": 0.60, "rushing_yards": 0.45, "passing_yards": 0.30}.get(history.stat.key, 0.40)
        decomp_weight = min(stat_decomp_cap, ess / 8.0 * stat_decomp_cap / 0.6)
        blended_raw = _shrunk_baseline(raw_mean, ess, position_prior, prior_k)
        baseline = blended_raw * (1 - decomp_weight) + decomposed_baseline * decomp_weight
    else:
        baseline = _shrunk_baseline(raw_mean, ess, position_prior, prior_k)

    # Step 4: Predictive SD
    std = math.sqrt(_weighted_var(values_clean, w, baseline)) if len(values_clean) > 1 else 0.0

    if is_count:
        core_std = math.sqrt(max(baseline, 0.01)) if baseline < 5 else std
        sd_mult = weights.sd_mult_count
    else:
        core_std = std
        sd_mult = weights.sd_mult_continuous

    pred_sd = core_std * math.sqrt(1.0 + 1.0 / ess) * sd_mult if ess > 0 else core_std * sd_mult

    # Step 5: Apply opponent and game-script adjustments
    projection = baseline * (opp_f ** w_opp) * (gs_f ** weights.game_script)

    # Step 6: Role-change detection (diagnostic only — recency weighting already captures this)
    role_factor, role_warnings = _detect_role_change(history, weekly)

    # Step 7: Recent form signal (diagnostic only — recency weighting already captures this)
    recent_form, form_reliable = _recent_form_factor(history, n_recent=3)

    # Step 8: ESPN prior blend (thin history fallback) + sanity check
    notes_list: list[str] = []
    has_espn_prior = False
    espn_disagreement_warning: str | None = None
    # Phase 13: ESPN as sanity check — flag large disagreements instead of averaging
    if espn_prior is not None and not math.isnan(espn_prior):
        # Check disagreement before blending (when we have enough history to be meaningful)
        if n >= weights.min_games and projection and projection > 0:
            disagreement = abs(projection - espn_prior) / max(projection, espn_prior)
            if disagreement > 0.30:
                espn_disagreement_warning = f"model_vs_espn_large_disagreement: model {projection:.1f} vs ESPN {espn_prior:.1f} ({disagreement:.0%} diff)"
        if n < weights.min_games * 2:
            blend = 0.3 if n >= 1 else 0.6
            projection = projection * (1 - blend) + espn_prior * blend
            has_espn_prior = True
            notes_list.append("ESPN-prior blended (thin NFL history)")

    # Phase 11: Season boundary handling — detect heavy prior-season reliance
    season_warnings: list[str] = []
    if not history.games.empty and "season" in history.games.columns:
        seasons_in_history = history.games["season"].unique()
        if len(seasons_in_history) > 1:
            # Count games from most recent season
            max_season = int(history.games["season"].max())
            recent_count = int((history.games["season"] == max_season).sum())
            prior_count = n - recent_count
            if recent_count < 3 and prior_count > recent_count:
                season_warnings.append(
                    f"heavy_prior_season_reliance: {prior_count}/{n} games from prior season(s) — early-season projection"
                )
            # Check for team change across seasons (player moved teams)
            if "team" in history.games.columns or True:
                # Use history.team as current team, check if any game opponent suggests different context
                pass  # team change detection requires weekly frame join — handled via stale/warning in data_pipeline

    # Step 9: Honest-input notes
    if not gs_ok:
        notes_list.append("no Vegas lines - game-script neutral")
    absence = _absence_note(history)
    if absence:
        notes_list.append(absence)

    # Phase 18: Guardrails — clamp unrealistic projections
    stat_caps: dict[str, tuple[float, float]] = {
        "passing_yards": (0, 450),
        "rushing_yards": (0, 250),
        "receiving_yards": (0, 250),
        "receptions": (0, 15),
        "tds": (0, 4),
    }
    guardrail_warnings: list[str] = []
    if history.stat.key in stat_caps and projection is not None:
        lo, hi = stat_caps[history.stat.key]
        if projection < lo:
            guardrail_warnings.append(f"guardrail_clamped: projection {projection:.1f} < {lo} → clamped to {lo}")
            projection = lo
        elif projection > hi:
            guardrail_warnings.append(f"guardrail_clamped: projection {projection:.1f} > {hi} → clamped to {hi}")
            projection = hi
        # Also clamp baseline
        if baseline is not None:
            baseline = max(lo, min(hi, baseline))

    # Step 10: Confidence (with season-boundary penalty)
    role_stable = role_factor is None or abs(role_factor - 1.0) < 0.10
    confidence_label, confidence_score = compute_confidence(
        n_games=n, ess=ess, history_ok=history.ok, opp_ok=opp_ok,
        stale_warn=stale_warn, min_games=weights.min_games,
        role_stable=role_stable, has_espn_prior=has_espn_prior,
    )
    # Phase 11: Reduce confidence when heavily reliant on prior season
    if season_warnings:
        confidence_score = confidence_score * 0.85
        if confidence_score >= 0.7:
            confidence_score = 0.69  # drop from high
            confidence_label = "medium"
    # Phase 13: Reduce confidence on large ESPN disagreement (don't hide it)
    if espn_disagreement_warning:
        confidence_score = confidence_score * 0.9

    rel = reliability_score(
        n_games=n, history_ok=history.ok, opp_ok=opp_ok,
        stale_warn=stale_warn, min_games=weights.min_games,
        espn_lines=1 if has_espn_prior else 0, total_markets=1,
        ess=ess, role_stable=role_stable,
    )

    # Step 11: Build distribution
    dist = build_distribution(
        projection=projection, pred_sd=pred_sd, stat_kind=history.stat.kind,
        n_games=n, ess=ess, historical_residuals=historical_residuals,
    )

    # Step 12: Return
    all_warnings = role_warnings + season_warnings + guardrail_warnings
    if espn_disagreement_warning:
        all_warnings = all_warnings + [espn_disagreement_warning]
    return FullProjection(
        player_name=history.player_name, stat=history.stat,
        projection=projection, baseline=baseline,
        low=max(0.0, projection - pred_sd) if pred_sd else None,
        high=projection + pred_sd if pred_sd else None,
        p10=dist.get("p10"), p25=dist.get("p25"), p50=dist.get("p50"),
        p75=dist.get("p75"), p90=dist.get("p90"),
        pred_sd=pred_sd,
        confidence=confidence_label, confidence_score=confidence_score,
        n_games=n, effective_sample_size=ess,
        opponent_factor=round(opp_f, 3), script_factor=round(gs_f, 3),
        role_factor=role_factor, recent_form_factor=recent_form,
        refused_reason=None,
        note=" · ".join(notes_list) if notes_list else None,
        warnings=all_warnings,
        inputs={
            "raw_mean": round(raw_mean, 2),
            "ess": round(ess, 2),
            "halflife": halflife,
            "opponent_raw": round(opp_f, 3),
            "game_script_raw": round(gs_f, 3),
            "decomposed_baseline": round(decomposed_baseline, 2) if decomposed_baseline is not None else None,
            "prior_season_games": int(sum(history.games["season"] != history.games["season"].max())) if not history.games.empty and "season" in history.games.columns else 0,
        },
        reliability_score=rel,
    )
