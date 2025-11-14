#!/usr/bin/env bash
# purpose: Wrap a command with timeout, logging, and safe teardown
# author: auto
# created: 2025-11-09
# updated: 2025-11-09
# deps: bash, kill, date

set -euo pipefail

TIMEOUT_SEC=${TIMEOUT_SEC:-120}
TAG=${TAG:-command}
LOG_DIR=${LOG_DIR:-"$(pwd)/logs/exec"}
mkdir -p "$LOG_DIR"

TS=$(date +"%Y%m%d-%H%M%S")
LOG_FILE="$LOG_DIR/${TAG}-${TS}.log"
STATUS_FILE="$LOG_DIR/${TAG}-${TS}.status"

echo "[exec-guard] start tag=$TAG timeout=${TIMEOUT_SEC}s" | tee -a "$LOG_FILE"
echo "cmd: $*" | tee -a "$LOG_FILE"

# Start command in background and capture its PID
(
  set -o pipefail
  bash -lc "$*" 2>&1 | tee -a "$LOG_FILE"
) &
CMD_PID=$!

# Kill process group on exit
cleanup() {
  local code=$1
  if kill -0 "$CMD_PID" 2>/dev/null; then
    # Kill the whole process group (negative pid targets group)
    kill -TERM -"$CMD_PID" 2>/dev/null || true
    sleep 1
    kill -KILL -"$CMD_PID" 2>/dev/null || true
  fi
  echo "$code" > "$STATUS_FILE"
}

# Timeout watcher
(
  sleep "$TIMEOUT_SEC"
  if kill -0 "$CMD_PID" 2>/dev/null; then
    echo "[exec-guard] timeout after ${TIMEOUT_SEC}s, terminating..." | tee -a "$LOG_FILE"
    cleanup 124
    exit 0
  fi
) & WATCHER_PID=$!

# Wait for command
wait "$CMD_PID" 2>/dev/null
EXIT_CODE=$?

# Stop watcher if still running
kill "$WATCHER_PID" 2>/dev/null || true

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "[exec-guard] done (exit 0)" | tee -a "$LOG_FILE"
  cleanup 0
else
  echo "[exec-guard] failed (exit $EXIT_CODE)" | tee -a "$LOG_FILE"
  cleanup "$EXIT_CODE"
fi

exit $(cat "$STATUS_FILE")