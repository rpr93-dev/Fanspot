"""ESPN NBA summary parsing + team normalization (fixture JSON, no network)."""

from __future__ import annotations

from datetime import date

from propmodel.nba.fetcher import (
    default_nba_seasons,
    frame_from_rows,
    parse_summary,
    season_for_date,
    trim_summary,
)
from propmodel.nba.teams import normalize_nba_team

NAMES = ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"]


def _ath(pid, name, pos, stats, starter=False, dnp=False, reason=None):
    return {
        "active": True, "starter": starter, "didNotPlay": dnp, "reason": reason, "ejected": False,
        "stats": stats,
        "athlete": {"id": pid, "displayName": name, "position": {"abbreviation": pos}, "headshot": {"href": "x"}},
    }


def fixture_summary(home="OKC", away="GS"):
    return {
        "header": {
            "id": "401810434",
            "season": {"year": 2026, "type": 2},
            "competitions": [{
                "id": "401810434",
                "date": "2026-01-16T02:30Z",  # 9:30 PM ET on Jan 15
                "status": {"type": {"completed": True, "name": "STATUS_FINAL"}},
                "competitors": [
                    {"homeAway": "home", "score": "120", "team": {"abbreviation": home, "logo": "l"}},
                    {"homeAway": "away", "score": "111", "team": {"abbreviation": away, "logo": "l"}},
                ],
            }],
        },
        "boxscore": {"players": [
            {"team": {"abbreviation": home}, "statistics": [{
                "names": NAMES, "keys": [], "labels": NAMES,
                "athletes": [
                    _ath("4278073", "Shai Gilgeous-Alexander", "G",
                         ["36", "34", "12-21", "3-7", "7-8", "5", "8", "2", "2", "1", "1", "4", "2", "+12"], starter=True),
                    _ath("999", "Bench Guy", "F", [], dnp=True, reason="COACH'S DECISION"),
                ],
            }]},
            {"team": {"abbreviation": away}, "statistics": [{
                "names": NAMES, "keys": [], "labels": NAMES,
                "athletes": [
                    _ath("3975", "Stephen Curry", "G",
                         ["33:30", "29", "10-22", "6-14", "3-3", "4", "6", "3", "1", "0", "0", "4", "1", "-9"], starter=True),
                ],
            }]},
        ]},
        "plays": [{"text": "lots of play-by-play"}],
        "pickcenter": [{"spread": -7.5, "overUnder": 229.5, "details": "OKC -7.5"}],
    }


def test_parse_fixture_summary():
    rows = parse_summary(fixture_summary())
    assert len(rows) == 3
    sga = next(r for r in rows if r["player_id"] == "4278073")
    assert sga["team"] == "OKC" and sga["opponent"] == "GSW" and sga["home"] is True
    assert sga["game_date"] == "2026-01-15"  # UTC late tip stays on its US date
    assert sga["season"] == 2026 and sga["season_type"] == 2
    assert sga["minutes"] == 36 and sga["pts"] == 34 and sga["reb"] == 5 and sga["ast"] == 8
    assert sga["fg3m"] == 3 and sga["fg3a"] == 7 and sga["fga"] == 21 and sga["fta"] == 8
    assert sga["oreb"] == 1 and sga["dreb"] == 4 and sga["tov"] == 2 and sga["stl"] == 2 and sga["blk"] == 1
    assert sga["starter"] is True and sga["dnp"] is False
    bench = next(r for r in rows if r["player_id"] == "999")
    assert bench["dnp"] is True and bench["minutes"] == 0 and bench["pts"] is None
    assert bench["dnp_reason"] == "COACH'S DECISION"
    curry = next(r for r in rows if r["player_id"] == "3975")
    assert curry["team"] == "GSW" and curry["home"] is False
    assert curry["minutes"] == 33.5 and curry["fg3m"] == 6


def test_trimmed_summary_parses_identically():
    full = fixture_summary()
    trimmed = trim_summary(full)
    assert "plays" not in trimmed
    assert trimmed["line"]["overUnder"] == 229.5
    assert parse_summary(trimmed) == parse_summary(full)


def test_all_star_exhibitions_dropped():
    assert parse_summary(fixture_summary(home="STARS", away="STRIPES")) == []


def test_frame_dtypes():
    df = frame_from_rows(parse_summary(fixture_summary()))
    assert str(df["game_date"].dtype).startswith("datetime64")
    assert df["dnp"].dtype == bool and df["starter"].dtype == bool
    assert df["pts"].isna().sum() == 1


def test_team_normalization_both_sides():
    for espn, canon in [("GS", "GSW"), ("NY", "NYK"), ("SA", "SAS"), ("UTAH", "UTA"), ("WAS", "WSH"),
                        ("NOP", "NO"), ("PHO", "PHX"), ("BRK", "BKN"), ("okc", "OKC"), ("GSW", "GSW")]:
        assert normalize_nba_team(espn) == canon
    assert normalize_nba_team("XYZ") == "XYZ"
    assert normalize_nba_team(None) == ""


def test_season_helpers():
    assert season_for_date(date(2026, 10, 2)) == 2027
    assert season_for_date(date(2026, 3, 1)) == 2026
    assert default_nba_seasons(date(2026, 10, 2)) == [2025, 2026, 2027]
