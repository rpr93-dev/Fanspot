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

from .data_pipeline import (
    PlayerHistory,
    QualityFlag,
    default_seasons,
    fetch_player_history,
    normalize_weekly,
    validate_weekly,
    weekly_is_usable,
)
from .game_script import GameLines, OddsApiLineProvider, StaticLineProvider, script_adjustment
from .model import ModelWeights, Projection, project
from .opponent import defense_allowed, opponent_factor
from .output import projections_table, write_table
from .players import resolve_player_id
from .reliability import DiskCache, cached_fetcher, setup_logging
from .stats import StatSpec, get_stat

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
    p.add_argument("--preseason", action="store_true", help="scale projections to preseason playing time (starters play a fraction of snaps)")
    p.add_argument("--output", help="output path (.json or .csv); default: JSON to stdout")
    p.add_argument("--cache-dir", default="cache", help="disk cache directory (default ./cache)")
    p.add_argument("--no-cache", action="store_true", help="skip the disk cache")
    p.add_argument("--verbose", action="store_true", help="debug logging")
    return p


def _targets_from_args(args) -> list[dict]:
    if args.input:
        path = Path(args.input)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(f"{path} is not valid JSON: {e}") from e
        if not isinstance(raw, list):
            raise ValueError(f"{path} must contain a JSON list of targets, got {type(raw).__name__}")
        out = []
        for i, t in enumerate(raw):
            if not isinstance(t, dict):
                raise ValueError(f"{path}: target {i + 1} must be an object, got {type(t).__name__}")
            for key in ("player", "stat", "team"):
                if not t.get(key):
                    raise ValueError(f"{path}: target {i + 1} is missing required field '{key}'")
            out.append({
                "player": str(t["player"]),
                "stat": str(t["stat"]),
                "team": str(t["team"]),
                "opponent": str(t.get("opponent") or args.opponent or ""),
                # Optional ESPN-style prior line: used when the player has no
                # usable NFL history (rookie / barely played) so we project
                # instead of refusing.
                "prior": t.get("prior"),
            })
        return out
    if args.player and args.stat and args.team:
        return [{"player": args.player, "stat": args.stat, "team": args.team, "opponent": args.opponent or ""}]
    return []


def _load_weekly(args) -> pd.DataFrame:
    if args.weekly:
        path = Path(args.weekly)
        try:
            if path.suffix.lower() == ".csv":
                df = pd.read_csv(path)
            elif path.suffix.lower() in (".pkl", ".pickle"):
                df = pd.read_pickle(path)
            elif path.suffix.lower() == ".parquet":
                df = pd.read_parquet(path)
            else:
                raise ValueError(f"Unsupported weekly file type: {path.suffix} (use .csv/.pkl/.parquet)")
        except ValueError:
            raise
        except Exception as e:  # noqa: BLE001 — name the file that failed to parse
            raise ValueError(f"Could not read weekly file {path}: {e}") from e
        # A wrong-schema file (different export, renamed columns) used to sail
        # through and read as "every player missing". Fail here with the cause.
        return validate_weekly(normalize_weekly(df), source=f"Weekly file {path}")
    # Live pull via nfl_data_py, wrapped in the disk cache + retry. Validation
    # runs *before* the frame is cached so a bad pull never poisons the cache,
    # and cached hits are re-checked so a stale/garbage entry triggers a
    # refetch instead of silently projecting nobody.
    from .data_pipeline import _fetch_weekly_nflverse

    seasons = args.seasons or default_seasons()
    fetch_validated = lambda s: validate_weekly(  # noqa: E731
        normalize_weekly(_fetch_weekly_nflverse(s)), source="nflverse weekly data"
    )
    if args.no_cache:
        return fetch_validated(seasons)
    return cached_fetcher(fetch_validated, DiskCache(args.cache_dir), validator=weekly_is_usable)(seasons)


def _lines_provider(args):
    if args.lines_json:
        path = Path(args.lines_json)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(f"{path} is not valid JSON: {e}") from e
        try:
            lines = {team.upper(): GameLines(**cfg) for team, cfg in raw.items()}
        except (TypeError, AttributeError) as e:
            raise ValueError(f"{path} must be an object of {{team: {{total, spread, favorite}}}}: {e}") from e
        return StaticLineProvider(lines)
    if os.environ.get("ODDS_API_KEY"):
        return OddsApiLineProvider()
    return None


def _weights(args) -> ModelWeights:
    if args.weights_json:
        path = Path(args.weights_json)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(f"{path} is not valid JSON: {e}") from e
        keys = ("halflife", "opponent", "game_script", "min_games")
        try:
            return ModelWeights(**{k: raw[k] for k in keys if k in raw})
        except TypeError as e:
            raise ValueError(f"Bad weights override in {path}: {e}") from e
    return ModelWeights()


def _failed_projection(target: dict, exc: Exception) -> Projection:
    """A refusal row for a target whose projection raised (e.g. unknown stat).

    One bad target must not abort the batch — it becomes an explicit failure
    row (projection null + reason naming the error) while the rest still run.
    """
    stat_key = str(target.get("stat") or "")
    return Projection(
        player_name=str(target.get("player") or "?"),
        stat=StatSpec(
            key=stat_key or "?", label=stat_key or "?", unit="",
            columns=(), positions=(), kind="continuous",
        ),
        projection=None, baseline=None, low=None, high=None,
        confidence="low", n_games=0,
        opponent_factor=None, script_factor=None,
        refused_reason=f"{type(exc).__name__}: {exc}",
        note="target failed — see logs",
    )


def _project_one(target: dict, weekly: pd.DataFrame, lines_provider, weights: ModelWeights, args) -> Projection:
    player, stat = target["player"], target["stat"]
    team, opponent = target["team"].upper(), target["opponent"].upper()
    seasons = args.seasons or default_seasons()

    pid = resolve_player_id(weekly, player, team)
    prior = target.get("prior")
    lines = lines_provider.fetch(team, opponent) if lines_provider else None
    gs = script_adjustment(team, opponent, lines)
    rates = defense_allowed(
        stat, seasons=seasons, teams=[team, opponent],
        window=args.n_games, fetcher=lambda s: weekly,
    )
    opp = opponent_factor(opponent, rates)

    if pid is None:
        # No NFL history at all (rookie, or a name we can't match). If the
        # caller gave us an ESPN-style prior line, project that with a clear
        # note instead of refusing — a number beats a wall of refusals, and
        # the note keeps it honest.
        if prior is not None:
            prior = float(prior)
            # A rookie with zero NFL games has a genuinely wide outcome range —
            # ±50% is honest uncertainty (the ±15% used for thin-but-existing
            # history would falsely imply we know something we don't).
            return Projection(
                player_name=player, stat=get_stat(stat),
                projection=prior, baseline=prior,
                low=round(prior * 0.5, 1), high=round(prior * 1.5, 1),
                confidence="low", n_games=0,
                opponent_factor=round(float(opp.get("factor", 1.0)), 3),
                script_factor=round(float(gs.get("factor", 1.0)), 3),
                refused_reason=None,
                note="ESPN prior — no NFL history (rookie)",
            )
        empty = pd.DataFrame(columns=["season", "week", "game_id", "date", "opponent", "value"])
        hist = PlayerHistory(
            stat=get_stat(stat), player_id="", player_name=player, position="?",
            team=team, n_requested=args.n_games, games=empty, missed_games=empty,
            flags=[QualityFlag("NO_DATA", "error", f"Player '{player}' ({team}) not found in weekly data")],
        )
        return project(hist, opp, gs, weights)

    hist = fetch_player_history(
        pid, stat, n_games=args.n_games, seasons=seasons, fetcher=lambda s: weekly,
    )

    # Player exists but has fewer than min_games of history — blend toward the
    # ESPN prior if we have one, so thin-history players still project (marked
    # low confidence).
    if not hist.ok and prior is not None:
        prior = float(prior)
        # 1-2 games of history: the prior is more trustworthy than a sample of
        # one or two games, but the band stays wider than a full-history line.
        return Projection(
            player_name=player, stat=get_stat(stat),
            projection=prior, baseline=prior,
            low=round(prior * 0.65, 1), high=round(prior * 1.35, 1),
            confidence="low", n_games=hist.n_games,
            opponent_factor=round(float(opp.get("factor", 1.0)), 3),
            script_factor=round(float(gs.get("factor", 1.0)), 3),
            refused_reason=None,
            note="ESPN prior — thin NFL history",
        )

    proj = project(hist, opp, gs, weights)
    if proj.player_name != player:
        # Keep the caller's display name (the dashboard built targets from full
        # names like "C.J. Stroud"; the nflverse file abbreviates to "C.Stroud",
        # which breaks the panel's name-based ESPN-line lookup).
        proj.player_name = player
    if args.preseason and proj.projection is not None:
        # Preseason games: starters play a fraction of snaps, so scale the
        # regular-season-calibrated projection down (same 0.4 factor the
        # /api/props ESPN lines use, keeping both on the same scale).
        f = 0.4
        proj = Projection(
            player_name=proj.player_name, stat=proj.stat,
            projection=proj.projection * f,
            baseline=proj.baseline * f if proj.baseline is not None else None,
            low=proj.low * f if proj.low is not None else None,
            high=proj.high * f if proj.high is not None else None,
            confidence=proj.confidence, n_games=proj.n_games,
            opponent_factor=proj.opponent_factor, script_factor=proj.script_factor,
            refused_reason=proj.refused_reason,
            note=(proj.note + " · " if proj.note else "") + "preseason-adjusted",
        )

    if proj.confidence == "low":
        logger.warning(
            "Low confidence: %s (%s) — %s",
            player, stat, proj.refused_reason or "thin/weak inputs",
        )
    return proj


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    setup_logging(logging.DEBUG if args.verbose else logging.INFO)

    try:
        targets = _targets_from_args(args)
    except ValueError as e:
        logger.error("Bad batch input: %s", e)
        return 2
    if not targets:
        print("Nothing to project: pass --player/--stat/--team/--opponent, or --input", file=sys.stderr)
        return 2

    try:
        weekly = _load_weekly(args)
    except Exception as e:  # noqa: BLE001 — a hard data failure must stop the run
        logger.error("Failed to load weekly data: %s", e)
        return 1

    try:
        lines_provider = _lines_provider(args)
        weights = _weights(args)
    except ValueError as e:
        logger.error("Bad input file: %s", e)
        return 2

    # Per-target isolation: one bad target (unknown stat, bad prior, …) becomes
    # an explicit failure row instead of aborting the batch — the documented
    # contract of this CLI. The failure names its cause in refused_reason.
    projections: list[Projection] = []
    for i, t in enumerate(targets):
        try:
            projections.append(_project_one(t, weekly, lines_provider, weights, args))
        except Exception as e:  # noqa: BLE001 — keep the batch alive
            logger.error(
                "Target %d/%d (%s, %s) failed: %s",
                i + 1, len(targets), t.get("player"), t.get("stat"), e,
            )
            projections.append(_failed_projection(t, e))

    if args.output:
        write_table(projections_table(projections), args.output)
        logger.info("Wrote %d projections to %s", len(projections), args.output)
    else:
        print(json.dumps([p.to_dict() for p in projections], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
