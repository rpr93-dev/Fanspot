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
