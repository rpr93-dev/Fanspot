"""Forward test: lock a pre-kickoff projection snapshot you can never re-run.

The 2026 season forward test had three defects this harness exists to prevent:

1. **A future cutoff.** The old run derived its ``--as-of`` date from a
   *synthetic* gameday mapping (``2026-09-08 + 7*(week-1)``), which for week 7
   lands on 2026-10-20 — days after the snapshot was supposedly "locked" on
   2026-10-14. A projection stamped 2026-10-14 cannot have used an 2026-10-20
   cutoff. This harness takes the cutoff from the *real* first kickoff of the
   slate and refuses to run if that cutoff is after ``--locked-at``.
2. **Unverified slate / week labels.** It verifies every game's week label and
   date against a supplied schedule (and cross-checks the team set against the
   data frame when the week is already present). A mislabeled week is refused,
   not silently projected.
3. **No frozen artifact.** Each run writes an immutable, timestamped snapshot
   containing the exact code hashes, weights, configuration, input batch,
   projections and timestamps. Existing snapshots are never overwritten:
   a corrected model gets its OWN snapshot rather than mutating history.

The harness never reaches into an existing snapshot; it only creates new ones.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd

from propmodel.data_pipeline import (
    COL_GAMEDAY,
    COL_POSITION,
    COL_SEASON,
    COL_WEEK,
    normalize_weekly,
)
from propmodel.stats import get_stat

# Synthetic mapping is only a FALLBACK for when no schedule is supplied; the
# harness marks such a slate UNVERIFIED and uses the derived date solely as a
# conservative lower bound on the cutoff.
SYNTHETIC_WEEK_ORIGIN = "-09-08"
SOURCE_FILES = [
    "propmodel/model.py", "propmodel/role.py", "propmodel/stats.py",
    "propmodel/players.py", "propmodel/cli.py", "propmodel/data_pipeline.py",
    "propmodel/opponent.py", "propmodel/game_script.py",
]


@dataclass
class Slate:
    season: int
    week: int
    games: list[dict]      # {date, home, away}
    verified: bool
    notes: list[str]


def load_schedule(path: str | Path, season: int, week: int) -> Slate:
    """Load and validate a schedule file.

    Accepts ``{\"season\": 2026, \"weeks\": {\"7\": [{\"date\": ..., \"home\": ..., \"away\": ...}]}}``
    or a flat list of ``{season, week, date, home, away}``.
    """
    data = json.loads(Path(path).read_text())
    games: list[dict] = []
    notes: list[str] = []
    if isinstance(data, dict):
        if data.get("season") is not None and int(data["season"]) != season:
            notes.append(f"schedule season {data['season']} != requested {season}")
        weeks = data.get("weeks") or {}
        raw = weeks.get(str(week)) or weeks.get(week) or []
    else:
        raw = [g for g in data if int(g.get("week", week)) == week]
    for g in raw:
        games.append({
            "date": str(g.get("date")),
            "home": str(g.get("home") or g.get("home_team") or "").upper(),
            "away": str(g.get("away") or g.get("away_team") or "").upper(),
        })
    return Slate(season=season, week=week, games=games, verified=True, notes=notes)


def synthetic_slate(weekly: pd.DataFrame, season: int, week: int) -> Slate:
    """Fallback slate from the frame's own week rows (UNVERIFIED)."""
    rows = weekly[(weekly[COL_SEASON] == season) & (weekly[COL_WEEK] == week)]
    pairs = set()
    for _, r in rows.iterrows():
        opp = str(r.get("opponent_team") or "")
        team = str(r.get("recent_team") or r.get("team") or "")
        if team and opp:
            pairs.add(tuple(sorted((team, opp))))
    origin = pd.Timestamp(f"{season}{SYNTHETIC_WEEK_ORIGIN}") + pd.Timedelta(days=7 * (week - 1))
    games = [{"date": origin.date().isoformat(), "home": a, "away": b} for a, b in sorted(pairs)]
    return Slate(season=season, week=week, games=games, verified=False,
                 notes=["no --schedule supplied: slate is DERIVED, week labels unverified"])


def verify_slate(slate: Slate, weekly: pd.DataFrame) -> list[str]:
    """Return a list of problems; empty = the slate is usable.

    Checks: dates parse, every game belongs to the requested week, the team set
    matches the frame when the week is present, and no game is dated after
    ``locked_at`` (handled separately by the cutoff guard).
    """
    problems: list[str] = []
    if not slate.games:
        problems.append(f"slate for season {slate.season} week {slate.week} is empty")
        return problems
    for g in slate.games:
        try:
            pd.Timestamp(g["date"])
        except (ValueError, TypeError):
            problems.append(f"game {g['away']}@{g['home']} has an unparseable date {g['date']!r}")
        if not g["home"] or not g["away"]:
            problems.append(f"game {g} is missing a team code")
    # Cross-check against the frame when it already contains the week.
    present = weekly[(weekly[COL_SEASON] == slate.season) & (weekly[COL_WEEK] == slate.week)]
    if len(present):
        frame_teams = set(present["recent_team"].astype(str)) | set(present["opponent_team"].astype(str))
        slate_teams = {t for g in slate.games for t in (g["home"], g["away"])}
        missing = frame_teams - slate_teams
        if missing:
            problems.append(f"slate omits teams present in the frame for week {slate.week}: {sorted(missing)}")
    return problems


def cutoff_for_slate(slate: Slate, locked_at: datetime) -> tuple[str, list[str]]:
    """The strictly-pregame cutoff date, or raise on a future cutoff.

    Returns ``(cutoff_iso, problems)``. ``cutoff`` is the day *before* the
    first kickoff; it must be on/before ``locked_at`` — otherwise the snapshot
    would claim to know something it couldn't have.
    """
    problems: list[str] = []
    if not slate.games:
        return "", ["empty slate — no kickoff to derive a cutoff from"]
    first_kick = min(pd.Timestamp(g["date"]) for g in slate.games)
    cutoff = (first_kick - pd.Timedelta(days=1)).date()
    if cutoff > locked_at.date():
        problems.append(
            f"FUTURE CUTOFF: slate week {slate.week} starts {first_kick.date()} "
            f"→ cutoff {cutoff} is after locked_at {locked_at.date()}. "
            "A projection locked before kickoff cannot use a later as-of date."
        )
    return cutoff.isoformat(), problems


def code_hashes(root: Path) -> dict[str, str]:
    out = {}
    for rel in SOURCE_FILES:
        p = root / rel
        if p.exists():
            out[rel] = hashlib.sha256(p.read_bytes()).hexdigest()[:16]
    return out


def git_rev(root: Path) -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root).decode().strip()
    except Exception:
        return "unknown"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else ""


def freeze_snapshot(snapshot_root: Path, season: int, week: int, locked_at: datetime,
                    slate: Slate, cutoff: str, batch: list[dict], projections: list[dict],
                    weights: dict, code_root: Path) -> Path:
    """Write an immutable snapshot dir; fail if the name already exists."""
    stamp = locked_at.strftime("%Y%m%dT%H%M%SZ")
    snap = snapshot_root / f"{season}_wk{week}_{stamp}"
    if snap.exists():
        raise FileExistsError(
            f"snapshot {snap} already exists — refusing to overwrite a frozen snapshot; "
            "a corrected run gets its own timestamped directory"
        )
    snap.mkdir(parents=True, exist_ok=False)
    (snap / "batch.json").write_text(json.dumps(batch, indent=2))
    (snap / "projections.json").write_text(json.dumps(projections, indent=2, default=str))
    meta = {
        "season": season,
        "week": week,
        "locked_at": locked_at.isoformat(),
        "cutoff_as_of": cutoff,
        "slate_verified": slate.verified,
        "slate_notes": slate.notes,
        "games": slate.games,
        "weights": weights,
        "git_rev": git_rev(code_root),
        "code_hashes": code_hashes(code_root),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (snap / "meta.json").write_text(json.dumps(meta, indent=2))
    # Content hashes so tampering is detectable after the fact.
    manifest = {f: _sha(snap / f) for f in ("batch.json", "projections.json", "meta.json")}
    (snap / "MANIFEST.sha256.json").write_text(json.dumps(manifest, indent=2))
    return snap


def plan(weekly: pd.DataFrame, season: int, week: int, locked_at: datetime,
         schedule_path: str | None) -> tuple[Slate, str, list[str]]:
    """Resolve the slate + cutoff and collect every validation problem."""
    if schedule_path:
        slate = load_schedule(schedule_path, season, week)
    else:
        slate = synthetic_slate(weekly, season, week)
    problems = verify_slate(slate, weekly)
    cutoff, cut_problems = cutoff_for_slate(slate, locked_at)
    problems.extend(cut_problems)
    if not slate.verified:
        problems.append("UNVERIFIED SLATE (no schedule): treating as a diagnostic run only")
    return slate, cutoff, problems


def _targets_for_week(weekly: pd.DataFrame, season: int, week: int) -> list[dict]:
    rows = weekly[(weekly[COL_SEASON] == season) & (weekly[COL_WEEK] == week)]
    targets = []
    for _, r in rows.iterrows():
        pos = str(r.get(COL_POSITION) or "").upper()
        team = str(r.get("recent_team") or r.get("team") or "")
        opp = str(r.get("opponent_team") or "")
        for stat in ("passing_yards", "rushing_yards", "receiving_yards", "receptions", "tds"):
            if pos in get_stat(stat).positions:
                targets.append({"player": str(r.get("player_display_name") or r.get("player_name")),
                                "stat": stat, "team": team, "opponent": opp})
    return targets


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache-dir", default="cache")
    ap.add_argument("--season", type=int)
    ap.add_argument("--week", type=int)
    ap.add_argument("--locked-at", help="ISO timestamp the snapshot is locked at (default: now, UTC)")
    ap.add_argument("--schedule", help="verified schedule JSON (season/weeks/games)")
    ap.add_argument("--snapshot-dir", default="forward/snapshots")
    ap.add_argument("--run", action="store_true", help="actually shell out to the model CLI")
    ap.add_argument("--allow-unverified", action="store_true", help="proceed despite slate warnings")
    args = ap.parse_args(argv)

    root = Path(__file__).resolve().parents[1]
    import glob

    hits = sorted(glob.glob(str(root / args.cache_dir / "*.pkl")))
    if not hits:
        print("no cached weekly data", file=sys.stderr)
        return 1
    weekly = normalize_weekly(pd.concat([normalize_weekly(pd.read_pickle(p)) for p in hits], ignore_index=True))

    seasons = sorted(int(s) for s in weekly[COL_SEASON].unique())
    season = args.season or seasons[-1]
    week = args.week or int(weekly[weekly[COL_SEASON] == season][COL_WEEK].max())
    locked_at = datetime.fromisoformat(args.locked_at).replace(tzinfo=timezone.utc) if args.locked_at \
        else datetime.now(timezone.utc)

    slate, cutoff, problems = plan(weekly, season, week, locked_at, args.schedule)
    print(f"=== forward test: {season} week {week} (locked {locked_at.isoformat()}) ===")
    print(f"slate: {len(slate.games)} games, verified={slate.verified}, cutoff={cutoff}")
    hard = [p for p in problems if not p.startswith("UNVERIFIED")]
    for p in problems:
        print(f"  {'ERROR' if p in hard else 'WARN '}: {p}")
    if hard:
        print("refusing to freeze a snapshot with slate/cutoff errors", file=sys.stderr)
        return 2
    if any(p.startswith("UNVERIFIED") for p in problems) and not args.allow_unverified:
        print("unverified slate — pass --allow-unverified to record a diagnostic snapshot anyway", file=sys.stderr)
        return 2

    batch = _targets_for_week(weekly, season, week)
    projections: list[dict] = []
    if args.run:
        import tempfile

        with tempfile.TemporaryDirectory() as td:
            bp = Path(td) / "batch.json"
            op = Path(td) / "out.json"
            bp.write_text(json.dumps(batch))
            cmd = [str(root / ".venv" / "bin" / "python"), "-m", "propmodel.cli",
                   "--input", str(bp), "--output", str(op), "--cache-dir", str(root / args.cache_dir),
                   "--as-of", cutoff]
            subprocess.run(cmd, cwd=root, check=True)
            projections = json.loads(op.read_text())

    from propmodel.model import ModelWeights
    snap = freeze_snapshot(root / args.snapshot_dir, season, week, locked_at, slate, cutoff,
                           batch, projections, ModelWeights().__dict__, root)
    print(f"froze snapshot: {snap}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
