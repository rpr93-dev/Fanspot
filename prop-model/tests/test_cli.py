"""STAGE 6 CLI regression tests — run end-to-end against synthetic weekly data.

Covers the failure-isolation contract: the CLI either produces a table where
every row states its status, or exits non-zero naming what failed — never a
plausible-looking wrong answer (e.g. garbage input data reading as "player
not found", or one bad target aborting the whole batch).
"""

from __future__ import annotations

import json

import pandas as pd
import pytest

from propmodel.cli import build_parser, main


@pytest.fixture
def weekly_csv(tmp_path):
    """Synthetic nflverse-style weekly frame with two HOU players × 8 games."""
    rows = []
    for wk in range(1, 9):
        rows.append(dict(
            player_id="00-0033873", player_display_name="C.J. Stroud", player_name="C.J. Stroud",
            position="QB", recent_team="HOU", opponent_team="LV",
            season=2025, week=wk, gameday=f"2025-09-{wk:02d}", games=1,
            game_id=f"2025_0{wk}_HOU_LV",
            passing_yards=200.0 + wk, rushing_yards=10.0, receiving_yards=0.0,
            receptions=0.0, passing_tds=1.5, rushing_tds=0.2, receiving_tds=0.0,
        ))
        rows.append(dict(
            player_id="00-0034787", player_display_name="Nico Collins", player_name="Nico Collins",
            position="WR", recent_team="HOU", opponent_team="JAX",
            season=2025, week=wk, gameday=f"2025-09-{wk:02d}", games=1,
            game_id=f"2025_0{wk}_HOU_JAX",
            passing_yards=0.0, rushing_yards=0.0, receiving_yards=60.0 + wk,
            receptions=4.5, passing_tds=0.0, rushing_tds=0.0, receiving_tds=0.4,
        ))
    path = tmp_path / "weekly.csv"
    pd.DataFrame(rows).to_csv(path, index=False)
    return path


def _run(argv):
    args = build_parser().parse_args(argv)
    return main(argv)


def test_single_player_projects(capsys, tmp_path, weekly_csv):
    code = _run([
        "--player", "C.J. Stroud", "--stat", "passing_yards", "--team", "HOU",
        "--opponent", "LV", "--weekly", str(weekly_csv), "--cache-dir", str(tmp_path / "cache"),
    ])
    assert code == 0
    rows = json.loads(capsys.readouterr().out)
    assert len(rows) == 1
    r = rows[0]
    assert r["projection"] == pytest.approx(204.5, abs=2.0)
    assert r["low"] is not None and r["high"] is not None
    assert r["n_games"] == 8
    assert r["refused_reason"] is None


def test_batch_survives_unknown_stat(capsys, tmp_path, weekly_csv):
    """One unknown stat must become an explicit failure row — not abort the
    batch (which used to lose every other target and write nothing)."""
    batch = tmp_path / "batch.json"
    batch.write_text(json.dumps([
        {"player": "C.J. Stroud", "stat": "passing_yards", "team": "HOU", "opponent": "LV"},
        {"player": "C.J. Stroud", "stat": "passing_tds", "team": "HOU", "opponent": "LV"},
        {"player": "Nico Collins", "stat": "receiving_yards", "team": "HOU", "opponent": "LV"},
    ]), encoding="utf-8")
    code = _run([
        "--input", str(batch), "--weekly", str(weekly_csv),
        "--cache-dir", str(tmp_path / "cache"),
    ])
    assert code == 0
    rows = json.loads(capsys.readouterr().out)
    assert [r["projection"] is not None for r in rows] == [True, False, True]
    bad = rows[1]
    assert bad["refused_reason"] and "Unknown stat 'passing_tds'" in bad["refused_reason"]
    assert bad["note"]


def test_missing_player_is_a_refusal_not_a_crash(capsys, tmp_path, weekly_csv):
    code = _run([
        "--player", "Ghost Player", "--stat", "rushing_yards", "--team", "XXX",
        "--opponent", "LV", "--weekly", str(weekly_csv), "--cache-dir", str(tmp_path / "cache"),
    ])
    assert code == 0
    rows = json.loads(capsys.readouterr().out)
    assert rows[0]["projection"] is None
    assert "not found in weekly data" in rows[0]["refused_reason"]


def test_csv_output_written_with_header(tmp_path, weekly_csv):
    out = tmp_path / "out.csv"
    code = _run([
        "--player", "Nico Collins", "--stat", "receiving_yards", "--team", "HOU",
        "--opponent", "LV", "--weekly", str(weekly_csv),
        "--cache-dir", str(tmp_path / "cache"), "--output", str(out),
    ])
    assert code == 0
    df = pd.read_csv(out)
    assert list(df.columns)[:3] == ["player", "stat", "my_projection"]
    assert "edge" in df.columns
    assert len(df) == 1
    assert df.iloc[0]["my_projection"] > 0


def test_lines_json_changes_projection(capsys, tmp_path, weekly_csv):
    def run_with(lines_path):
        argv = [
            "--player", "C.J. Stroud", "--stat", "passing_yards", "--team", "HOU",
            "--opponent", "LV", "--weekly", str(weekly_csv),
            "--cache-dir", str(tmp_path / "cache"),
        ]
        if lines_path:
            argv += ["--lines-json", str(lines_path)]
        assert _run(argv) == 0
        return json.loads(capsys.readouterr().out)[0]

    base = run_with(None)
    lines = tmp_path / "lines.json"
    lines.write_text(json.dumps({"HOU": {"total": 55.0, "spread": 7.5, "favorite": "HOU"}}), encoding="utf-8")
    favored = run_with(lines)
    assert favored["script_factor"] > base["script_factor"]
    assert favored["projection"] > base["projection"]


def test_garbage_weekly_schema_fails_loudly(tmp_path, caplog):
    """A wrong-schema weekly file used to read as 'player not found' — a
    plausible-looking wrong answer. It must exit non-zero naming the columns."""
    garbage = tmp_path / "garbage.csv"
    garbage.write_text("foo,bar\n1,2\n", encoding="utf-8")
    code = main([
        "--player", "C.J. Stroud", "--stat", "passing_yards", "--team", "HOU",
        "--opponent", "LV", "--weekly", str(garbage), "--cache-dir", str(tmp_path / "cache"),
    ])
    assert code == 1
    assert "missing required column" in caplog.text
    assert "player_id" in caplog.text


def test_empty_weekly_file_fails_loudly(tmp_path, caplog):
    headers_only = tmp_path / "empty.csv"
    headers_only.write_text(
        "player_id,player_name,recent_team,season,week\n", encoding="utf-8"
    )
    code = main([
        "--player", "C.J. Stroud", "--stat", "passing_yards", "--team", "HOU",
        "--opponent", "LV", "--weekly", str(headers_only), "--cache-dir", str(tmp_path / "cache"),
    ])
    assert code == 1
    assert "empty" in caplog.text.lower()


def test_malformed_batch_json_exits_2_naming_file(tmp_path, caplog):
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    code = main([
        "--input", str(bad), "--weekly", str(tmp_path / "whatever.csv"),
    ])
    assert code == 2
    assert "bad.json" in caplog.text


def test_batch_target_missing_required_field_exits_2(tmp_path, caplog, weekly_csv):
    bad = tmp_path / "missing-field.json"
    bad.write_text(json.dumps([{"player": "X", "team": "HOU"}]), encoding="utf-8")
    code = main([
        "--input", str(bad), "--weekly", str(weekly_csv),
        "--cache-dir", str(tmp_path / "cache"),
    ])
    assert code == 2
    assert "'stat'" in caplog.text or "stat" in caplog.text


def test_no_targets_exits_2(capsys):
    assert main([]) == 2
    assert "Nothing to project" in capsys.readouterr().err


def test_corrupt_cache_dir_does_not_wedge_offline_run(tmp_path, weekly_csv):
    """Cache dir with a corrupt entry from a prior live run must not break an
    offline (--weekly) invocation that shares the directory."""
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "deadbeef.pkl").write_bytes(b"\x00garbage")
    code = main([
        "--player", "C.J. Stroud", "--stat", "passing_yards", "--team", "HOU",
        "--opponent", "LV", "--weekly", str(weekly_csv), "--cache-dir", str(cache),
    ])
    assert code == 0


# ---- team-code alias normalization at the CLI boundary (D4/D5) ----

def test_fantasy_team_code_still_matches_nflverse_rows(capsys, tmp_path):
    """The dashboard sends LAR; nflverse rows say LA. Before normalization the
    player fell back to name-only matching and the defense lookup silently
    returned a neutral factor. Both must now hit."""
    rows = []
    for wk in range(1, 9):
        rows.append(dict(
            player_id="00-0099001", player_display_name="Test WR", player_name="Test WR",
            position="WR", recent_team="LA", opponent_team="DET",
            season=2025, week=wk, gameday=f"2025-09-{wk:02d}", games=1,
            game_id=f"2025_0{wk}_LA_DET",
            passing_yards=0.0, rushing_yards=0.0, receiving_yards=90.0,
            receptions=6.0, passing_tds=0.0, rushing_tds=0.0, receiving_tds=0.5,
        ))
        # A DET opponent whose WRs produce, so the LA defense has rates too.
        rows.append(dict(
            player_id="00-0099002", player_display_name="Det WR", player_name="Det WR",
            position="WR", recent_team="DET", opponent_team="LA",
            season=2025, week=wk, gameday=f"2025-09-{wk:02d}", games=1,
            game_id=f"2025_0{wk}_DET_LA",
            passing_yards=0.0, rushing_yards=0.0, receiving_yards=70.0,
            receptions=5.0, passing_tds=0.0, rushing_tds=0.0, receiving_tds=0.4,
        ))
    weekly_csv = tmp_path / "weekly.csv"
    pd.DataFrame(rows).to_csv(weekly_csv, index=False)

    code = main([
        "--player", "Test WR", "--stat", "receiving_yards", "--team", "LAR",
        "--opponent", "DET", "--weekly", str(weekly_csv), "--cache-dir", str(tmp_path / "cache"),
    ])
    assert code == 0
    r = json.loads(capsys.readouterr().out)[0]
    assert r["refused_reason"] is None
    assert r["n_games"] == 8
    # The opponent factor is real (DET allows 90 to the sampled LA WR vs a
    # league avg of 80), not the silent neutral 1.0 the mismatch used to
    # produce.
    assert r["opponent_factor"] != pytest.approx(1.0)
    assert r["opponent_factor"] > 1.0


def test_lines_json_keys_accept_fantasy_codes(capsys, tmp_path, weekly_csv):
    """Lines keyed by fantasy spellings must still apply after normalization."""
    lines = tmp_path / "lines.json"
    lines.write_text(json.dumps({"HOU": {"total": 55.0, "spread": 7.5, "favorite": "HOU"}}), encoding="utf-8")
    argv = [
        "--player", "C.J. Stroud", "--stat", "passing_yards", "--team", "HOU",
        "--opponent", "LV", "--weekly", str(weekly_csv),
        "--cache-dir", str(tmp_path / "cache"), "--lines-json", str(lines),
    ]
    assert _run(argv) == 0
    r = json.loads(capsys.readouterr().out)[0]
    assert r["script_factor"] > 1.0


# ---- as-of plumbing through the CLI (D3) ----

def test_as_of_flag_limits_history_and_rates(capsys, tmp_path):
    """--as-of DATE projects strictly before DATE: later games are invisible to
    both the player history and the defense rates (walk-forward safety)."""
    rows = []
    for wk in range(1, 9):
        gameday = f"2025-{9 if wk <= 4 else 10}-{wk if wk <= 4 else wk - 4:02d}"
        rows.append(dict(
            player_id="00-0077001", player_display_name="Late Bloomer", player_name="Late Bloomer",
            position="QB", recent_team="HOU", opponent_team="LV",
            season=2025, week=wk, gameday=gameday, games=1,
            game_id=f"2025_{wk:02d}_HOU_LV",
            passing_yards=150.0 if wk <= 4 else 400.0, rushing_yards=5.0, receiving_yards=0.0,
            receptions=0.0, passing_tds=1.0, rushing_tds=0.0, receiving_tds=0.0,
        ))
    weekly_csv = tmp_path / "weekly.csv"
    pd.DataFrame(rows).to_csv(weekly_csv, index=False)

    base_argv = [
        "--player", "Late Bloomer", "--stat", "passing_yards", "--team", "HOU",
        "--opponent", "LV", "--weekly", str(weekly_csv), "--cache-dir", str(tmp_path / "c1"),
    ]
    assert _run(base_argv) == 0
    full = json.loads(capsys.readouterr().out)[0]
    assert full["n_games"] == 8
    assert full["projection"] > 280  # includes the 400-yd games

    cut_argv = [
        "--player", "Late Bloomer", "--stat", "passing_yards", "--team", "HOU",
        "--opponent", "LV", "--as-of", "2025-10-01",
        "--weekly", str(weekly_csv), "--cache-dir", str(tmp_path / "c2"),
    ]
    assert _run(cut_argv) == 0
    cut = json.loads(capsys.readouterr().out)[0]
    assert cut["n_games"] == 4   # October games excluded
    assert cut["projection"] < 200


def test_as_of_rejects_non_iso_date(tmp_path, caplog):
    code = main([
        "--player", "X", "--stat", "passing_yards", "--team", "HOU",
        "--opponent", "LV", "--as-of", "not-a-date",
        "--weekly", str(tmp_path / "whatever.csv"), "--cache-dir", str(tmp_path / "cache"),
    ])
    assert code == 2
    assert "YYYY-MM-DD" in caplog.text


def test_position_mismatch_refuses_through_cli(capsys, tmp_path):
    """A CB targeted for receiving yards is refused with a named reason —
    not projected as a confident 0.0 off recorded zero-rows."""
    rows = []
    for wk in range(1, 6):
        rows.append(dict(
            player_id="00-0066001", player_display_name="Slot Corner", player_name="Slot Corner",
            position="CB", recent_team="HOU", opponent_team="LV",
            season=2025, week=wk, gameday=f"2025-09-{wk:02d}", games=1,
            game_id=f"2025_0{wk}_HOU_LV",
            passing_yards=None, rushing_yards=None, receiving_yards=0.0,
            receptions=0.0, passing_tds=None, rushing_tds=None, receiving_tds=None,
        ))
    weekly_csv = tmp_path / "weekly.csv"
    pd.DataFrame(rows).to_csv(weekly_csv, index=False)
    code = main([
        "--player", "Slot Corner", "--stat", "receiving_yards", "--team", "HOU",
        "--opponent", "LV", "--weekly", str(weekly_csv), "--cache-dir", str(tmp_path / "cache"),
    ])
    assert code == 0
    r = json.loads(capsys.readouterr().out)[0]
    assert r["projection"] is None
    assert "POSITION_MISMATCH" in r["refused_reason"]
    assert "CB" in r["refused_reason"]


def test_warm_cache_flag_loads_data_and_exits_zero(capsys, tmp_path, weekly_csv):
    code = main([
        "--warm-cache", "--weekly", str(weekly_csv), "--cache-dir", str(tmp_path / "cache"),
    ])
    assert code == 0


# ---- live-fetch path: validation gates the cache (no network; fetcher patched) ----

@pytest.fixture
def good_live_frame():
    rows = []
    for wk in range(1, 6):
        rows.append(dict(
            player_id="00-0033873", player_display_name="C.J. Stroud", player_name="C.J. Stroud",
            position="QB", recent_team="HOU", opponent_team="LV",
            season=2025, week=wk, gameday=f"2025-09-{wk:02d}", games=1,
            game_id=f"2025_0{wk}_HOU_LV",
            passing_yards=220.0, rushing_yards=10.0, receiving_yards=0.0,
            receptions=0.0, passing_tds=1.5, rushing_tds=0.2, receiving_tds=0.0,
        ))
    return pd.DataFrame(rows)


def _live_argv(cache):
    return [
        "--player", "C.J. Stroud", "--stat", "passing_yards", "--team", "HOU",
        "--opponent", "LV", "--seasons", "2025", "--cache-dir", str(cache),
    ]


def test_live_garbage_fetch_fails_loudly_and_caches_nothing(tmp_path, caplog, monkeypatch):
    """A fetched frame without the pipeline's columns must exit non-zero naming
    the cause — and must not be written into the cache as poison."""
    monkeypatch.setattr("time.sleep", lambda s: None)  # skip retry backoff
    bad = pd.DataFrame({"legacy_col": [1]})
    calls = {"n": 0}

    def fake_fetch(seasons):
        calls["n"] += 1
        return bad

    monkeypatch.setattr("propmodel.data_pipeline._fetch_weekly_nflverse", fake_fetch)
    cache = tmp_path / "cache"
    code = main(_live_argv(cache))
    assert code == 1
    assert "missing required column" in caplog.text
    assert calls["n"] >= 1  # retried, then gave up
    assert list(cache.glob("*")) == []  # nothing cached


def test_live_stale_cached_frame_triggers_refetch(tmp_path, monkeypatch, weekly_csv):
    """A cache entry from an older schema used to be served blindly and every
    player read as 'not found'. Regression: it fails validation and the
    fetcher runs to replace it."""
    from propmodel.reliability import DiskCache, _key

    cache = tmp_path / "cache"
    DiskCache(cache).set(_key("weekly", [2025]), pd.DataFrame({"legacy_col": [1]}))

    fetched = {"n": 0}

    def fake_fetch(seasons):
        fetched["n"] += 1
        return pd.read_csv(weekly_csv)

    monkeypatch.setattr("propmodel.data_pipeline._fetch_weekly_nflverse", fake_fetch)
    argv = _live_argv(cache)
    assert main(argv) == 0
    assert fetched["n"] == 1  # stale entry was replaced by a real fetch
