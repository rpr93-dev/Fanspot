"""Daily warm for the NFL prop pipeline (cron-safe, read-only).

Runs every morning and keeps the model's inputs live without touching the
ledger (pre snapshots stay write-once, locked on real user visits with lines):
  1. One prop-model CLI pull -> refreshes the shared nflverse weekly disk
     cache (prop-model/cache, 24h TTL) used by every /api/prop-model run.
  2. /api/props per imminent game -> warms the unified-DB / roster caches.
  3. /api/scraper per imminent game -> pulls live DraftKings (+ other books)
     lines into the scraper service so Props-tab snapshots capture real lines.

Imminent = kickoff within the next --hours (default 96). Skips final games.
Usage: .venv/bin/python daily_warm.py [--hours 96] [--base http://localhost:3000]
"""
import argparse
import datetime as dt
import json
import sys
import urllib.request

MARKETS = ("passing_yards", "tds")


def get(base, path, timeout=90):
    with urllib.request.urlopen(base + path, timeout=timeout) as r:
        return json.load(r)


def post(base, path, body, timeout=180):
    req = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=96)
    ap.add_argument("--base", default="http://localhost:3000")
    args = ap.parse_args()

    now = dt.datetime.now(dt.timezone.utc)
    horizon = now + dt.timedelta(hours=args.hours)
    print(f"[warm] {now.isoformat()} window -> {horizon.isoformat()}", flush=True)

    try:
        board = get(args.base, "/api/schedule-week?sport=NFL", timeout=60)
    except Exception as e:
        print(f"[warm] schedule-week failed: {e}", flush=True)
        return 1
    cur_week = board.get("week")
    boards = [board]
    # Sweep the next two weeks too: imminent games (e.g. Friday) often belong
    # to the following slate, which the current-week feed doesn't include.
    if isinstance(cur_week, int):
        for w in (cur_week + 1, cur_week + 2):
            try:
                boards.append(get(args.base, f"/api/schedule-week?sport=NFL&week={w}", timeout=60))
            except Exception as e:
                print(f"[warm] schedule-week week={w} failed: {e}", flush=True)
    games = []
    seen = set()
    for board in boards:
        for e in board.get("events", []) or []:
            try:
                kick = dt.datetime.fromisoformat(e["date"].replace("Z", "+00:00"))
            except (KeyError, ValueError):
                continue
            if not (now - dt.timedelta(hours=3) <= kick <= horizon):
                continue
            comps = (e.get("competitions") or [{}])[0].get("competitors") or []
            abbr = {c.get("homeAway"): (c.get("team") or {}).get("abbreviation") for c in comps}
            if not abbr.get("away") or not abbr.get("home"):
                continue
            state = ((e.get("status") or {}).get("type") or {}).get("name", "")
            if "FINAL" in str(state).upper():
                continue
            key = (str(e["id"]),)
            if key in seen:
                continue
            seen.add(key)
            games.append({
                "eventId": str(e["id"]),
                "date": e["date"][:10].replace("-", ""),
                "away": abbr["away"], "home": abbr["home"],
            })
    print(f"[warm] {len(games)} imminent games", flush=True)

    ok = fail = 0
    for g in games:
        tag = f"{g['away']}@{g['home']} {g['date']}"
        try:
            props = get(
                args.base,
                f"/api/props?sport=NFL&team={g['away']}&opponent={g['home']}"
                f"&date={g['date']}&eventId={g['eventId']}",
                timeout=120,
            )
            n = len(props.get("projections") or [])
            print(f"[warm] props {tag}: {n} lines", flush=True)
        except Exception as e:
            print(f"[warm] props {tag} FAILED: {e}", flush=True)
            fail += 1
            continue
        try:
            sc = post(
                args.base, "/api/scraper",
                {"team": g["away"], "opponent": g["home"],
                 "gameDate": g["date"], "sport": "nfl"},
                timeout=180,
            )
            res = (sc.get("results") or {}).get("results") or {}
            books = {b: (d or {}).get("count", 0) for b, d in res.items()}
            print(f"[warm] scrape {tag}: {books}", flush=True)
            ok += 1
        except Exception as e:
            print(f"[warm] scrape {tag} FAILED: {e}", flush=True)
            fail += 1
    print(f"[warm] done: {ok} scraped, {fail} failed", flush=True)
    return 0 if fail == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
