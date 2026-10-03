"""``python -m propmodel.cli --sport nba ...`` entry point.

Batch targets: ``[{player, stat, team, opponent, player_id?}, ...]`` with stat in
points/rebounds/assists/threes. Lines JSON: ``{TEAM: {total, spread, favorite}}``
(same shape as NFL; any NBA spelling of the codes is accepted). Output is the
shared ``projections_table`` schema (TABLE_COLUMNS), so the API route and the
ledger treat NBA rows exactly like NFL rows.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import date, timedelta
from pathlib import Path

from ..game_script import GameLines
from ..model import FullProjection
from ..output import projections_table, write_table
from ..stats import StatSpec
from .fetcher import default_nba_seasons, load_nba_frame
from .model import NBAContext, NBAWeights, get_nba_stat, project_nba, refusal
from .players import NameIndex, resolve_nba_player
from .teams import normalize_nba_team

logger = logging.getLogger(__name__)


def nba_targets(args) -> list[dict]:
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
            pid = t.get("player_id")
            out.append({
                "player": str(t["player"]),
                "stat": str(t["stat"]),
                "team": str(t["team"]),
                "opponent": str(t.get("opponent") or args.opponent or ""),
                "player_id": None if pid in (None, "") else str(pid),
            })
        return out
    if args.player and args.stat and args.team:
        return [{"player": args.player, "stat": args.stat, "team": args.team,
                 "opponent": args.opponent or "", "player_id": None}]
    return []


def nba_lines(path: str | None) -> dict[str, GameLines]:
    if not path:
        return {}
    p = Path(path)
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"{p} is not valid JSON: {e}") from e
    try:
        out = {}
        for team, cfg in raw.items():
            fav = cfg.get("favorite")
            out[normalize_nba_team(team)] = GameLines(
                total=float(cfg["total"]), spread=abs(float(cfg.get("spread") or 0.0)),
                favorite=normalize_nba_team(fav) if fav else None,
            )
        return out
    except (TypeError, AttributeError, KeyError, ValueError) as e:
        raise ValueError(f"{p} must be an object of {{team: {{total, spread, favorite}}}}: {e}") from e


def _failed(target: dict, exc: Exception) -> FullProjection:
    key = str(target.get("stat") or "?")
    spec = StatSpec(key=key, label=key, unit="", columns=(), positions=(), kind="count")
    return refusal(str(target.get("player") or "?"), spec, f"{type(exc).__name__}: {exc}", note="target failed — see logs")


def project_targets(frame, targets: list[dict], lines: dict[str, GameLines], event_date: date | None,
                    cutoff: date | None, preseason: bool, weights: NBAWeights | None = None) -> tuple[list[FullProjection], NBAContext]:
    ctx = NBAContext(frame, cutoff=cutoff)
    index = NameIndex(ctx.history)
    w = weights or NBAWeights()
    resolved: dict[tuple, object] = {}
    out: list[FullProjection] = []
    for t in targets:
        try:
            spec = get_nba_stat(t["stat"])
            team = normalize_nba_team(t.get("team"))
            opp = normalize_nba_team(t.get("opponent"))
            rkey = (t["player"], team, t.get("player_id"))
            if rkey not in resolved:
                resolved[rkey] = resolve_nba_player(index, t["player"], team, t.get("player_id"))
            res = resolved[rkey]
            if res.player_id is None:
                out.append(refusal(t["player"], spec, res.refused_reason or "not found"))
                continue
            gl = lines.get(team) or lines.get(opp)
            proj = project_nba(
                ctx, res.player_id, t["player"], spec, team, opp, lines=gl,
                event_date=event_date, preseason=preseason, w=w,
                extra_warnings=[res.warning] if res.warning else None,
            )
            if proj.confidence == "low":
                logger.warning("Low confidence: %s (%s) — %s", t["player"], spec.key, proj.refused_reason or "thin/weak inputs")
            out.append(proj)
        except Exception as e:  # noqa: BLE001 — one bad target never aborts the batch
            logger.error("NBA target (%s, %s) failed: %s", t.get("player"), t.get("stat"), e)
            out.append(_failed(t, e))
    return out, ctx


def run_nba(args) -> int:
    if getattr(args, "data_source", "espn") not in (None, "espn"):
        logger.info("NBA uses ESPN box scores only; ignoring --data-source %s", args.data_source)
    if getattr(args, "weights_json", None):
        logger.info("NBA ignores --weights-json (NFL ModelWeights)")
    if getattr(args, "weekly", None):
        logger.error("--weekly is NFL-only")
        return 2
    try:
        targets = nba_targets(args)
    except ValueError as e:
        logger.error("Bad batch input: %s", e)
        return 2
    if not targets and not args.warm_cache:
        print("Nothing to project: pass --player/--stat/--team/--opponent, or --input", file=sys.stderr)
        return 2

    event_date = cutoff = None
    if args.as_of:
        try:
            event_date = date.fromisoformat(str(args.as_of))
        except ValueError:
            logger.error("--as-of must be an ISO date (YYYY-MM-DD), got %r", args.as_of)
            return 2
        cutoff = event_date - timedelta(days=1)

    seasons = args.seasons or default_nba_seasons(event_date)
    try:
        frame = load_nba_frame(seasons, cache_dir=args.cache_dir)
    except Exception as e:  # noqa: BLE001
        logger.error("Failed to load NBA box scores: %s", e)
        return 1
    if frame.empty:
        logger.error("ESPN NBA fetch for seasons %s returned 0 rows — scoreboard/summary may be down", seasons)
        return 1
    if args.warm_cache:
        logger.info("NBA warm-up complete: %d player-game rows (%d games)", len(frame), frame["game_id"].nunique())
        return 0

    try:
        lines = nba_lines(args.lines_json)
    except ValueError as e:
        logger.error("Bad input file: %s", e)
        return 2

    projections, ctx = project_targets(frame, targets, lines, event_date, cutoff, bool(args.preseason))
    if args.output:
        write_table(projections_table(projections, data_through=ctx.data_through), args.output)
        logger.info("Wrote %d NBA projections to %s", len(projections), args.output)
    else:
        print(json.dumps([p.to_dict() for p in projections], indent=2, default=str))
    return 0
