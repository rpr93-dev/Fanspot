#!/bin/bash
# Daily prop-pipeline warm: refresh the shared nflverse disk cache, then pull
# live lines for imminent games. Read-only (never writes ledger snapshots).
# Cron: 0 6 * * * /home/kc-llm/Fanspot/prop-model/daily-warm.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/prop-model/daily-warm.log"

{
  echo "===== $(date -u +%FT%TZ) daily warm start ====="
  cd "$ROOT/prop-model" || exit 1
  # One CLI pull refreshes the whole shared weekly file (24h TTL) for the route.
  "./.venv/bin/python" -m propmodel.cli \
    --player "C.J. Stroud" --stat passing_yards --team HOU --opponent LV \
    2>&1 | tail -3
  # Live props + DK lines for games kicking off in the next 96h.
  # Public deployment: the app is published under /fanspot (port 3010, pm2).
  "./.venv/bin/python" "$ROOT/prop-model/daily_warm.py" --hours 96 --base http://127.0.0.1:3010/fanspot 2>&1
  echo "===== $(date -u +%FT%TZ) daily warm end (exit $?) ====="
} >> "$LOG" 2>&1
