#!/bin/bash
# Hourly prop-line refresh: re-scrape book lines for upcoming games and bank
# the closing snapshot used for grading. Snapshots are append-only; finals get
# frozen to the most recent pre-final lines.
# Cron: 0 * * * * /home/kc-llm/Fanspot/prop-model/line-refresh.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/prop-model/line-refresh.log"

{
  echo "===== $(date -u +%FT%TZ) line refresh start ====="
  cd "$ROOT/prop-model" || exit 1
  "./.venv/bin/python" "$ROOT/prop-model/line_refresh.py" --hours 168 2>&1
  echo "===== $(date -u +%FT%TZ) line refresh end (exit $?) ====="
} >> "$LOG" 2>&1
