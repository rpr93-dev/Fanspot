"""Game-day ledger: one pre-game model snapshot + live in-game stat updates per game.

Stored as JSON at ``<prop-model>/ledger/ledger.json`` (git-ignored data dir),
keyed by game key ``YYYYMMDD|TEAM|OPP``. This is the historical record used to
score the prop engine after the fact: pre-game projections vs live progression
vs final actuals. All writes are atomic (tmp file + os.replace); reads and
writes are stdlib-only so the ledger works without pandas/numpy.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

LOCK = threading.Lock()

MAX_LIVE_RECORDS = 500

# Hourly pre-game line snapshots per game (each entry: {recordedAt, lines,
# source}). 200 hourly snapshots cover ~8 days of pre-game movement.
MAX_LINE_SNAPSHOTS = 200

LEDGER_FILENAME = "ledger.json"


def ledger_dir(base: Optional[Path] = None) -> Path:
    """Directory holding the ledger file. Defaults to <prop-model>/ledger."""
    if base is not None:
        return Path(base)
    return Path(__file__).resolve().parents[1] / "ledger"


def ledger_path(base: Optional[Path] = None) -> Path:
    return ledger_dir(base) / LEDGER_FILENAME


def normalize_date(event_date: str) -> str:
    """Accept YYYYMMDD or YYYY-MM-DD (or ISO prefix) -> YYYYMMDD."""
    digits = re.sub(r"\D", "", event_date or "")
    if len(digits) < 8:
        raise ValueError(f"bad event date: {event_date!r}")
    return digits[:8]


def normalize_team(code: str) -> str:
    code = (code or "").strip().upper()
    if not re.fullmatch(r"[A-Z]{1,4}", code):
        raise ValueError(f"bad team code: {code!r}")
    return code


def make_key(team: str, opponent: str, event_date: str) -> str:
    return f"{normalize_date(event_date)}|{normalize_team(team)}|{normalize_team(opponent)}"


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_ledger(path: Optional[Path] = None) -> dict:
    path = Path(path) if path else ledger_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("games"), dict):
            return data
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return {"version": 1, "games": {}}


def write_ledger(data: dict, path: Optional[Path] = None) -> Path:
    """Atomic write (tmp file in same dir + os.replace), process-serialized."""
    path = Path(path) if path else ledger_path()
    with LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".ledger-", suffix=".tmp", dir=str(path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    return path


def load_game(team: str, opponent: str, event_date: str,
              path: Optional[Path] = None) -> Optional[dict]:
    """Return the stored game record, or None."""
    data = read_ledger(path)
    return data["games"].get(make_key(team, opponent, event_date))


def _blank_game(team: str, opponent: str, event_date: str) -> dict:
    return {
        "eventDate": normalize_date(event_date),
        "team": normalize_team(team),
        "opponent": normalize_team(opponent),
        "pre": None,
        "live": [],
        # Hourly book-line snapshots (pre-game refresh cadence) plus the
        # frozen closing snapshot used for grading. Old games predate these
        # keys — every reader must .get() with a default.
        "lines": [],
        "finalLines": None,
    }


def _ensure_line_fields(game: dict) -> dict:
    game.setdefault("lines", [])
    game.setdefault("finalLines", None)
    return game


def list_games(path: Optional[Path] = None) -> list:
    """Compact summaries of every stored game (for the CLI / optimizer)."""
    data = read_ledger(path)
    out = []
    for key, game in data["games"].items():
        out.append({
            "key": key,
            "eventDate": game.get("eventDate"),
            "team": game.get("team"),
            "opponent": game.get("opponent"),
            "hasPre": bool(game.get("pre")),
            "preAt": (game.get("pre") or {}).get("recordedAt"),
            "liveCount": len(game.get("live") or []),
            "hasFinal": status_completed(game),
            "linesCount": len(game.get("lines") or []),
            "hasFinalLines": bool(game.get("finalLines")),
        })
    return sorted(out, key=lambda g: g["key"])


def status_completed(game: dict) -> bool:
    live = game.get("live") or []
    return any((r.get("final") is True) or (r.get("state") == "post") for r in live)


def record_pre(team: str, opponent: str, event_date: str, record: dict,
               path: Optional[Path] = None) -> dict:
    """Save (or replace) the pre-game projection snapshot for a game."""
    if not isinstance(record, dict) or not isinstance(record.get("rows"), list):
        raise ValueError("pre record must be an object with a 'rows' list")
    key = make_key(team, opponent, event_date)
    envelope = {
        "recordedAt": record.get("recordedAt") or utcnow_iso(),
        "rows": record["rows"],
        "meta": {k: v for k, v in record.items() if k not in ("rows", "recordedAt")},
    }
    with LOCK:
        data = read_ledger(path)
        game = _ensure_line_fields(data["games"].get(key) or _blank_game(team, opponent, event_date))
        game["pre"] = envelope
        data["games"][key] = game
    write_ledger(data, path)
    return envelope


def _coerce_line_row(row: Any) -> Optional[dict]:
    """Normalize one book-line row to {player, stat, line, book, over, under}.

    Returns None for rows without a usable (player, stat, positive line).
    Odds-only markets (line 0 / missing over-under) are kept with line=None
    so grading can distinguish "no line" from "line 0".
    """
    if not isinstance(row, dict):
        return None
    player = str(row.get("player") or "").strip()
    stat = str(row.get("stat") or "").strip()
    if not player or not stat:
        return None
    try:
        line = float(row["line"]) if row.get("line") is not None else None
    except (TypeError, ValueError):
        line = None
    if line is not None and not (line > 0):
        line = None
    out = {"player": player, "stat": stat, "line": line}
    for k in ("book", "over", "under", "books"):
        if row.get(k) is not None:
            out[k] = row[k]
    return out


def record_lines(team: str, opponent: str, event_date: str, record: dict,
                 path: Optional[Path] = None) -> dict:
    """Append one timestamped book-line snapshot (hourly pre-game refresh).

    ``record``: {"lines": [{player, stat, line, book?, over?, under?}, ...],
                 "source"?: str, "recordedAt"?: iso}.
    Snapshots are append-only and capped at MAX_LINE_SNAPSHOTS; once
    ``finalLines`` is frozen (see freeze_final_lines) new snapshots are still
    stored but no longer move the frozen closing lines.
    """
    if not isinstance(record, dict) or not isinstance(record.get("lines"), list):
        raise ValueError("lines record must be an object with a 'lines' list")
    rows = []
    for r in record["lines"]:
        coerced = _coerce_line_row(r)
        if coerced is None:
            raise ValueError(f"bad line row: {r!r}")
        rows.append(coerced)
    key = make_key(team, opponent, event_date)
    snapshot = {
        "recordedAt": record.get("recordedAt") or utcnow_iso(),
        "source": record.get("source") or "scraper",
        "lines": rows,
    }
    with LOCK:
        data = read_ledger(path)
        game = _ensure_line_fields(data["games"].get(key) or _blank_game(team, opponent, event_date))
        snaps = game.get("lines") or []
        if len(snaps) >= MAX_LINE_SNAPSHOTS:
            snaps = snaps[-(MAX_LINE_SNAPSHOTS - 1):]
        snaps.append(snapshot)
        game["lines"] = snaps
        # Pre-final: the latest snapshot doubles as the closing-line
        # candidate. Once frozen, finalLines stays put.
        if not game.get("finalLines"):
            game["finalLines"] = snapshot
        elif not (game.get("finalLines") or {}).get("frozen"):
            game["finalLines"] = snapshot
        data["games"][key] = game
    write_ledger(data, path)
    return snapshot


def freeze_final_lines(team: str, opponent: str, event_date: str,
                       path: Optional[Path] = None) -> Optional[dict]:
    """Freeze the closing lines: the most recent snapshot before the game ended.

    Idempotent — a second call returns the already-frozen snapshot. Returns
    None when no line snapshot exists yet.
    """
    key = make_key(team, opponent, event_date)
    with LOCK:
        data = read_ledger(path)
        game = _ensure_line_fields(data["games"].get(key) or _blank_game(team, opponent, event_date))
        current = game.get("finalLines")
        if current and current.get("frozen"):
            return current
        snaps = game.get("lines") or []
        # Fall back to the pre-snapshot's embedded lines (older games that
        # never recorded hourly snapshots still get a gradeable closing line).
        if not snaps:
            pre_rows = ((game.get("pre") or {}).get("rows")) or []
            fallback = [r for r in (_coerce_line_row(r) for r in pre_rows) if r and r.get("line")]
            if not fallback:
                return None
            frozen = {"recordedAt": (game.get("pre") or {}).get("recordedAt") or utcnow_iso(),
                      "source": "pre-snapshot", "lines": fallback, "frozen": True}
            game["finalLines"] = frozen
            data["games"][key] = game
            write_ledger(data, path)
            return frozen
        latest = snaps[-1]
        frozen = {**latest, "frozen": True}
        game["finalLines"] = frozen
        data["games"][key] = game
    write_ledger(data, path)
    return frozen


def record_live(team: str, opponent: str, event_date: str, record: dict,
                path: Optional[Path] = None) -> dict:
    """Append one live in-game stat point. Caps the per-game list."""
    if not isinstance(record, dict) or not isinstance(record.get("rows"), dict):
        raise ValueError("live record must be an object with a 'rows' object")
    key = make_key(team, opponent, event_date)
    point = dict(record)
    point["recordedAt"] = record.get("recordedAt") or utcnow_iso()
    is_final = point.get("final") is True or point.get("state") == "post"
    with LOCK:
        data = read_ledger(path)
        game = _ensure_line_fields(data["games"].get(key) or _blank_game(team, opponent, event_date))
        live = game.get("live") or []
        # Idempotent replay: two views (team page + game page) record the same
        # period independently, seconds apart (different clocks). A point
        # matching the last one in period/state/final + payload is a
        # duplicate, not new information. Genuine corrections (changed rows)
        # still append.
        def _sig(p: dict) -> str:
            return json.dumps({
                "quarters": p.get("quarters"),
                "state": p.get("state"),
                "final": p.get("final"),
                "rows": p.get("rows"),
                "substitutions": p.get("substitutions"),
                "backupProjections": p.get("backupProjections"),
            }, sort_keys=True, default=str)
        if live and _sig(live[-1]) == _sig(point):
            return live[-1]
        if len(live) >= MAX_LIVE_RECORDS:
            live = live[-(MAX_LIVE_RECORDS - 1):]
        live.append(point)
        game["live"] = live
        if is_final:
            # Lock the closing lines to the most recent pre-final snapshot so
            # post-game refreshes can't rewrite what the model is graded on.
            snaps = game.get("lines") or []
            if snaps and not ((game.get("finalLines") or {}).get("frozen")):
                game["finalLines"] = {**snaps[-1], "frozen": True}
            elif not game.get("finalLines"):
                pre_rows = ((game.get("pre") or {}).get("rows")) or []
                fallback = [r for r in (_coerce_line_row(r) for r in pre_rows) if r and r.get("line")]
                if fallback:
                    game["finalLines"] = {
                        "recordedAt": (game.get("pre") or {}).get("recordedAt") or utcnow_iso(),
                        "source": "pre-snapshot", "lines": fallback, "frozen": True,
                    }
        data["games"][key] = game
    write_ledger(data, path)
    return point


def _final_actuals(game: dict) -> dict:
    """Player -> stat -> actual from the latest final live point.

    Only completed games grade (a point with ``final: true`` or ``state:
    'post'``) — grading a mid-game point against partial stats would pollute
    the running accuracy.
    """
    live = game.get("live") or []
    finals = [p for p in live if p.get("final") is True or p.get("state") == "post"]
    if not finals:
        return {}
    rows = finals[-1].get("rows") or {}
    return rows if isinstance(rows, dict) else {}


def _closing_line_map(game: dict) -> dict:
    """(player, stat) -> closing line from frozen finalLines (or latest)."""
    final = game.get("finalLines")
    if not final:
        snaps = game.get("lines") or []
        final = snaps[-1] if snaps else None
    if not final:
        # Oldest games: lines live only on the pre rows.
        pre_rows = ((game.get("pre") or {}).get("rows")) or []
        out: dict = {}
        for r in pre_rows:
            c = _coerce_line_row(r)
            if c and c.get("line"):
                out[(c["player"], c["stat"])] = c["line"]
        return out
    out = {}
    for r in (final.get("lines") or []):
        if isinstance(r, dict) and r.get("player") and r.get("stat") and r.get("line"):
            out[(r["player"], r["stat"])] = r["line"]
    return out


def grade_game(game: dict) -> Optional[dict]:
    """Grade one game's pre snapshot vs final actuals at the closing lines.

    Returns None when the game has no pre rows or no final actuals yet.
    Per row: projection error |actual - projection|, book pick (pre pick when
    present, else projection vs closing line), hit/miss/push.
    """
    pre_rows = ((game.get("pre") or {}).get("rows")) or []
    if not pre_rows:
        return None
    actuals = _final_actuals(game)
    if not actuals:
        return None
    closing = _closing_line_map(game)
    rows = []
    for r in pre_rows:
        if not isinstance(r, dict):
            continue
        player, stat = r.get("player"), r.get("stat")
        proj = r.get("projection")
        if not player or not stat or not isinstance(proj, (int, float)):
            continue
        per = actuals.get(player) if isinstance(actuals.get(player), dict) else None
        actual = per.get(stat) if per else None
        if not isinstance(actual, (int, float)):
            continue
        line = closing.get((player, stat))
        if line is None and isinstance(r.get("line"), (int, float)) and r["line"] > 0:
            line = r["line"]
        pick = r.get("pick") if r.get("pick") in ("over", "under") else None
        if pick is None and isinstance(line, (int, float)):
            pick = "over" if proj >= line else "under"
        outcome = None
        if pick and isinstance(line, (int, float)):
            if actual == line:
                outcome = "push"
            else:
                outcome = "hit" if ((pick == "over") == (actual > line)) else "miss"
        rows.append({
            "player": player, "stat": stat,
            "projection": proj, "actual": actual,
            "absError": abs(actual - proj),
            "line": line, "pick": pick, "outcome": outcome,
        })
    if not rows:
        return None
    scored = [r for r in rows if r["outcome"] in ("hit", "miss")]
    return {
        "rows": rows,
        "n": len(rows),
        "mae": sum(r["absError"] for r in rows) / len(rows),
        "picks": len(scored) + sum(1 for r in rows if r["outcome"] == "push"),
        "hits": sum(1 for r in rows if r["outcome"] == "hit"),
        "pushes": sum(1 for r in rows if r["outcome"] == "push"),
        "hitRate": (sum(1 for r in rows if r["outcome"] == "hit") / len(scored)) if scored else None,
    }


def grade_ledger(path: Optional[Path] = None) -> dict:
    """Running accuracy across every graded game in the ledger."""
    data = read_ledger(path)
    games = []
    all_rows: list = []
    for key in sorted(data["games"]):
        g = grade_game(data["games"][key])
        if not g:
            continue
        games.append({"key": key,
                      "eventDate": data["games"][key].get("eventDate"),
                      "team": data["games"][key].get("team"),
                      "opponent": data["games"][key].get("opponent"),
                      **{k: v for k, v in g.items() if k != "rows"}})
        all_rows.extend(g["rows"])
    scored = [r for r in all_rows if r["outcome"] in ("hit", "miss")]
    return {
        "games": len(games),
        "props": len(all_rows),
        "mae": (sum(r["absError"] for r in all_rows) / len(all_rows)) if all_rows else None,
        "picks": len(scored) + sum(1 for r in all_rows if r["outcome"] == "push"),
        "hits": sum(1 for r in all_rows if r["outcome"] == "hit"),
        "pushes": sum(1 for r in all_rows if r["outcome"] == "push"),
        "hitRate": (sum(1 for r in all_rows if r["outcome"] == "hit") / len(scored)) if scored else None,
        "byGame": games,
    }


def read_record_file(data_path: str) -> Any:
    with open(data_path, "r", encoding="utf-8") as f:
        return json.load(f)
