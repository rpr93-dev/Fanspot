"""STAGE 6 — CLI: run the pipeline end-to-end, cron-safe.

Examples
--------
    # Single player:
    python -m propmodel.cli --player "C.J. Stroud" --stat passing_yards --team HOU --opponent LV

    # Batch from a JSON file, offline weekly data, static lines, JSON output:
    python -m propmodel.cli --input batch.json --weekly weekly.csv --lines-json lines.json --output out.json

    # Batch input format:
    #   [{"player": "C.J. Stroud", "stat": "passing_yards", "team": "HOU", "opponent": "LV"},
    #    {"player": "Nico Collins", "stat": "receiving_yards", "team": "HOU", "opponent": "LV"}]

Exits 0 on success, 1 on a hard failure (e.g. weekly data can't load), 2 on
bad arguments. Individual players who can't be projected are logged and
returned with ``projection: null`` rather than aborting the batch — so a cron
job notices failures in the log without losing the rest of the run.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import pandas as pd

from .data_pipeline import PlayerHistory, QualityFlag, default_seasons, fetch_player_history
from .game_script import GameLines, OddsApiLineProvider, StaticLineProvider, script_adjustment
from .model import ModelWeights, Projection, project
from .opponent import defense_allowed, opponent_factor
from .output import projections_table, write_table
from .players import resolve_player_id
from .reliability import DiskCache, cached_fetcher, setup_logging
from .stats import get_stat

logger = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="NFL player prop projection pipeline")
    p.add_argument("--player", help="player display name (single-run mode)")
    p.add_argument("--stat", help="stat key: passing_yards, rushing_yards, receiving_yards, receptions, tds")
    p.add_argument("--team", help="player's 3-letter team code (e.g. HOU)")
    p.add_argument("--opponent", help="upcoming opponent 3-letter team code (e.g. LV)")
    p.add_argument("--input", help="batch JSON file: list of {player, stat, team, opponent}")
    p.add_argument("--n-games", type=int, default=8, help="recent games to model (default 8)")
    p.add_argument("--seasons", nargs="*", type=int, help="seasons to pull, e.g. 2025 2026")
    p.add_argument("--weekly", help="offline weekly file (csv/pkl/parquet) instead of nfl_data_py")
    p.add_argument("--lines-json", help="static Vegas lines JSON {'HOU': {total, spread, favorite}}")
    p.add_argument("--weights-json", help="ModelWeights override JSON (halflife, opponent, game_script, min_games)")
    p.add_argument("--output", help="output path (.json or .csv); default: JSON to stdout")
    p.add_argument("--cache-dir", default="cache", help="disk cache directory (default ./cache)")
    p.add_argument("--no-cache", action="store_true", help="skip the disk cache")
    p.add_argument("--verbose", action="store_true", help="debug logging")
    return p


def _targets_from_args(args) -> list[dict]:
    if args.input:
        raw = json.loads(Path(args.input).read_text(encoding="utf-8"))
        out = []
        for t in raw:
            out.append({
                "player": str(t["player"]),
                "stat": str(t["stat"]),
                "team": str(t["team"]),
                "opponent": str(t.get("opponent") or args.opponent or ""),
            })
        return out
    if args.player and args.stat and args.team:
        return [{"player": args.player, "stat": args.stat, "team": args.team, "opponent": args.opponent or ""}]
    return []


def _load_weekly(args) -> pd.DataFrame:
    if args.weekly:
        path = Path(args.weekly)
        if path.suffix.lower() == ".csv":
            return pd.read_csv(path)
        if path.suffix.lower() in (".pkl", ".pickle"):
            return pd.read_pickle(path)
        if path.suffix.lower() == ".parquet":
            return pd.read_parquet(path)
        raise ValueError(f"Unsupported weekly file type: {path.suffix} (use .csv/.pkl/.parquet)")
    # Live pull via nfl_data_py, wrapped in the disk cache + retry.
    from .data_pipeline import _fetch_weekly_nflverse, normalize_weekly

    seasons = args.seasons or default_seasons()
    if args.no_cache:
        return normalize_weekly(_fetch_weekly_nflverse(seasons))
    return normalize_weekly(cached_fetcher(_fetch_weekly_nflverse, DiskCache(args.cache_dir))(seasons))


def _lines_provider(args):
    if args.lines_json:
        raw = json.loads(Path(args.lines_json).read_text(encoding="utf-8"))
        lines = {team.upper(): GameLines(**cfg) for team, cfg in raw.items()}
        return StaticLineProvider(lines)
    if os.environ.get("ODDS_API_KEY"):
        return OddsApiLineProvider()
    return None


def _weights(args) -> ModelWeights:
    if args.weights_json:
        raw = json.loads(Path(args.weights_json).read_text(encoding="utf-8"))
        keys = ("halflife", "opponent", "game_script", "min_games")
        return ModelWeights(**{k: raw[k] for k in keys if k in raw})
    return ModelWeights()


def _project_one(target: dict, weekly: pd.DataFrame, lines_provider, weights: ModelWeights, args) -> Projection:
    player, stat = target["player"], target["stat"]
    team, opponent = target["team"].upper(), target["opponent"].upper()
    seasons = args.seasons or default_seasons()

    pid = resolve_player_id(weekly, player, team)
    if pid is None:
        # Refuse cleanly: a NO_DATA history flows through the same refusal path.
        empty = pd.DataFrame(columns=["season", "week", "game_id", "date", "opponent", "value"])
        hist = PlayerHistory(
            stat=get_stat(stat), player_id="", player_name=player, position="?",
            team=team, n_requested=args.n_games, games=empty, missed_games=empty,
            flags=[QualityFlag("NO_DATA", "error", f"Player '{player}' ({team}) not found in weekly data")],
        )
        return project(hist, 1.0, {"available": False, "factor": 1.0}, weights)

    hist = fetch_player_history(
        pid, stat, n_games=args.n_games, seasons=seasons, fetcher=lambda s: weekly,
    )
    rates = defense_allowed(
        stat, seasons=seasons, teams=[team, opponent],
        window=args.n_games, fetcher=lambda s: weekly,
    )
    opp = opponent_factor(opponent, rates)
    lines = lines_provider.fetch(team, opponent) if lines_provider else None
    gs = script_adjustment(team, opponent, lines)
    proj = project(hist, opp, gs, weights)

    if proj.confidence == "low":
        logger.warning(
            "Low confidence: %s (%s) — %s",
            player, stat, proj.refused_reason or "thin/weak inputs",
        )
    return proj


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    setup_logging(logging.DEBUG if args.verbose else logging.INFO)

    targets = _targets_from_args(args)
    if not targets:
        print("Nothing to project: pass --player/--stat/--team/--opponent, or --input", file=sys.stderr)
        return 2

    try:
        weekly = _load_weekly(args)
    except Exception as e:  # noqa: BLE001 — a hard data failure must stop the run
        logger.error("Failed to load weekly data: %s", e)
        return 1

    lines_provider = _lines_provider(args)
    weights = _weights(args)

    projections = [_project_one(t, weekly, lines_provider, weights, args) for t in targets]

    if args.output:
        write_table(projections_table(projections), args.output)
        logger.info("Wrote %d projections to %s", len(projections), args.output)
    else:
        print(json.dumps([p.to_dict() for p in projections], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
