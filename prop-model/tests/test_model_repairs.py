"""Regression tests for the 2026 season-backtest repair items.

One test module per concern so a future reader can map a failure back to the
measured defect it guards:

- item 8: seeded Monte-Carlo distribution (reproducible p10-p90)
- item 5: player-name token-overlap fallback
- item 4: DK passing-market stat specs (TDs / attempts / completions / INTs)
- item 1: relief-duty (backup/mop-up) history detection
- item 3: predictability (game-log CV) confidence penalty
- item 2: tunable asymmetric combined-factor clamp
"""

from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import pytest

from propmodel.data_pipeline import fetch_player_history
from propmodel.model import (
    FACTOR_CLAMP_HI_BY_STAT,
    ModelWeights,
    build_distribution,
    compute_confidence,
    project,
)
from propmodel.players import match_key_normalized, normalize_name, resolve_player_id
from propmodel.stats import get_stat

QB_ID = "00-000042"

_FRAME_COLS = [
    "player_id", "player_name", "position", "recent_team", "opponent_team",
    "season", "week", "gameday", "game_id", "games",
    "passing_yards", "passing_tds", "attempts", "completions", "passing_interceptions",
    "rushing_yards", "rushing_tds", "carries",
    "receiving_yards", "receptions", "receiving_tds", "targets",
]


def _row(week: int, season: int = 2025, gameday: str | None = None, **vals) -> dict:
    base = {
        "player_id": QB_ID, "player_name": "Test QB", "position": "QB",
        "recent_team": "HOU", "opponent_team": "TEN",
        "season": season, "week": week,
        "gameday": gameday or (date(2025, 9, 8) + timedelta(days=7 * (week - 1))).isoformat(),
        "game_id": f"{season}_{week:02d}_HOU_TEN", "games": 1,
    }
    base.update(vals)
    return base


def _frame(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=_FRAME_COLS)


def _qb_history(attempts: list[float], yds: list[float], stat: str = "passing_yards", **extra):
    rows = []
    for i, (att, y) in enumerate(zip(attempts, yds)):
        rows.append(_row(i + 1, attempts=att, passing_yards=y, **extra))
    frame = _frame(rows)
    return fetch_player_history(QB_ID, stat, seasons=[2025], fetcher=lambda s: frame)


# ── item 8: deterministic percentile distribution ──────────────────────────

def test_build_distribution_is_reproducible():
    a = build_distribution(250.0, 30.0, "continuous", 8, 6.0)
    b = build_distribution(250.0, 30.0, "continuous", 8, 6.0)
    assert a == b, "unseeded RNG made p10-p90 jitter between identical calls"

    g1 = build_distribution(1.4, 1.1, "count", 8, 6.0)
    g2 = build_distribution(1.4, 1.1, "count", 8, 6.0)
    assert g1 == g2


def test_build_distribution_seed_override_changes_draw():
    a = build_distribution(250.0, 30.0, "continuous", 8, 6.0, seed=1)
    b = build_distribution(250.0, 30.0, "continuous", 8, 6.0, seed=2)
    assert a != b  # different seeds should not collapse to one stream


# ── item 5: name token-overlap fallback ────────────────────────────────────

def test_match_key_normalized_collapses_first_name():
    assert match_key_normalized(normalize_name("C.J. Stroud")) == "c stroud"
    assert match_key_normalized(normalize_name("Chig Okonkwo")) == "c okonkwo"
    assert match_key_normalized(normalize_name("Chigoziem Okonkwo")) == "c okonkwo"


def test_resolve_player_id_token_overlap_rescues_shortened_first_name():
    weekly = pd.DataFrame([
        {"player_id": "00-9", "player_name": "Chigoziem Okonkwo", "position": "TE",
         "recent_team": "TB", "season": 2025, "week": 4},
    ])
    # Exact normalized name misses ("chig" != "chigoziem"), the initial+last
    # fallback catches it.
    assert resolve_player_id(weekly, "Chig Okonkwo", "TB") == "00-9"


def test_resolve_player_id_token_overlap_refuses_ambiguous_namesakes():
    weekly = pd.DataFrame([
        {"player_id": "00-1", "player_name": "Chris Jones", "position": "TE",
         "recent_team": "KC", "season": 2025, "week": 4},
        {"player_id": "00-2", "player_name": "Cameron Jones", "position": "TE",
         "recent_team": "DAL", "season": 2025, "week": 4},
    ])
    # Same first initial + last name, two active players, no team hint: refuse
    # rather than guess (the fallback must not be looser than the exact pass).
    assert resolve_player_id(weekly, "C. Jones") is None
    # A team hint pins it.
    assert resolve_player_id(weekly, "C. Jones", "DAL") == "00-2"


def test_token_overlap_does_not_override_exact_ambiguity():
    weekly = pd.DataFrame([
        {"player_id": "00-1", "player_name": "Josh Johnson", "position": "QB",
         "recent_team": "BAL", "season": 2025, "week": 3},
        {"player_id": "00-2", "player_name": "Josh Johnson", "position": "RB",
         "recent_team": "DET", "season": 2025, "week": 4},
    ])
    # Exact name is ambiguous and the fallback is not reached — still None.
    assert resolve_player_id(weekly, "Josh Johnson") is None


# ── item 4: DK passing-market stat specs ───────────────────────────────────

@pytest.mark.parametrize("stat,positions,kind", [
    ("passing_tds", ("QB",), "continuous"),
    ("passing_attempts", ("QB",), "continuous"),
    ("completions", ("QB",), "continuous"),
    ("interceptions", ("QB",), "count"),
])
def test_new_stat_specs_registered(stat, positions, kind):
    spec = get_stat(stat)
    assert spec.positions == positions
    assert spec.kind == kind


def test_new_stat_aliases_resolve():
    assert get_stat("pass_tds").key == "passing_tds"
    assert get_stat("attempts").key == "passing_attempts"
    assert get_stat("comp").key == "completions"
    assert get_stat("ints").key == "interceptions"


def test_unknown_stat_still_raises():
    with pytest.raises(ValueError):
        get_stat("field_goals")


@pytest.mark.parametrize("stat", ["passing_tds", "passing_attempts", "completions", "interceptions"])
def test_new_passing_markets_project(stat):
    rows = []
    for w in range(1, 9):
        rows.append(_row(
            w, passing_yards=260 + w, passing_tds=2, attempts=34 + w,
            completions=22 + (w % 3), passing_interceptions=1 if w % 4 == 0 else 0,
        ))
    frame = _frame(rows)
    hist = fetch_player_history(QB_ID, stat, seasons=[2025], fetcher=lambda s: frame)
    assert hist.ok
    proj = project(hist, {"factor": 1.0, "low_sample": False}, {"factor": 1.0, "available": True})
    assert proj.projection is not None and proj.projection > 0
    assert proj.refused_reason is None


# ── item 1: relief-duty detection ──────────────────────────────────────────

def test_relief_duty_detects_backup_sample():
    hist = _qb_history(attempts=[3, 5, 2, 8, 4, 6, 3, 5], yds=[20, 30, 15, 40, 25, 35, 20, 30])
    proj = project(hist, {"factor": 1.0, "low_sample": False}, {"factor": 1.0, "available": True})
    assert proj.confidence == "low"
    assert proj.confidence_score <= 0.29
    assert any("relief_duty_history" in w for w in proj.warnings)


def test_named_starter_role_sharpens_relief_wording():
    hist = _qb_history(attempts=[3, 5, 2, 8, 4, 6, 3, 5], yds=[20, 30, 15, 40, 25, 35, 20, 30])
    proj = project(hist, {"factor": 1.0, "low_sample": False}, {"factor": 1.0, "available": True},
                   role="named_starter")
    assert any("FIRST_START" in w for w in proj.warnings)


def test_relief_duty_widens_interval():
    # Constant attempts keep the opportunity decomposition on the same baseline
    # as the no-volume run, so the only difference left is the x1.5 widening.
    vals_yds = [20, 30, 15, 40, 25, 35, 20, 30]

    def _proj(with_volume: bool):
        attempts = [3.0] * 8 if with_volume else [None] * 8
        hist = _qb_history(attempts=attempts, yds=vals_yds)
        return project(hist, {"factor": 1.0, "low_sample": False}, {"factor": 1.0, "available": True})

    flagged = _proj(True)
    unflagged = _proj(False)
    assert flagged.refused_reason is None and unflagged.refused_reason is None
    assert flagged.projection == pytest.approx(unflagged.projection)
    assert flagged.pred_sd == pytest.approx(unflagged.pred_sd * 1.5, rel=1e-6)


def test_starter_volume_sample_not_flagged():
    hist = _qb_history(attempts=[32, 40, 28, 35, 30, 38, 33, 36],
                       yds=[250, 300, 210, 270, 240, 290, 255, 280])
    proj = project(hist, {"factor": 1.0, "low_sample": False}, {"factor": 1.0, "available": True})
    assert proj.confidence != "low"
    assert not any("relief_duty" in w for w in proj.warnings)


# ── item 3: predictability (CV) confidence penalty ─────────────────────────

def test_confidence_cv_penalty_blocks_high():
    volatile = compute_confidence(
        n_games=10, ess=7.5, history_ok=True, opp_ok=True,
        stale_warn=False, min_games=3, role_stable=True,
        game_cv=2.0, cv_p75=0.94,
    )
    steady = compute_confidence(
        n_games=10, ess=7.5, history_ok=True, opp_ok=True,
        stale_warn=False, min_games=3, role_stable=True,
        game_cv=0.4, cv_p75=0.94,
    )
    assert volatile[0] != "high"
    assert steady[0] == "high"
    assert volatile[1] < steady[1]


def test_project_demotes_high_volatility_game_log():
    # Same 8-game length and starter volume, but boom/bust output (CV ~0.97,
    # above the QB passing p75 of 0.94): must not earn the high label.
    yds = [5, 500, 5, 500, 5, 500, 5, 500]
    att = [34] * 8
    hist = _qb_history(attempts=att, yds=yds)
    proj = project(hist, {"factor": 1.0, "low_sample": False}, {"factor": 1.0, "available": True})
    assert proj.confidence != "high"


# ── item 2: tunable asymmetric clamp ───────────────────────────────────────

def test_passing_uses_asymmetric_upper_clamp():
    # combined 1.25 * 1.20 = 1.50 exceeds the generic 1.30 cap but sits under
    # the passing override (1.60) — a QB ceiling game is no longer clamped.
    hist = _qb_history(attempts=[34] * 8, yds=[250.0] * 8)
    proj = project(hist, {"factor": 1.25, "low_sample": False}, {"factor": 1.20, "available": True})
    assert proj.projection == pytest.approx(250.0 * 1.25 * 1.20)
    assert not any("combined_adjustment_clamped" in w for w in proj.warnings)
    assert FACTOR_CLAMP_HI_BY_STAT["passing_yards"] > ModelWeights().factor_clamp_hi


def test_clamp_bounds_are_tunable_via_weights():
    hist = _qb_history(attempts=[34] * 8, yds=[250.0] * 8)
    w = ModelWeights(factor_clamp_lo=0.80, factor_clamp_hi=1.05)
    # passing_yards has its own override, so use a stat without one.
    wr = fetch_player_history(
        "00-000077", "receiving_yards", seasons=[2025],
        fetcher=lambda s: pd.DataFrame([
            {"player_id": "00-000077", "player_name": "Test WR", "position": "WR",
             "recent_team": "HOU", "opponent_team": "TEN", "season": 2025, "week": w_,
             "gameday": (date(2025, 9, 8) + timedelta(days=7 * (w_ - 1))).isoformat(),
             "game_id": f"2025_{w_:02d}_HOU_TEN", "games": 1,
             "receiving_yards": 60.0, "targets": 8.0}
            for w_ in range(1, 9)
        ], columns=_FRAME_COLS),
    )
    proj = project(wr, {"factor": 1.25, "low_sample": False}, {"factor": 1.20, "available": True}, weights=w)
    assert proj.projection == pytest.approx(60.0 * 1.05)
    assert any("combined_adjustment_clamped" in x for x in proj.warnings)
