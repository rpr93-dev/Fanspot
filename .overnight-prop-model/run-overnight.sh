#!/usr/bin/env bash
# Overnight prop-model tuning on FreeToken Qwen 3.6. Runs in tmux: propmodel-overnight
# Model: Qwen3.6-35B-A3B-NVFP4 via ft-idle-proxy front http://127.0.0.1:1919/v1
set -u
BASE=/home/kc-llm/Fanspot
NIGHT=$BASE/.overnight-prop-model
LOG=$NIGHT/overnight.log
mkdir -p "$NIGHT/sweeps" "$NIGHT/web"

# Wake freetoken backend (cold start ~20s), fail loud if it won't come up
for i in $(seq 1 30); do
  if curl -s -m 5 http://127.0.0.1:1919/v1/models 2>/dev/null | grep -q qwen3.6-35b-a3b; then
    echo "[$(date '+%F %T')] freetoken qwen3.6-35b-a3b ready" | tee -a "$LOG"
    break
  fi
  sleep 10
  [ "$i" = 30 ] && { echo "FreeToken backend never became ready" | tee -a "$LOG"; exit 1; }
done

# Keep backend warm: touch models endpoint every 15 min in background
( while true; do sleep 900; curl -s -m 10 http://127.0.0.1:1919/v1/models >/dev/null 2>&1; done ) &
WARM_PID=$!
trap 'kill $WARM_PID 2>/dev/null' EXIT

export OPENCODE_CONFIG_CONTENT='{"$schema":"https://opencode.ai/config.json","compaction":{"auto":true,"reserved":10000},"provider":{"freetoken":{"npm":"@ai-sdk/openai-compatible","name":"FreeToken","options":{"baseURL":"http://127.0.0.1:1919/v1","apiKey":"not-needed"},"models":{"qwen3.6-35b-a3b":{"name":"qwen3.6-35b","tool_call":true,"limit":{"context":65536,"output":8192}}}}} ,"model":"freetoken/qwen3.6-35b-a3b"}'

MISSION_PROMPT="Read .overnight-prop-model/MISSION.md in /home/kc-llm/Fanspot and execute it autonomously overnight. You are running as freetoken/qwen3.6-35b-a3b (Qwen 3.6 served by FreeToken at 127.0.0.1:1919). Work dir is /home/kc-llm/Fanspot. Use bash tool for prop-model/.venv/bin/python backtest/pytest runs and chrome-devtools-axi for browser pulls. Log everything to .overnight-prop-model/PROGRESS.md. Do not commit. Start now with step 1 (confirm baseline), then sweep knobs."

echo "[$(date '+%F %T')] launching opencode on freetoken/qwen3.6-35b-a3b" | tee -a "$LOG"

# Single long agentic run; --auto lets it approve its own safe tool calls overnight.
# Auto-compaction (see OPENCODE_CONFIG_CONTENT) summarizes context when the
# 64k window fills, so the run survives till morning. If the run still exits
# (transient backend wake-up 503, compaction edge, etc.), resume the same
# session with --continue, up to 5 restarts, then park for the morning.
RESTARTS=0
FIRST_ARGS=""
while [ $RESTARTS -le 5 ]; do
  opencode run --pure --auto -m freetoken/qwen3.6-35b-a3b --dir "$BASE" --title "overnight-propmodel-qwen3.6" $FIRST_ARGS "$MISSION_PROMPT" >>"$LOG" 2>&1
  RC=$?
  echo "[$(date '+%F %T')] opencode exited rc=$RC restarts_used=$RESTARTS" | tee -a "$LOG"
  [ $RC -eq 0 ] && break
  RESTARTS=$((RESTARTS + 1))
  [ $RESTARTS -gt 5 ] && { echo "[$(date '+%F %T')] restart budget spent, parking for morning" | tee -a "$LOG"; break; }
  sleep 60
  # wake backend before resuming so --continue doesn't trip on a cold proxy
  curl -s -m 100 http://127.0.0.1:1919/v1/models >/dev/null 2>&1
  FIRST_ARGS="--continue"
  MISSION_PROMPT="Continue the overnight prop-model mission in .overnight-prop-model/MISSION.md. First re-read .overnight-prop-model/PROGRESS.md and pick up where you left off. Do not repeat finished backtests."
done
