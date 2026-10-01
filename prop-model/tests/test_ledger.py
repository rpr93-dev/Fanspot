"""Tests for propmodel/ledger.py — no network, no pandas."""
import json

import pytest

from propmodel import ledger


@pytest.fixture()
def path(tmp_path):
    return tmp_path / "ledger.json"


def _pre_record():
    return {
        "asOf": "2026-09-09",
        "dataThrough": "09/07/2026",
        "rows": [
            {"player": "Drake Maye", "stat": "passing_yards", "projection": 231.5,
             "pred_sd": 48.0, "line": 232.5, "book": "Consensus", "pick": "under", "prob": 0.52},
            {"player": "Drake Maye", "stat": "tds", "projection": 1.4,
             "pred_sd": 0.9, "line": None},
        ],
    }


def _live_point(q=1, val=167):
    return {
        "quarters": q,
        "state": "in",
        "rows": {"Drake Maye": {"passing_yards": val, "tds": 2}},
    }


def test_key_normalization():
    assert ledger.make_key("ne", "nyj", "2026-09-09") == "20260909|NE|NYJ"
    assert ledger.make_key("NE", "NYJ", "20260909") == "20260909|NE|NYJ"
    with pytest.raises(ValueError):
        ledger.make_key("NE!", "NYJ", "20260909")
    with pytest.raises(ValueError):
        ledger.make_key("NE", "NYJ", "soon")


def test_record_pre_roundtrip(path):
    env = ledger.record_pre("NE", "NYJ", "20260909", _pre_record(), path)
    assert env["rows"] == _pre_record()["rows"]
    assert env["recordedAt"]
    game = ledger.load_game("NE", "NYJ", "20260909", path)
    assert game["team"] == "NE" and game["opponent"] == "NYJ"
    assert game["pre"]["meta"]["asOf"] == "2026-09-09"
    # file is valid JSON on disk
    on_disk = json.loads(path.read_text())
    assert on_disk["games"]["20260909|NE|NYJ"]["pre"]["rows"][0]["player"] == "Drake Maye"


def test_record_pre_replaces(path):
    ledger.record_pre("NE", "NYJ", "20260909", _pre_record(), path)
    rec = _pre_record()
    rec["rows"] = [{"player": "X", "stat": "tds", "projection": 1.0}]
    ledger.record_pre("NE", "NYJ", "20260909", rec, path)
    game = ledger.load_game("NE", "NYJ", "20260909", path)
    assert game["pre"]["rows"] == [{"player": "X", "stat": "tds", "projection": 1.0}]


def test_record_pre_rejects_bad_rows(path):
    with pytest.raises(ValueError):
        ledger.record_pre("NE", "NYJ", "20260909", {"rows": "nope"}, path)
    with pytest.raises(ValueError):
        ledger.record_pre("NE", "NYJ", "20260909", {"nrows": []}, path)
    assert ledger.load_game("NE", "NYJ", "20260909", path) is None


def test_record_live_appends_and_caps(path):
    ledger.record_pre("NE", "NYJ", "20260909", _pre_record(), path)
    for q in (1, 2, 3):
        ledger.record_live("NE", "NYJ", "20260909", _live_point(q, 100 + q), path)
    game = ledger.load_game("NE", "NYJ", "20260909", path)
    assert len(game["live"]) == 3
    assert game["live"][-1]["quarters"] == 3
    assert game["live"][-1]["rows"]["Drake Maye"]["passing_yards"] == 103

    ledger.MAX_LIVE_RECORDS = 5
    try:
        for q in range(4, 12):
            ledger.record_live("NE", "NYJ", "20260909", _live_point(q, q), path)
        game = ledger.load_game("NE", "NYJ", "20260909", path)
        assert len(game["live"]) == 5
        assert game["live"][-1]["quarters"] == 11
    finally:
        ledger.MAX_LIVE_RECORDS = 500


def test_record_live_without_pre(path):
    pt = ledger.record_live("NE", "NYJ", "20260909", _live_point(), path)
    assert pt["recordedAt"]
    game = ledger.load_game("NE", "NYJ", "20260909", path)
    assert game["pre"] is None and len(game["live"]) == 1


def test_record_live_rejects_bad_rows(path):
    with pytest.raises(ValueError):
        ledger.record_live("NE", "NYJ", "20260909", {"rows": [1, 2]}, path)


def test_missing_game_and_corrupt_file(path, tmp_path):
    assert ledger.load_game("NE", "NYJ", "20260909", path) is None
    bad = tmp_path / "bad.json"
    bad.write_text("{nope")
    assert ledger.load_game("NE", "NYJ", "20260909", bad) is None
    assert ledger.list_games(path) == []


def test_list_games(path):
    ledger.record_pre("NE", "NYJ", "20260909", _pre_record(), path)
    ledger.record_live("NE", "NYJ", "20260909", _live_point(), path)
    ledger.record_pre("KC", "BUF", "20260910", _pre_record(), path)
    games = ledger.list_games(path)
    assert [g["key"] for g in games] == ["20260909|NE|NYJ", "20260910|KC|BUF"]
    ne = games[0]
    assert ne["hasPre"] and ne["liveCount"] == 1 and not ne["hasFinal"]


def test_status_completed(path):
    ledger.record_live("NE", "NYJ", "20260909",
                       {**_live_point(4), "final": True, "state": "post"}, path)
    game = ledger.load_game("NE", "NYJ", "20260909", path)
    assert ledger.status_completed(game) is True
    assert ledger.list_games(path)[0]["hasFinal"] is True


def _lines_record(*lines):
    return {"source": "hourly-refresh",
            "lines": [{"player": p, "stat": s, "line": ln, "book": "DraftKings"}
                      for p, s, ln in lines]}


def test_record_lines_appends_and_tracks_closing(path):
    ledger.record_pre("NE", "NYJ", "20260909", _pre_record(), path)
    ledger.record_lines("NE", "NYJ", "20260909",
                       _lines_record(("Drake Maye", "passing_yards", 230.5)), path)
    ledger.record_lines("NE", "NYJ", "20260909",
                       _lines_record(("Drake Maye", "passing_yards", 235.5)), path)
    game = ledger.load_game("NE", "NYJ", "20260909", path)
    assert len(game["lines"]) == 2
    # Pre-final: the latest snapshot is the closing-line candidate.
    assert game["finalLines"]["lines"][0]["line"] == 235.5
    assert not game["finalLines"].get("frozen")
    assert ledger.list_games(path)[0]["linesCount"] == 2


def test_record_lines_rejects_bad_rows(path):
    with pytest.raises(ValueError):
        ledger.record_lines("NE", "NYJ", "20260909", {"lines": "nope"}, path)
    with pytest.raises(ValueError):
        ledger.record_lines("NE", "NYJ", "20260909",
                           {"lines": [{"player": "", "stat": "tds"}]}, path)
    assert ledger.load_game("NE", "NYJ", "20260909", path) is None


def test_freeze_final_lines_locks_latest(path):
    ledger.record_lines("NE", "NYJ", "20260909",
                       _lines_record(("Drake Maye", "passing_yards", 230.5)), path)
    frozen = ledger.freeze_final_lines("NE", "NYJ", "20260909", path)
    assert frozen["frozen"] is True
    assert frozen["lines"][0]["line"] == 230.5
    # Later snapshots are stored but must not move the frozen close.
    ledger.record_lines("NE", "NYJ", "20260909",
                       _lines_record(("Drake Maye", "passing_yards", 250.5)), path)
    game = ledger.load_game("NE", "NYJ", "20260909", path)
    assert game["finalLines"]["lines"][0]["line"] == 230.5
    assert len(game["lines"]) == 2
    # Idempotent.
    assert ledger.freeze_final_lines("NE", "NYJ", "20260909", path)["lines"][0]["line"] == 230.5


def test_final_live_point_auto_freezes_closing(path):
    ledger.record_pre("NE", "NYJ", "20260909", _pre_record(), path)
    ledger.record_lines("NE", "NYJ", "20260909",
                       _lines_record(("Drake Maye", "passing_yards", 235.5)), path)
    ledger.record_live("NE", "NYJ", "20260909",
                       {**_live_point(4, 250), "final": True, "state": "post"}, path)
    game = ledger.load_game("NE", "NYJ", "20260909", path)
    assert game["finalLines"]["frozen"] is True
    assert game["finalLines"]["lines"][0]["line"] == 235.5


def test_grade_game_against_closing_lines(path):
    ledger.record_pre("NE", "NYJ", "20260909", _pre_record(), path)
    ledger.record_lines("NE", "NYJ", "20260909",
                       _lines_record(("Drake Maye", "passing_yards", 235.5)), path)
    ledger.record_live("NE", "NYJ", "20260909",
                       {**_live_point(4, 250), "final": True, "state": "post"}, path)
    game = ledger.load_game("NE", "NYJ", "20260909", path)
    grade = ledger.grade_game(game)
    # passing_yards: proj 231.5 vs actual 250 (err 18.5), pre pick under 235.5 -> miss.
    # tds: proj 1.4 vs actual 2 (err 0.6), no line -> graded, unpicked.
    assert grade["n"] == 2
    assert grade["mae"] == pytest.approx((18.5 + 0.6) / 2)
    assert (grade["hits"], grade["picks"], grade["pushes"]) == (0, 1, 0)
    assert grade["hitRate"] == 0.0


def test_grade_ledger_running_totals(path):
    ledger.record_pre("NE", "NYJ", "20260909", _pre_record(), path)
    ledger.record_live("NE", "NYJ", "20260909",
                       {**_live_point(4, 250), "final": True, "state": "post"}, path)
    # Ungraded game (no final) must not pollute the running totals.
    ledger.record_pre("KC", "BUF", "20260910", _pre_record(), path)
    summary = ledger.grade_ledger(path)
    assert summary["games"] == 1 and summary["props"] == 2
    assert summary["hitRate"] is not None
    assert summary["byGame"][0]["key"] == "20260909|NE|NYJ"


def test_record_live_replay_is_idempotent(path):
    # Two views record the same period seconds apart (different clocks) —
    # the second write must not duplicate the point.
    pt = {"quarters": 2, "state": "in", "clock": "3RD 4:12",
          "rows": {"Drake Maye": {"passing_yards": 120}}}
    ledger.record_live("NE", "NYJ", "20260909", pt, path)
    dup = ledger.record_live("NE", "NYJ", "20260909",
                             {**pt, "clock": "3RD 4:05"}, path)
    game = ledger.load_game("NE", "NYJ", "20260909", path)
    assert len(game["live"]) == 1
    assert dup["recordedAt"] == game["live"][0]["recordedAt"]
    # Genuine corrections (changed rows) still append.
    ledger.record_live("NE", "NYJ", "20260909",
                       {"quarters": 2, "state": "in",
                        "rows": {"Drake Maye": {"passing_yards": 135}}}, path)
    assert len(ledger.load_game("NE", "NYJ", "20260909", path)["live"]) == 2
