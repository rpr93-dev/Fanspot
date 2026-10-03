"""NBA player resolver: id first, exact normalized name + team, refuse namesakes."""

from __future__ import annotations

import pandas as pd

from propmodel.nba.players import NameIndex, normalize_name, resolve_nba_player


def _frame(rows):
    return pd.DataFrame(
        [dict(player_id=p, player_name=n, team=t, game_date=pd.Timestamp(d)) for p, n, t, d in rows]
    )


def test_suffix_accent_and_punctuation_stripping():
    assert normalize_name("Jaren Jackson Jr.") == "jaren jackson"
    assert normalize_name("Jaren Jackson") == "jaren jackson"
    assert normalize_name("Gary Trent Jr") == "gary trent"
    assert normalize_name("Tim Hardaway III") == "tim hardaway"
    assert normalize_name("Nikola Jokić") == "nikola jokic"
    assert normalize_name("Shai Gilgeous-Alexander") == "shai gilgeous alexander"
    assert normalize_name("D'Angelo Russell") == "dangelo russell"
    assert normalize_name("P.J. Washington") == "pj washington"
    # A bare suffix-looking token is never the whole name.
    assert normalize_name("V") == "v"


def test_resolves_suffix_variant_and_accents():
    idx = NameIndex(_frame([("4277961", "Jaren Jackson Jr.", "MEM", "2026-01-01"),
                            ("3112335", "Nikola Jokic", "DEN", "2026-01-01")]))
    assert resolve_nba_player(idx, "Jaren Jackson", "MEM").player_id == "4277961"
    assert resolve_nba_player(idx, "Nikola Jokić", "DEN").player_id == "3112335"


def test_ambiguous_namesakes_refused():
    idx = NameIndex(_frame([("1", "Jalen Williams", "OKC", "2026-01-01"),
                            ("2", "Jalen Williams", "DEN", "2026-01-01")]))
    r = resolve_nba_player(idx, "Jalen Williams", "LAL")
    assert r.player_id is None and r.refused_reason.startswith("ambiguous")
    r_none = resolve_nba_player(idx, "Jalen Williams", None)
    assert r_none.player_id is None and "ambiguous" in r_none.refused_reason
    # The team disambiguates.
    assert resolve_nba_player(idx, "Jalen Williams", "OKC").player_id == "1"
    assert resolve_nba_player(idx, "Jalen Williams", "DEN").player_id == "2"


def test_explicit_player_id_preferred():
    idx = NameIndex(_frame([("1", "Jalen Williams", "OKC", "2026-01-01"),
                            ("2", "Jalen Williams", "DEN", "2026-01-01")]))
    assert resolve_nba_player(idx, "Jalen Williams", "LAL", player_id="2").player_id == "2"
    # An unknown explicit id never falls back onto a namesake.
    r = resolve_nba_player(idx, "Jalen Williams", "OKC", player_id="77")
    assert r.player_id is None and "not guessing" in r.refused_reason


def test_not_found_and_offseason_move():
    idx = NameIndex(_frame([("5", "Kevin Durant", "PHX", "2025-04-01")]))
    r = resolve_nba_player(idx, "Kevin Durantt", "HOU")
    assert r.player_id is None and "not found" in r.refused_reason
    moved = resolve_nba_player(idx, "Kevin Durant", "HOU")
    assert moved.player_id == "5"
    assert moved.warning and moved.warning.startswith("team_mismatch")
    # No last-name-only matching.
    assert resolve_nba_player(idx, "Durant", "PHX").player_id is None
