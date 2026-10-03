"""`python -m propmodel.cli --sport nba` end-to-end on a synthetic frame."""

from __future__ import annotations

import json

import pytest

import propmodel.nba.runner as runner
from propmodel.cli import build_parser, main
from propmodel.output import TABLE_COLUMNS

from test_nba_model import make_frame


@pytest.fixture
def fake_frame(monkeypatch):
    frame = make_frame()
    monkeypatch.setattr(runner, "load_nba_frame", lambda seasons, cache_dir="cache", **kw: frame)
    return frame


def test_sport_defaults_to_nfl():
    assert build_parser().parse_args([]).sport == "nfl"
    assert build_parser().parse_args(["--sport", "nba"]).sport == "nba"


def test_nba_batch_writes_table(tmp_path, fake_frame):
    batch = tmp_path / "batch.json"
    batch.write_text(json.dumps([
        {"player": "Test Star", "stat": "points", "team": "OKC", "opponent": "DEN", "player_id": "1"},
        {"player": "Test Star", "stat": "threes", "team": "OKC", "opponent": "DEN"},
        {"player": "Nobody", "stat": "points", "team": "OKC", "opponent": "DEN"},
    ]), encoding="utf-8")
    lines = tmp_path / "lines.json"
    lines.write_text(json.dumps({"OKC": {"total": 228.5, "spread": 6.5, "favorite": "OKC"}}), encoding="utf-8")
    out = tmp_path / "out.json"
    code = main([
        "--sport", "nba", "--input", str(batch), "--output", str(out),
        "--cache-dir", str(tmp_path / "cache"), "--data-source", "espn",
        "--as-of", "2026-01-20", "--lines-json", str(lines),
    ])
    assert code == 0
    rows = json.loads(out.read_text(encoding="utf-8"))
    assert len(rows) == 3
    assert set(rows[0]) == set(TABLE_COLUMNS)
    assert rows[0]["stat"] == "points" and rows[0]["my_projection"] > 0
    assert rows[0]["p10"] <= rows[0]["p50"] <= rows[0]["p90"]
    assert rows[1]["stat"] == "threes" and rows[1]["my_projection"] > 0
    assert rows[2]["my_projection"] is None and "not found" in rows[2]["refused_reason"]
    # Data vintage stamp = newest box score before the as-of date.
    assert rows[0]["last_updated"].startswith("2025-12-29")


def test_nba_preseason_flag(tmp_path, fake_frame, capsys):
    code = main([
        "--sport", "nba", "--player", "Test Star", "--stat", "assists", "--team", "OKC",
        "--opponent", "DEN", "--preseason", "--as-of", "2026-10-10",
        "--cache-dir", str(tmp_path / "cache"),
    ])
    assert code == 0
    rows = json.loads(capsys.readouterr().out)
    assert rows[0]["projection"] > 0
    assert "preseason-adjusted" in rows[0]["note"]


def test_nba_warm_cache(tmp_path, fake_frame):
    assert main(["--sport", "nba", "--warm-cache", "--cache-dir", str(tmp_path / "cache")]) == 0


def test_nba_bad_batch_exit_2(tmp_path, fake_frame):
    batch = tmp_path / "batch.json"
    batch.write_text(json.dumps([{"player": "X"}]), encoding="utf-8")
    assert main(["--sport", "nba", "--input", str(batch), "--cache-dir", str(tmp_path)]) == 2
