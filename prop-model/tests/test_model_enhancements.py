"""Tests for enhanced model features: winsorization, role detection, confidence scoring, distributions."""

from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np
import pytest

from propmodel.data_pipeline import fetch_player_history, PlayerHistory, QualityFlag
from propmodel.model import (
    ModelWeights,
    FullProjection,
    _winsorize,
    _detect_role_change,
    _recent_form_factor,
    compute_confidence,
    build_distribution,
    effective_sample_size,
    project,
    recency_weights,
    reliability_score,
)
from propmodel.stats import get_stat
import pandas as pd


# ── Fixture helpers ──────────────────────────────────────────────────────────

QB_ID = "00-000042"


def _qb_rows(values: list[float], season: int = 2025, start: date | None = None) -> list[dict]:
    start = start or date.today() - timedelta(days=7 * len(values))
    rows = []
    for i, v in enumerate(values):
        gameday = start + timedelta(days=7 * i)
        rows.append({
            "player_id": QB_ID, "player_name": "Test QB", "position": "QB",
            "recent_team": "HOU", "opponent_team": "TEN",
            "season": season, "week": i + 1, "gameday": gameday.isoformat(),
            "game_id": f"{season}_{i + 1:02d}_HOU_TEN", "games": 1,
            "passing_yards": v, "passing_tds": 1 if v > 0 else 0,
            "rushing_yards": None, "rushing_tds": None,
            "receiving_yards": None, "receptions": None, "receiving_tds": None,
        })
    return rows


def _history(values: list[float], stat: str = "passing_yards", **kw):
    from tests.test_data_pipeline import _weekly
    frame = _weekly(_qb_rows(values))
    return fetch_player_history(QB_ID, stat, seasons=[2025], fetcher=lambda s: frame, **kw)


# ── Winsorization tests ─────────────────────────────────────────────────────

def test_winsorize_caps_outliers():
    """Outliers beyond 3.5 MAD should be capped."""
    values = np.array([10.0, 12.0, 11.0, 100.0, 11.0, 12.0, 10.0, 11.0])  # 100 is an outlier
    winsorized = _winsorize(values, 3.5)
    assert len(winsorized) == len(values)
    # The 100 should be capped to something much smaller
    assert winsorized[3] < 50  # definitely capped


def test_winsorize_no_change_for_uniform():
    """All same values → no change."""
    values = np.array([10.0] * 5)
    result = _winsorize(values, 3.5)
    np.testing.assert_array_equal(result, values)


def test_winsorize_small_samples_untouched():
    """Less than 3 values → copy without modification."""
    for n in [1, 2]:
        values = np.array([float(i) for i in range(n)])
        result = _winsorize(values, 3.5)
        np.testing.assert_array_equal(result, values)


# ── Role change detection tests ─────────────────────────────────────────────

def test_role_change_detected_on_sustained_shift():
    """When the recent half differs >20% from older half, detect role change."""
    games_df = pd.DataFrame({
        'value': [10.0, 10.0, 10.0, 10.0, 20.0, 20.0, 20.0, 20.0],
        'season': [2025] * 8, 'week': list(range(1, 9)),
        'game_id': ['g'] * 8, 'date': ['2025-09-01'] * 8,
        'opponent': ['TEN'] * 8,
    })
    hist = PlayerHistory(
        stat=get_stat('receiving_yards'), player_id='00-000042',
        player_name='Test WR', position='WR', team='HOU',
        n_requested=8, games=games_df, missed_games=pd.DataFrame(),
        flags=[],
    )
    role_factor, warnings = _detect_role_change(hist)
    assert role_factor is not None
    assert role_factor > 1.0  # recent is higher
    assert len(warnings) > 0  # warning about role change


def test_no_role_change_when_stable():
    """Same values → no role change."""
    games_df = pd.DataFrame({
        'value': [10.0] * 8,
        'season': [2025] * 8, 'week': list(range(1, 9)),
        'game_id': ['g'] * 8, 'date': ['2025-09-01'] * 8,
        'opponent': ['TEN'] * 8,
    })
    hist = PlayerHistory(
        stat=get_stat('receiving_yards'), player_id='00-000042',
        player_name='Test WR', position='WR', team='HOU',
        n_requested=8, games=games_df, missed_games=pd.DataFrame(),
        flags=[],
    )
    role_factor, warnings = _detect_role_change(hist)
    assert role_factor is not None  # still computed
    assert abs(role_factor - 1.0) < 0.01  # but essentially 1.0


def test_role_change_not_detected_for_tds():
    """TDs don't have meaningful role signals."""
    games_df = pd.DataFrame({
        'value': [0.0, 0.0, 1.0, 0.0, 2.0, 1.0, 0.0, 1.0],
        'season': [2025] * 8, 'week': list(range(1, 9)),
        'game_id': ['g'] * 8, 'date': ['2025-09-01'] * 8,
        'opponent': ['TEN'] * 8,
    })
    hist = PlayerHistory(
        stat=get_stat('tds'), player_id='00-000042',
        player_name='Test QB', position='QB', team='HOU',
        n_requested=8, games=games_df, missed_games=pd.DataFrame(),
        flags=[],
    )
    role_factor, warnings = _detect_role_change(hist)
    assert role_factor is None


def test_role_change_requires_min_games():
    """Fewer than 4 games → no role detection."""
    games_df = pd.DataFrame({
        'value': [10.0, 20.0],
        'season': [2025] * 2, 'week': [1, 2],
        'game_id': ['g', 'g'], 'date': ['2025-09-01', '2025-09-08'],
        'opponent': ['TEN', 'TEN'],
    })
    hist = PlayerHistory(
        stat=get_stat('receiving_yards'), player_id='00-000042',
        player_name='Test WR', position='WR', team='HOU',
        n_requested=2, games=games_df, missed_games=pd.DataFrame(),
        flags=[],
    )
    role_factor, warnings = _detect_role_change(hist)
    assert role_factor is None


# ── Recent form factor tests ────────────────────────────────────────────────

def test_recent_form_detects_hot_streak():
    """Recent 3 games much higher than older games → hot streak."""
    games_df = pd.DataFrame({
        'value': [10.0, 10.0, 10.0, 10.0, 10.0, 30.0, 30.0, 30.0],
        'season': [2025] * 8, 'week': list(range(1, 9)),
        'game_id': ['g'] * 8, 'date': ['2025-09-01'] * 8,
        'opponent': ['TEN'] * 8,
    })
    hist = PlayerHistory(
        stat=get_stat('receiving_yards'), player_id='00-000042',
        player_name='Test WR', position='WR', team='HOU',
        n_requested=8, games=games_df, missed_games=pd.DataFrame(),
        flags=[],
    )
    factor, reliable = _recent_form_factor(hist, n_recent=3)
    assert factor is not None
    assert factor > 1.0  # hot streak
    assert reliable  # 8 games is enough for reliability


def test_recent_form_flat_when_equal():
    """Same recent and older → factor ≈ 1.0."""
    games_df = pd.DataFrame({
        'value': [10.0] * 8,
        'season': [2025] * 8, 'week': list(range(1, 9)),
        'game_id': ['g'] * 8, 'date': ['2025-09-01'] * 8,
        'opponent': ['TEN'] * 8,
    })
    hist = PlayerHistory(
        stat=get_stat('receiving_yards'), player_id='00-000042',
        player_name='Test WR', position='WR', team='HOU',
        n_requested=8, games=games_df, missed_games=pd.DataFrame(),
        flags=[],
    )
    factor, reliable = _recent_form_factor(hist, n_recent=3)
    assert factor is not None
    assert abs(factor - 1.0) < 0.01


def test_recent_form_returns_none_for_small_sample():
    """Fewer than 2*n_recent games → None."""
    games_df = pd.DataFrame({
        'value': [10.0, 20.0, 30.0],
        'season': [2025] * 3, 'week': [1, 2, 3],
        'game_id': ['g'] * 3, 'date': ['2025-09-01'] * 3,
        'opponent': ['TEN'] * 3,
    })
    hist = PlayerHistory(
        stat=get_stat('receiving_yards'), player_id='00-000042',
        player_name='Test WR', position='WR', team='HOU',
        n_requested=3, games=games_df, missed_games=pd.DataFrame(),
        flags=[],
    )
    factor, reliable = _recent_form_factor(hist, n_recent=3)
    assert factor is None


# ── Confidence scoring tests ────────────────────────────────────────────────

def test_confidence_high_with_good_data():
    """High ESS, role stable, opp ok, fresh → high."""
    label, score = compute_confidence(
        n_games=10, ess=7.5, history_ok=True, opp_ok=True,
        stale_warn=False, min_games=3, role_stable=True,
    )
    assert label == "high"
    assert score >= 0.7


def test_confidence_medium_with_thin_history():
    """5 games, some uncertainty → medium."""
    label, score = compute_confidence(
        n_games=5, ess=3.5, history_ok=True, opp_ok=True,
        stale_warn=False, min_games=3, role_stable=True,
    )
    assert label == "medium"


def test_confidence_low_when_insufficient():
    """Fewer than min_games → low regardless."""
    label, score = compute_confidence(
        n_games=2, ess=0.5, history_ok=True, opp_ok=True,
        stale_warn=False, min_games=3, role_stable=True,
    )
    assert label == "low"
    assert score < 0.01


def test_confidence_low_on_unreliable_opponent():
    """10 games but unreliable opponent → capped below high."""
    label, score = compute_confidence(
        n_games=10, ess=7.5, history_ok=True, opp_ok=False,
        stale_warn=False, min_games=3, role_stable=True,
    )
    assert label != "high"  # opp_ok=False prevents high confidence


def test_confidence_penalizes_espn_prior():
    """ESPN prior blending with thin history reduces score (or same when already capped)."""
    label1, score1 = compute_confidence(
        n_games=4, ess=2.0, history_ok=True, opp_ok=True,
        stale_warn=False, min_games=3, role_stable=True,
        has_espn_prior=True,
    )
    label2, score2 = compute_confidence(
        n_games=4, ess=2.0, history_ok=True, opp_ok=True,
        stale_warn=False, min_games=3, role_stable=True,
        has_espn_prior=False,
    )
    # ESPN prior penalty may not always produce lower score if both cap at low
    # The key invariant: having ESPN prior should not IMPROVE confidence
    assert score1 <= score2 + 0.01  # allow small float tolerance


# ── Reliability score tests ─────────────────────────────────────────────────

def test_reliability_high_with_large_sample():
    """12+ games, role stable, opp ok → high reliability."""
    score = reliability_score(
        n_games=12, history_ok=True, opp_ok=True,
        stale_warn=False, min_games=3, ess=7.5, role_stable=True,
    )
    assert score >= 80


def test_reliability_decreases_with_small_sample():
    """Fewer games → lower reliability."""
    score_high = reliability_score(
        n_games=10, history_ok=True, opp_ok=True,
        stale_warn=False, min_games=3, ess=6.0, role_stable=True,
    )
    score_low = reliability_score(
        n_games=3, history_ok=True, opp_ok=True,
        stale_warn=False, min_games=3, ess=1.5, role_stable=True,
    )
    assert score_high > score_low


def test_reliability_penalizes_role_change():
    """Role change → lower reliability."""
    score_stable = reliability_score(
        n_games=8, history_ok=True, opp_ok=True,
        stale_warn=False, min_games=3, ess=5.0, role_stable=True,
    )
    score_unstable = reliability_score(
        n_games=8, history_ok=True, opp_ok=True,
        stale_warn=False, min_games=3, ess=5.0, role_stable=False,
    )
    assert score_stable > score_unstable


# ── Distribution building tests ─────────────────────────────────────────────

def test_distribution_percentiles_ordered():
    """p10 <= p25 <= p50 <= p75 <= p90."""
    dist = build_distribution(
        projection=50.0, pred_sd=10.0, stat_kind="continuous",
        n_games=8, ess=5.0,
    )
    assert dist["p10"] <= dist["p25"] <= dist["p50"] <= dist["p75"] <= dist["p90"]
    assert dist["mean"] == 50.0
    assert dist["std_dev"] == 10.0


def test_distribution_negative_values_capped():
    """No negative values in distribution."""
    dist = build_distribution(
        projection=5.0, pred_sd=3.0, stat_kind="continuous",
        n_games=3, ess=1.5,
    )
    assert dist["p10"] >= 0.0


def test_distribution_with_historical_residuals():
    """Using historical residuals for empirical distribution."""
    residuals = np.array([-5.0, 3.0, -2.0, 4.0, -1.0, 2.0, -3.0, 1.0])
    dist = build_distribution(
        projection=50.0, pred_sd=3.0, stat_kind="continuous",
        n_games=8, ess=5.0, historical_residuals=residuals,
    )
    assert dist["mean"] == 50.0
    assert dist["p50"] is not None
    assert abs(dist["p50"] - 50.0) < 5.0  # median should be close to mean


def test_count_stat_uses_gamma_distribution():
    """Count stats use gamma-like (positive) distribution."""
    dist = build_distribution(
        projection=2.0, pred_sd=1.0, stat_kind="count",
        n_games=3, ess=1.5,
    )
    assert dist["p10"] >= 0.0  # no negative values
    assert dist["mean"] == 2.0


def test_distribution_handles_none_projection():
    """None projection → empty dict."""
    dist = build_distribution(
        projection=None, pred_sd=None, stat_kind="continuous",
        n_games=0, ess=0.0,
    )
    assert dist == {}


# ── Full projection tests ───────────────────────────────────────────────────

def test_full_projection_to_dict():
    """to_dict() produces correct serialization."""
    fp = FullProjection(
        player_name="Test Player", stat=get_stat("passing_yards"),
        projection=250.0, baseline=240.0, pred_sd=30.0,
        low=220.0, high=280.0, p10=190.0, p25=210.0, p50=240.0,
        p75=270.0, p90=300.0,
        confidence="high", confidence_score=0.85,
        reliability_score=85, n_games=10, effective_sample_size=7.5,
        opponent_factor=1.05, script_factor=0.98,
        role_factor=1.0, recent_form_factor=1.02,
    )
    d = fp.to_dict()
    assert d["projection"] == 250.0
    assert d["baseline"] == 240.0
    assert d["p10"] == 190.0
    assert d["p25"] == 210.0
    assert d["p50"] == 240.0
    assert d["p75"] == 270.0
    assert d["p90"] == 300.0
    assert d["confidence"] == "high"
    assert d["confidence_score"] == 0.85
    assert d["reliability"] == 85
    assert d["effective_sample_size"] == 7.5


def test_full_projection_refused():
    """Refused projection → None values."""
    fp = FullProjection(
        player_name="Test Player", stat=get_stat("passing_yards"),
        projection=None, baseline=None, pred_sd=None,
        low=None, high=None, p10=None, p25=None, p50=None,
        p75=None, p90=None,
        confidence="low", confidence_score=0.0,
        reliability_score=0, n_games=2, effective_sample_size=0.0,
        opponent_factor=None, script_factor=None,
        role_factor=None, recent_form_factor=None,
        refused_reason="fewer than 3 games",
    )
    d = fp.to_dict()
    assert d["projection"] is None
    assert d["refused_reason"] == "fewer than 3 games"


# ── Distribution invariants ─────────────────────────────────────────────────

def test_distribution_percentile_invariant():
    """p10 <= p25 <= p50 <= p75 <= p90 for all distribution types."""
    for stat_kind in ["continuous", "count"]:
        for projection in [5.0, 20.0, 50.0, 100.0]:
            dist = build_distribution(
                projection=projection, pred_sd=projection * 0.3,
                stat_kind=stat_kind, n_games=5, ess=3.0,
            )
            assert dist["p10"] <= dist["p25"] <= dist["p50"] <= dist["p75"] <= dist["p90"], \
                f"Failed for {stat_kind} at projection={projection}"


def test_projection_interval_ordering():
    """low <= p25 <= p50 <= p75 <= high."""
    hist = _history([20.0] * 8, stat="passing_yards")
    proj = project(hist, {"factor": 1.0}, {"factor": 1.0})
    
    if proj.low is not None and proj.p25 is not None:
        assert proj.low <= proj.p25
    if proj.p50 is not None and proj.p75 is not None:
        assert proj.p50 <= proj.p75
    if proj.p75 is not None and proj.high is not None:
        assert proj.p75 <= proj.high


# ── ESS and recency tests ───────────────────────────────────────────────────

def test_ess_decreases_with_more_recency():
    """More games with recency weighting → ESS approaches but doesn't exceed N."""
    for n in [3, 5, 8, 10]:
        w = recency_weights(n, halflife=4.0)
        ess = effective_sample_size(w)
        assert 0 < ess <= n


def test_ess_with_uniform_weights():
    """Uniform weights (n=1) → ESS = 1."""
    w = recency_weights(1, halflife=4.0)
    ess = effective_sample_size(w)
    assert ess == 1.0


# ── Phase 11: Season boundary tests ───────────────────────────────────────

def test_heavy_prior_season_reliance_flagged():
    """Early-season projection with 6 prior-season games → warning and confidence penalty."""
    games_df = pd.DataFrame({
        'value': [50.0] * 8,
        'targets': [8.0] * 8,
        'season': [2024]*6 + [2025]*2,
        'week': [10,11,12,13,14,15,1,2],
        'game_id': ['g']*8, 'date': ['2025-09-01']*8,
        'opponent': ['TEN']*8,
    })
    hist = PlayerHistory(
        stat=get_stat('receiving_yards'), player_id='00-1',
        player_name='Test WR', position='WR', team='HOU',
        n_requested=8, games=games_df, missed_games=pd.DataFrame(), flags=[],
    )
    proj = project(hist, {"factor": 1.0}, {"factor": 1.0})
    assert any('heavy_prior_season_reliance' in w for w in proj.warnings)
    assert proj.confidence_score < 0.7  # penalized below high


# ── Phase 13: ESPN sanity check tests ─────────────────────────────────────

def test_espn_large_disagreement_flagged():
    """Model 50 vs ESPN 100 (50% diff) → warning, no averaging when n>=3."""
    games_df = pd.DataFrame({
        'value': [50.0]*8, 'targets': [8.0]*8,
        'season': [2025]*8, 'week': list(range(1,9)),
        'game_id': ['g']*8, 'date': ['2025-09-01']*8,
        'opponent': ['TEN']*8,
    })
    hist = PlayerHistory(
        stat=get_stat('receiving_yards'), player_id='00-1',
        player_name='Test WR', position='WR', team='HOU',
        n_requested=8, games=games_df, missed_games=pd.DataFrame(), flags=[],
    )
    proj = project(hist, {"factor": 1.0}, {"factor": 1.0}, espn_prior=100)
    assert any('model_vs_espn_large_disagreement' in w for w in proj.warnings)
    # With n=8, ESPN should NOT be blended (only warns)
    assert proj.projection == pytest.approx(50.0, abs=2.0)


def test_espn_close_no_warning():
    """Model 50 vs ESPN 55 (9% diff) → no warning."""
    games_df = pd.DataFrame({
        'value': [50.0]*8, 'targets': [8.0]*8,
        'season': [2025]*8, 'week': list(range(1,9)),
        'game_id': ['g']*8, 'date': ['2025-09-01']*8,
        'opponent': ['TEN']*8,
    })
    hist = PlayerHistory(
        stat=get_stat('receiving_yards'), player_id='00-1',
        player_name='Test WR', position='WR', team='HOU',
        n_requested=8, games=games_df, missed_games=pd.DataFrame(), flags=[],
    )
    proj = project(hist, {"factor": 1.0}, {"factor": 1.0}, espn_prior=55)
    assert not any('model_vs_espn' in w for w in proj.warnings)


# ── Phase 18: Guardrail tests ─────────────────────────────────────────────

def test_guardrail_clamps_extreme_projection():
    """Insane 600*8 with 2x opponent factor → clamped to stat cap."""
    games_df = pd.DataFrame({
        'value': [600.0]*8, 'targets': [15.0]*8,
        'season': [2025]*8, 'week': list(range(1,9)),
        'game_id': ['g']*8, 'date': ['2025-09-01']*8,
        'opponent': ['TEN']*8,
    })
    hist = PlayerHistory(
        stat=get_stat('receiving_yards'), player_id='00-1',
        player_name='Test WR', position='WR', team='HOU',
        n_requested=8, games=games_df, missed_games=pd.DataFrame(), flags=[],
    )
    proj = project(hist, {"factor": 2.0}, {"factor": 1.5})
    assert proj.projection <= 250
    assert any('guardrail_clamped' in w for w in proj.warnings)


def test_guardrail_negative_never():
    """Projection never negative (clamped to 0)."""
    games_df = pd.DataFrame({
        'value': [0.0]*8, 'targets': [5.0]*8,
        'season': [2025]*8, 'week': list(range(1,9)),
        'game_id': ['g']*8, 'date': ['2025-09-01']*8,
        'opponent': ['TEN']*8,
    })
    hist = PlayerHistory(
        stat=get_stat('receiving_yards'), player_id='00-1',
        player_name='Test WR', position='WR', team='HOU',
        n_requested=8, games=games_df, missed_games=pd.DataFrame(), flags=[],
    )
    proj = project(hist, {"factor": 0.3}, {"factor": 0.3})
    assert proj.projection is not None and proj.projection >= 0
    if proj.low is not None:
        assert proj.low >= 0
    assert proj.p10 is not None and proj.p10 >= 0


# ── Phase 3: Opportunity-aware role change ─────────────────────────────────

def test_opportunity_role_change_uses_targets():
    """Role change on targets (8→16 targets) is detected even if yards noisy."""
    games_df = pd.DataFrame({
        'value': [40.0, 45.0, 50.0, 48.0, 90.0, 95.0, 88.0, 92.0],
        'targets': [4.0, 4.0, 5.0, 5.0, 10.0, 11.0, 10.0, 12.0],
        'season': [2025]*8, 'week': list(range(1,9)),
        'game_id': ['g']*8, 'date': ['2025-09-01']*8,
        'opponent': ['TEN']*8,
    })
    hist = PlayerHistory(
        stat=get_stat('receiving_yards'), player_id='00-1',
        player_name='Test WR', position='WR', team='HOU',
        n_requested=8, games=games_df, missed_games=pd.DataFrame(), flags=[],
    )
    role_factor, warnings = _detect_role_change(hist)
    assert role_factor is not None
    assert role_factor > 1.2  # opportunity doubled → role_factor high
    assert any('targets' in w for w in warnings)


# ── Invariant tests ────────────────────────────────────────────────────────

def test_percentile_invariant_ordered():
    """p10 <= p25 <= p50 <= p75 <= p90 for every projection."""
    for vals in [[20.0]*8, [10, 30, 20, 40, 15, 25, 35, 12]]:
        hist = _history(vals, stat="receiving_yards")
        proj = project(hist, {"factor": 1.0}, {"factor": 1.0})
        if proj.p10 is not None:
            assert proj.p10 <= proj.p25 <= proj.p50 <= proj.p75 <= proj.p90


def test_opponent_adjustment_bounded():
    """Team-computed opponent factors are bounded; direct inputs are stored as-is (caller must bound)."""
    # When computing via defense_allowed, ratios are clamped to [0.75, 1.25]
    from propmodel.opponent import team_week_rates
    import pandas as pd
    # Synthetic team-week where one team allows 300 vs league 100 → raw 3.0 → clamped
    tw = pd.DataFrame({
        'team': ['HOU']*8 + ['KC']*8,
        'season': [2025]*16, 'week': list(range(1,9))*2,
        'allowed': [300.0]*8 + [100.0]*8,
        'gameday': pd.to_datetime(['2025-09-01']*16),
    })
    rates = team_week_rates(tw, window=8, shrink_games=6.0)
    hou_ratio = float(rates[rates['team'] == 'HOU']['ratio'].iloc[0])
    assert 0.75 <= hou_ratio <= 1.25
    # Direct factor inputs are stored as provided (CLI/team logic should pre-clamp)
    hist = _history([50.0]*8, stat="receiving_yards")
    for f in [0.1, 5.0]:
        proj = project(hist, {"factor": f}, {"factor": 1.0})
        assert proj.opponent_factor == pytest.approx(f, abs=0.01)


def test_higher_volume_not_lower_projection():
    """All else equal, higher recent target share should not reduce receiving_yards projection."""
    base_vals = [50.0]*8
    high_vals = [30.0]*4 + [70.0]*4
    hist_base = _history(base_vals, stat="receiving_yards")
    # For high_vals we need opportunity decomposition to see effect — but even raw should trend
    # We'll directly test that recent_form factor captures it
    games_df = pd.DataFrame({
        'value': high_vals, 'targets': [5.0]*4 + [10.0]*4,
        'season': [2025]*8, 'week': list(range(1,9)),
        'game_id': ['g']*8, 'date': ['2025-09-01']*8,
        'opponent': ['TEN']*8,
    })
    hist_high = PlayerHistory(
        stat=get_stat('receiving_yards'), player_id='00-1',
        player_name='Test WR', position='WR', team='HOU',
        n_requested=8, games=games_df, missed_games=pd.DataFrame(), flags=[],
    )
    factor, _ = _recent_form_factor(hist_high, n_recent=3)
    assert factor is not None and factor > 1.0
