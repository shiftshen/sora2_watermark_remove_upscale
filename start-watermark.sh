#!/usr/bin/env bash
set -euo pipefail

# 一键启动去水印服务
# 默认监听 0.0.0.0:25348，可通过环境变量覆盖：
#   SERVER_HOST, SERVER_PORT, INPUT_DIR, OUTPUT_DIR, FAILED_DIR, AUTO_MOVE_TO_FAILED

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/watermark-server.pid"
LOG_FILE="$ROOT_DIR/logs/watermark-server.out"

mkdir -p "$ROOT_DIR/logs"

# 若已在运行，直接返回
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "[watermark] already running (pid=$PID)"
    echo "[watermark] logs: $LOG_FILE"
    exit 0
  fi
fi

# 默认参数（可被环境变量覆盖）
export SERVER_HOST="${SERVER_HOST:-0.0.0.0}"
export SERVER_PORT="${SERVER_PORT:-25348}"
export INPUT_DIR="${INPUT_DIR:-$ROOT_DIR/Input}"
export OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/Output}"
export FAILED_DIR="${FAILED_DIR:-$ROOT_DIR/Failed}"
export AUTO_MOVE_TO_FAILED="${AUTO_MOVE_TO_FAILED:-false}"

cd "$ROOT_DIR"
nohup node src/server/index.js > "$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"
sleep 1

if kill -0 "$PID" 2>/dev/null; then
  echo "[watermark] started (pid=$PID)"
  echo "[watermark] listening on http://$SERVER_HOST:$SERVER_PORT"
  echo "[watermark] logs: $LOG_FILE"
else
  echo "[watermark] failed to start"
  exit 1
fi

