"""Hourly prop-line refresh (cron-safe, all sports).

Keeps DraftKings lines fresh in the hour-by-hour run-up to first pitch /
kickoff / tip-off / puck drop and banks the closing snapshot used for grading:

  1. Finds pre-game games kicking off within --hours (default 168 = 7d):
     NFL via /api/schedule-week (current + next two slates), NBA/NHL/MLB via
     ESPN's public scoreboard feed (one call per day in the window).
  2. Per game: POST /api/scraper (fresh DK lines from the Docker scraper),
     flatten the props to closing-line rows, POST them to /api/prop-ledger
     as a `lines` snapshot (append-only, capped server-side).
  3. For games now FINAL: POST /api/prop-ledger `finalize` so the most recent
     pre-final snapshot is frozen as the closing lines for the running grade.

Snapshots are cheap and idempotent — running this hourly is the intended
cadence (cron: `0 * * * * .../prop-model/line-refresh.sh`). Games already
final are scrape-skipped (books pull the slate) but still finalized.

Usage: .venv/bin/python line_refresh.py [--hours 168] [--base http://localhost:3000]
"""

import argparse
import datetime as dt
import json
import sys
import urllib.request

SCRAPE_TIMEOUT = 180
GET_TIMEOUT = 60

# ESPN scoreboard league paths for the non-NFL sports (schedule-week is NFL-only).
SCOREBOARD_SPORTS = {
    "NBA": "basketball/nba",
    "NHL": "hockey/nhl",
    "MLB": "baseball/mlb",
}


def get(base, path, timeout=GET_TIMEOUT):
    with urllib.request.urlopen(base + path, timeout=timeout) as r:
        return json.load(r)


def get_json(url, timeout=GET_TIMEOUT):
    req = urllib.request.Request(url, headers={"User-Agent": "Fanspot-line-refresh/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def post(base, path, body, timeout=SCRAPE_TIMEOUT):
    req = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _flatten_scrape(results):
    """Scraper payload -> closing-line rows.

    Keeps only real O/U lines (positive line + both sides' odds), mirroring
    the panel rules. The ledger freezes the raw snapshot; resolving one
    closing number per player+stat happens at grade time via the pre row /
    latest snapshot.
    """
    books = (results or {}).get("results") or {}
    rows = []
    for book_key, b in books.items():
        for p in (b or {}).get("props") or []:
            try:
                line = float(p.get("line"))
            except (TypeError, ValueError):
                continue
            if not (line > 0):
                continue
            if p.get("over") is None or p.get("under") is None:
                continue
            if not p.get("player") or not p.get("stat"):
                continue
            market = str(p.get("market") or "").lower()
            if "+" in market or "most" in market:
                continue
            rows.append({
                "player": p["player"],
                "stat": str(p["stat"]).lower(),
                "line": line,
                "book": p.get("sportsbook") or book_key,
                "over": p.get("over"),
                "under": p.get("under"),
            })
    return rows


def _classify(events, now, horizon, pre_games, final_games, seen, sport):
    for e in events or []:
        try:
            kick = dt.datetime.fromisoformat(e["date"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        comps = (e.get("competitions") or [{}])[0].get("competitors") or []
        abbr = {c.get("homeAway"): (c.get("team") or {}).get("abbreviation") for c in comps}
        if not abbr.get("away") or not abbr.get("home"):
            continue
        key = f"{sport}:{e['id']}"
        if key in seen:
            continue
        seen.add(key)
        state = ((e.get("status") or {}).get("type") or {}).get("name", "")
        game = {"eventId": str(e["id"]), "date": e["date"][:10].replace("-", ""),
                "away": abbr["away"], "home": abbr["home"], "sport": sport,
                "kickoff": e["date"]}
        if "FINAL" in str(state).upper():
            # Only finalize games that ended recently (past 3 days) — older
            # games are long graded and need no hourly attention.
            if now - dt.timedelta(days=3) <= kick <= now:
                final_games.append(game)
            continue
        if not (now - dt.timedelta(hours=3) <= kick <= horizon):
            continue
        pre_games.append(game)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=168)
    ap.add_argument("--base", default="http://localhost:3000")
    args = ap.parse_args()

    now = dt.datetime.now(dt.timezone.utc)
    horizon = now + dt.timedelta(hours=args.hours)
    print(f"[lines] {now.isoformat()} window -> {horizon.isoformat()}", flush=True)

    pre_games, final_games = [], []
    seen = set()

    # NFL: weekly slates (current + next two).
    try:
        board = get(args.base, "/api/schedule-week?sport=NFL", timeout=60)
    except Exception as e:
        print(f"[lines] schedule-week failed: {e}", flush=True)
        board = None
    if board:
        boards = [board]
        if isinstance(board.get("week"), int):
            for w in (board["week"] + 1, board["week"] + 2):
                try:
                    boards.append(get(args.base, f"/api/schedule-week?sport=NFL&week={w}", timeout=60))
                except Exception as e:
                    print(f"[lines] schedule-week week={w} failed: {e}", flush=True)
        for b in boards:
            _classify(b.get("events", []), now, horizon, pre_games, final_games, seen, "NFL")

    # NBA/NHL/MLB: ESPN scoreboard, one call per day in the window.
    days = args.hours // 24 + 1
    for sport, espn_path in SCOREBOARD_SPORTS.items():
        for d in range(days + 1):
            day = (now + dt.timedelta(days=d)).strftime("%Y%m%d")
            try:
                sb = get_json(f"https://site.api.espn.com/apis/site/v2/sports/{espn_path}/scoreboard?dates={day}",
                              timeout=30)
            except Exception as e:
                print(f"[lines] {sport} scoreboard {day} failed: {e}", flush=True)
                continue
            _classify(sb.get("events", []), now, horizon, pre_games, final_games, seen, sport)
    print(f"[lines] {len(pre_games)} pre-game, {len(final_games)} recent finals", flush=True)

    ok = fail = 0
    for g in pre_games:
        tag = f"{g['sport']} {g['away']}@{g['home']} {g['date']}"
        try:
            sc = post(args.base, "/api/scraper",
                      {"team": g["away"], "opponent": g["home"],
                       "gameDate": g["date"], "sport": g["sport"].lower(),
                       "gameTime": g.get("kickoff")},
                      timeout=SCRAPE_TIMEOUT)
            rows = _flatten_scrape(sc.get("results"))
            if not rows:
                print(f"[lines] scrape {tag}: no O/U lines returned", flush=True)
                fail += 1
                continue
            # Canonical key: sorted pair so both team pages share one record.
            t1, t2 = sorted([g["away"].upper(), g["home"].upper()])
            led = post(args.base, "/api/prop-ledger",
                       {"action": "lines", "team": t1, "opponent": t2,
                        "eventDate": g["date"],
                        "record": {"lines": rows, "source": "hourly-refresh"}},
                       timeout=60)
            if not led.get("ok"):
                raise RuntimeError(f"ledger rejected: {led}")
            print(f"[lines] snapshot {tag}: {len(rows)} lines", flush=True)
            ok += 1
        except Exception as e:
            print(f"[lines] {tag} FAILED: {e}", flush=True)
            fail += 1

    for g in final_games:
        tag = f"{g['sport']} {g['away']}@{g['home']} {g['date']}"
        try:
            t1, t2 = sorted([g["away"].upper(), g["home"].upper()])
            fin = post(args.base, "/api/prop-ledger",
                       {"action": "finalize", "team": t1, "opponent": t2,
                        "eventDate": g["date"]},
                       timeout=60)
            n = len((fin.get("finalLines") or {}).get("lines") or [])
            print(f"[lines] finalize {tag}: {n} closing lines", flush=True)
        except Exception as e:
            print(f"[lines] finalize {tag} FAILED: {e}", flush=True)
            fail += 1

    print(f"[lines] done: {ok} snapshotted, {fail} failed", flush=True)
    return 0 if fail == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
