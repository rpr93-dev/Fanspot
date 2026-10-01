#!/usr/bin/env python3
"""CLI for the game-day prop ledger (propmodel/ledger.py).

Usage:
  python prop-model-ledger.py pre  --team NE --opponent NYJ --event-date 20260909 --data pre.json
  python prop-model-ledger.py live --team NE --opponent NYJ --event-date 20260909 --data live.json
  python prop-model-ledger.py lines --team NE --opponent NYJ --event-date 20260909 --data lines.json
  python prop-model-ledger.py finalize --team NE --opponent NYJ --event-date 20260909
  python prop-model-ledger.py grade --team NE --opponent NYJ --event-date 20260909
  python prop-model-ledger.py grades
  python prop-model-ledger.py get  --team NE --opponent NYJ --event-date 20260909
  python prop-model-ledger.py list

--data points at a JSON file holding the record object:
  pre   -> {"rows": [...model projection rows...], "asOf": "...", ...meta}
  live  -> {"rows": {"<player>": {"passing_yards": 167, ...}}, "quarters": 2,
            "state": "in"|"post", "final": true|false, ...}
  lines -> {"lines": [{"player": "...", "stat": "...", "line": 232.5, ...}], "source": "..."}
           (hourly pre-game book-line snapshot; the latest pre-final snapshot
           is frozen as the closing lines for grading)
Prints the saved envelope (or game) as JSON to stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from propmodel.ledger import (  # noqa: E402
    freeze_final_lines,
    grade_game,
    grade_ledger,
    list_games,
    load_game,
    read_record_file,
    record_lines,
    record_live,
    record_pre,
)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="prop-model game-day ledger")
    sub = p.add_subparsers(dest="action", required=True)

    for name in ("pre", "live", "get", "lines", "finalize", "grade"):
        sp = sub.add_parser(name, help=f"{name} ledger record")
        sp.add_argument("--team", required=True)
        sp.add_argument("--opponent", required=True)
        sp.add_argument("--event-date", required=True)
        sp.add_argument("--data", default=None,
                        help="JSON file with the record (pre/live/lines only)")
        sp.add_argument("--ledger", default=None,
                        help="override ledger file path (default <prop-model>/ledger/ledger.json)")
    sub.add_parser("list", help="list stored games")
    gp = sub.add_parser("grades", help="running accuracy across graded games")
    gp.add_argument("--ledger", default=None,
                    help="override ledger file path (default <prop-model>/ledger/ledger.json)")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    ledger = Path(args.ledger) if getattr(args, "ledger", None) else None

    if args.action == "list":
        print(json.dumps(list_games(ledger), ensure_ascii=False))
        return 0

    if args.action == "pre":
        if not args.data:
            print("error: --data is required for pre", file=sys.stderr)
            return 2
        out = record_pre(args.team, args.opponent, args.event_date,
                         read_record_file(args.data), ledger)
        print(json.dumps({"ok": True, "rows": len(out["rows"]),
                          "recordedAt": out["recordedAt"]}))
        return 0

    if args.action == "live":
        if not args.data:
            print("error: --data is required for live", file=sys.stderr)
            return 2
        out = record_live(args.team, args.opponent, args.event_date,
                          read_record_file(args.data), ledger)
        print(json.dumps({"ok": True, "recordedAt": out["recordedAt"]}))
        return 0

    if args.action == "get":
        game = load_game(args.team, args.opponent, args.event_date, ledger)
        print(json.dumps(game, ensure_ascii=False))
        return 0

    if args.action == "lines":
        if not args.data:
            print("error: --data is required for lines", file=sys.stderr)
            return 2
        out = record_lines(args.team, args.opponent, args.event_date,
                           read_record_file(args.data), ledger)
        print(json.dumps({"ok": True, "lines": len(out["lines"]),
                          "recordedAt": out["recordedAt"]}))
        return 0

    if args.action == "finalize":
        out = freeze_final_lines(args.team, args.opponent, args.event_date, ledger)
        print(json.dumps({"ok": True, "finalLines": out}, ensure_ascii=False))
        return 0

    if args.action == "grade":
        game = load_game(args.team, args.opponent, args.event_date, ledger)
        print(json.dumps(grade_game(game) if game else None, ensure_ascii=False))
        return 0

    if args.action == "grades":
        print(json.dumps(grade_ledger(ledger), ensure_ascii=False))
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
