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
        game = data["games"].get(key) or {
            "eventDate": normalize_date(event_date),
            "team": normalize_team(team),
            "opponent": normalize_team(opponent),
            "pre": None,
            "live": [],
        }
        game["pre"] = envelope
        data["games"][key] = game
    write_ledger(data, path)
    return envelope


def record_live(team: str, opponent: str, event_date: str, record: dict,
                path: Optional[Path] = None) -> dict:
    """Append one live in-game stat point. Caps the per-game list."""
    if not isinstance(record, dict) or not isinstance(record.get("rows"), dict):
        raise ValueError("live record must be an object with a 'rows' object")
    key = make_key(team, opponent, event_date)
    point = dict(record)
    point["recordedAt"] = record.get("recordedAt") or utcnow_iso()
    with LOCK:
        data = read_ledger(path)
        game = data["games"].get(key) or {
            "eventDate": normalize_date(event_date),
            "team": normalize_team(team),
            "opponent": normalize_team(opponent),
            "pre": None,
            "live": [],
        }
        live = game.get("live") or []
        if len(live) >= MAX_LIVE_RECORDS:
            live = live[-(MAX_LIVE_RECORDS - 1):]
        live.append(point)
        game["live"] = live
        data["games"][key] = game
    write_ledger(data, path)
    return point


def read_record_file(data_path: str) -> Any:
    with open(data_path, "r", encoding="utf-8") as f:
        return json.load(f)
