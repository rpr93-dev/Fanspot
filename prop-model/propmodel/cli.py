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
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from .data_pipeline import (
    COL_GAMEDAY,
    COL_POSITION,
    PlayerHistory,
    QualityFlag,
    data_vintage,
    default_seasons,
    fetch_player_history,
    _stat_value,
    normalize_weekly,
    validate_weekly,
    weekly_is_usable,
)
from .game_script import GameLines, OddsApiLineProvider, StaticLineProvider, script_adjustment
from .model import ModelWeights, Projection, position_guard_reason, project
from .opponent import defense_allowed, opponent_factor
from .output import projections_table, write_table
from .players import normalized_names, resolve_player_id
from .reliability import DiskCache, cached_fetcher, setup_logging
from .stats import StatSpec, get_stat
from .teams import normalize_team_code, team_codes_in_frame

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
    p.add_argument("--data-source", choices=["nflverse", "espn"], default="nflverse", help="history source: nflverse (nfl_data_py) or espn (scoreboard+summaries, dashboard-native)")
    p.add_argument("--lines-json", help="static Vegas lines JSON {'HOU': {total, spread, favorite}}")
    p.add_argument("--weights-json", help="ModelWeights override JSON (halflife, opponent, game_script, min_games)")
    p.add_argument("--preseason", action="store_true", help="scale projections to preseason playing time (starters play a fraction of snaps)")
    p.add_argument("--as-of", help="project an event happening on this date (YYYY-MM-DD): uses only data played strictly before it, so same-week games never leak in. Enables walk-forward evaluation.")
    p.add_argument("--warm-cache", action="store_true", help="load (and cache) the weekly data, then exit — used by server warm-up")
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
    if getattr(args, "data_source", "nflverse") == "espn":
        from .espn_fetcher import fetch_weekly_espn_cached

        seasons = args.seasons or default_seasons()
        # ESPN needs at least one full season; default_seasons already spans 4 years.
        df = fetch_weekly_espn_cached(seasons, cache_dir=args.cache_dir)
        if df.empty:
            raise ValueError(f"ESPN fetch for seasons {seasons} returned 0 rows — scoreboard/summary may be down or seasons not started")
        return validate_weekly(normalize_weekly(df), source="ESPN weekly data")
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
    # Normalize again after a cache hit: entries written by older versions may
    # predate schema normalization (e.g. no synthesized gameday), and callers
    # like the freshness stamp need the normalized shape.
    return normalize_weekly(
        cached_fetcher(fetch_validated, DiskCache(args.cache_dir), validator=weekly_is_usable)(seasons)
    )


def _lines_provider(args, known_codes: set[str] | None = None):
    if args.lines_json:
        path = Path(args.lines_json)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(f"{path} is not valid JSON: {e}") from e
        try:
            # Keys are spelled by the caller (often fantasy codes like LAR);
            # normalize them to nflverse spellings so lookups after team-code
            # normalization still hit.
            lines = {normalize_team_code(team, known_codes): GameLines(**cfg) for team, cfg in raw.items()}
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
        keys = (
            "halflife", "opponent", "game_script", "min_games",
            "prior_strength", "opp_shrink", "sd_mult_continuous", "sd_mult_count",
            "halflife_count", "opponent_count", "prior_strength_count",
        )
        try:
            return ModelWeights(**{k: raw[k] for k in keys if k in raw})
        except TypeError as e:
            raise ValueError(f"Bad weights override in {path}: {e}") from e
    return ModelWeights()


def position_prior(weekly: pd.DataFrame, stat: str | StatSpec) -> float | None:
    """Position-level per-player-game average for a stat, from the weekly frame.

    This is the prior thin histories shrink toward (STAGE 4). It is the plain
    league-at-position mean — the value an uninformed projection would carry —
    computed from every recorded player-week at the stat's positions. Returns
    None when the frame has no usable rows at those positions.
    """
    spec = get_stat(stat)
    if COL_POSITION not in weekly.columns:
        return None
    rows = weekly[weekly[COL_POSITION].isin(spec.positions)]
    if rows.empty:
        return None
    vals = rows.apply(lambda r: _stat_value(r, spec), axis=1)
    vals = vals.dropna().astype(float)
    if vals.empty:
        return None
    return float(vals.mean())


def _apply_factors(value: float, opp: dict, gs: dict, weights: ModelWeights) -> float:
    """Scale a raw line by the opponent and game-script factors."""
    return value * (float(opp.get("factor", 1.0)) ** weights.opponent) * (
        float(gs.get("factor", 1.0)) ** weights.game_script
    )


def _prior_projection(
    player: str, stat: str, prior: float, hist: PlayerHistory | None,
    opp: dict, gs: dict, weights: ModelWeights,
) -> Projection:
    """Project from an ESPN-style prior line when NFL history is missing/thin.

    The prior is adjusted for matchup and game context like any other
    projection, and any observed games are blended in weighted against the
    prior's pseudo-games — a raw unadjusted prior would silently ignore both.
    The band stays a wide ±50%: honest uncertainty, not false precision.
    """
    from .model import reliability_score
    spec = get_stat(stat)
    if hist is not None:
        guard = position_guard_reason(hist.position, spec)
        if guard:
            n = hist.n_games
            return Projection(
                player_name=player, stat=spec,
                projection=None, baseline=None, low=None, high=None,
                confidence="low", n_games=n,
                opponent_factor=round(float(opp.get("factor", 1.0)), 3),
                script_factor=round(float(gs.get("factor", 1.0)), 3),
                refused_reason=guard,
                reliability_score=reliability_score(n, False, bool(opp.get("factor")), False, 3, 0, 1),
            )
    n = hist.n_games if hist is not None else 0
    if n > 0:
        m = max(weights.prior_strength, 1.0)
        player_mean = float(hist.games["value"].mean())
        blended = (n * player_mean + m * prior) / (n + m)
        center = _apply_factors(blended, opp, gs, weights)
        note = "ESPN prior — blended with thin NFL history"
        rel = reliability_score(n, hist.ok, bool(opp.get("factor")), any(f.code == "STALE" for f in hist.flags), weights.min_games, 1, 1)
    else:
        center = _apply_factors(prior, opp, gs, weights)
        note = "ESPN prior — no NFL history (rookie)"
        rel = reliability_score(0, False, bool(opp.get("factor")), False, 3, 1, 1)
    return Projection(
        player_name=player, stat=get_stat(stat),
        projection=center, baseline=center,
        low=round(center * 0.5, 1), high=round(center * 1.5, 1),
        confidence="low", n_games=n,
        opponent_factor=round(float(opp.get("factor", 1.0)), 3),
        script_factor=round(float(gs.get("factor", 1.0)), 3),
        refused_reason=None,
        note=note,
        reliability_score=rel,
    )


def _failed_projection(target: dict, exc: Exception) -> Projection:
    """A refusal row for a target whose projection raised (e.g. unknown stat).

    One bad target must not abort the batch — it becomes an explicit failure
    row (projection null + reason naming the error) while the rest still run.
    """
    from .model import reliability_score
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
        reliability_score=0,
    )


class RunMemo:
    """Per-run caches so a batch never repeats identical whole-frame work (F11).

    - ``pids``: player-id resolution results per (player, team).
    - ``name_index``: normalized candidate names for the weekly frame, built
      lazily once and shared by every resolution (one ~50 ms scan per run
      instead of one per target).
    - ``rates``: league-wide defense rates per stat, filtered views per
      matchup (see :func:`_defense_rates_for`).

    Pure caching — nothing here changes any computed value.
    """

    def __init__(self) -> None:
        self.pids: dict[tuple[str, str], str | None] = {}
        self.rates: dict = {}
        self._name_index = None

    def name_index(self, weekly: pd.DataFrame):
        if self._name_index is None:
            self._name_index = normalized_names(weekly)
        return self._name_index


def _resolve_pid(
    memo: RunMemo | None,
    weekly: pd.DataFrame,
    player: str,
    team: str,
) -> str | None:
    """Player-id resolution, memoized per run via the shared name index."""
    if memo is None:
        return resolve_player_id(weekly, player, team)
    key = (player, team)
    if key not in memo.pids:
        memo.pids[key] = resolve_player_id(weekly, player, team, name_index=memo.name_index(weekly))
    return memo.pids[key]


def _defense_rates_for(
    rates_cache: dict | None,
    weekly: pd.DataFrame,
    stat: str | StatSpec,
    seasons: list[int],
    window: int,
    shrink_games: float,
    teams: list[str],
    as_of=None,
) -> pd.DataFrame:
    """:func:`defense_allowed` for ``teams``, memoized per run.

    ``defense_allowed`` computes league-wide rates and only then filters to the
    requested teams, so within a run the expensive per-stat scan of the weekly
    frame (row-wise apply, ~70 ms) can be shared by every target with the same
    stat; only the cheap row filter repeats per matchup. The full table is
    cached keyed by everything that can vary inside one run (stat, seasons,
    window, shrinkage, as-of), and filtered views keyed additionally by the
    teams-set — results are byte-identical to calling ``defense_allowed``
    directly.
    """
    if rates_cache is None:
        return defense_allowed(
            stat, seasons=seasons, teams=teams,
            window=window, fetcher=lambda s: weekly,
            shrink_games=shrink_games, as_of=as_of,
        )

    spec_key = get_stat(stat).key
    cutoff_key = str(as_of) if as_of is not None else None
    full_key = (
        spec_key, tuple(sorted(int(s) for s in seasons)),
        int(window), float(shrink_games), cutoff_key,
    )
    full = rates_cache.get(full_key)
    if full is None:
        full = defense_allowed(
            stat, seasons=seasons, teams=None,
            window=window, fetcher=lambda s: weekly,
            shrink_games=shrink_games, as_of=as_of,
        )
        rates_cache[full_key] = full

    wanted = tuple(sorted({str(t).upper() for t in teams}))
    filter_key = full_key + (wanted,)
    filtered = rates_cache.get(filter_key)
    if filtered is None:
        # Same filter defense_allowed applies for teams=[...] before its final reset_index.
        filtered = full[full["team"].isin(wanted)].reset_index(drop=True)
        rates_cache[filter_key] = filtered
    return filtered


def _project_one(
    target: dict, weekly: pd.DataFrame, lines_provider, weights: ModelWeights, args,
    priors: dict[str, float] | None = None,
    memo: RunMemo | None = None,
    known_codes: set[str] | None = None,
    history_cutoff=None,
) -> Projection:
    player, stat = target["player"], target["stat"]
    # Normalize fantasy/broadcast spellings (LAR→LA, JAX→JAC, …) at the
    # boundary so resolution and rate lookups see nflverse codes.
    team = normalize_team_code(target["team"], known_codes)
    opponent = normalize_team_code(target.get("opponent") or "", known_codes)
    seasons = args.seasons or default_seasons()

    pid = _resolve_pid(memo, weekly, player, team)
    prior = target.get("prior")
    lines = lines_provider.fetch(team, opponent) if lines_provider else None
    gs = script_adjustment(team, opponent, lines)
    rates = _defense_rates_for(
        memo.rates if memo is not None else None, weekly, stat, seasons=seasons,
        window=args.n_games, shrink_games=weights.opp_shrink,
        teams=[team, opponent], as_of=history_cutoff,
    )
    opp = opponent_factor(opponent, rates)

    def _get_prior() -> float | None:
        if prior is None:
            return None
        return float(prior)

    if pid is None:
        # No NFL history at all (rookie, or a name we can't match). If the
        # caller gave us an ESPN-style prior line, project that with a clear
        # note instead of refusing — a number beats a wall of refusals, and
        # the note keeps it honest.
        p = _get_prior()
        if p is not None:
            return _prior_projection(player, stat, p, None, opp, gs, weights)
        empty = pd.DataFrame(columns=["season", "week", "game_id", "date", "opponent", "value"])
        hist = PlayerHistory(
            stat=get_stat(stat), player_id="", player_name=player, position="?",
            team=team, n_requested=args.n_games, games=empty, missed_games=empty,
            flags=[QualityFlag("NO_DATA", "error", f"Player '{player}' ({team}) not found in weekly data")],
        )
        return project(hist, opp, gs, weights)

    hist = fetch_player_history(
        pid, stat, n_games=args.n_games, seasons=seasons, fetcher=lambda s: weekly,
        as_of=history_cutoff,
    )

    # Player exists but has fewer than min_games of usable history — blend
    # toward the ESPN prior if we have one, so thin-history players still
    # project (marked low confidence).
    if not hist.ok and prior is not None:
        return _prior_projection(player, stat, float(prior), hist, opp, gs, weights)

    pos_prior = None
    if priors is not None:
        key = get_stat(stat).key
        if key not in priors:
            # The prior must respect the as-of cut too — a walk-forward
            # projection can't lean on position averages that include the
            # future.
            prior_frame = weekly
            if history_cutoff is not None and COL_GAMEDAY in weekly.columns:
                gd = pd.to_datetime(weekly[COL_GAMEDAY], errors="coerce")
                prior_frame = weekly[gd.isna() | (gd <= pd.Timestamp(history_cutoff))]
            priors[key] = position_prior(prior_frame, stat)
        pos_prior = priors[key]

    proj = project(hist, opp, gs, weights, position_prior=pos_prior, espn_prior=_get_prior())
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
    warm_only = args.warm_cache
    if not targets and not warm_only:
        print("Nothing to project: pass --player/--stat/--team/--opponent, or --input", file=sys.stderr)
        return 2

    history_cutoff = None
    if args.as_of:
        try:
            event_date = date.fromisoformat(str(args.as_of))
        except ValueError:
            logger.error("--as-of must be an ISO date (YYYY-MM-DD), got %r", args.as_of)
            return 2
        # Strictly-before semantics: an event on DATE may not use games played
        # on/after DATE (same-week early games leaking into later ones).
        history_cutoff = event_date - timedelta(days=1)

    try:
        weekly = _load_weekly(args)
    except Exception as e:  # noqa: BLE001 — a hard data failure must stop the run
        logger.error("Failed to load weekly data: %s", e)
        return 1
    if warm_only:
        logger.info("Warm-up complete: %d weekly rows available", len(weekly))
        return 0

    known_codes = team_codes_in_frame(weekly)
    try:
        lines_provider = _lines_provider(args, known_codes)
        weights = _weights(args)
    except ValueError as e:
        logger.error("Bad input file: %s", e)
        return 2

    # Per-target isolation: one bad target (unknown stat, bad prior, …) becomes
    # an explicit failure row instead of aborting the batch — the documented
    # contract of this CLI. The failure names its cause in refused_reason.
    projections: list[Projection] = []
    priors: dict[str, float] = {}
    memo = RunMemo()
    # Track ESPN prior usage per player for reliability scoring
    _espn_used: dict[str, int] = {}  # player -> count of targets that used ESPN prior
    _total_targets: dict[str, int] = {}  # player -> total targets
    _has_espn_input: dict[str, int] = {}  # player -> count of targets with ESPN prior input
    for i, t in enumerate(targets):
        player = t.get("player", "")
        _total_targets[player] = _total_targets.get(player, 0) + 1
        _espn_used.setdefault(player, 0)
        if t.get("prior") is not None:
            _has_espn_input[player] = _has_espn_input.get(player, 0) + 1
        try:
            result = _project_one(
                t, weekly, lines_provider, weights, args, priors,
                memo=memo, known_codes=known_codes, history_cutoff=history_cutoff,
            )
            # Track if ESPN prior was actually used (note mentions ESPN blending)
            if result.note and "ESPN" in result.note:
                _espn_used[player] = _espn_used.get(player, 0) + 1
            projections.append(result)
        except Exception as e:  # noqa: BLE001 — keep the batch alive
            logger.error(
                "Target %d/%d (%s, %s) failed: %s",
                i + 1, len(targets), t.get("player"), t.get("stat"), e,
            )
            projections.append(_failed_projection(t, e))

    if args.output:
        write_table(projections_table(projections, data_through=data_vintage(weekly)), args.output)
        logger.info("Wrote %d projections to %s", len(projections), args.output)
    else:
        from .model import reliability_score as _reliability
        results = []
        for p in projections:
            d = p.to_dict()
            # Count how many of this player's targets had ESPN priors
            total = _total_targets.get(p.player_name, 1)
            with_espn = _espn_used.get(p.player_name, 0)
            d["reliability"] = _reliability(
                n_games=p.n_games,
                history_ok=p.refused_reason is None,
                opp_ok=bool(p.opponent_factor),
                stale_warn=p.note is not None and "STALE" in str(p.note),
                min_games=3,
                espn_lines=_has_espn_input.get(p.player_name, 0),
                total_markets=total,
            )
            results.append(d)
        print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
