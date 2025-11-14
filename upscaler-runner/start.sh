#!/usr/bin/env bash
set -euo pipefail

# 默认使用项目内配置文件，可通过 RUNNER_CONFIG 覆盖
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_PATH="${RUNNER_CONFIG:-$SCRIPT_DIR/config.json}"
PID_FILE="$SCRIPT_DIR/upscaler-runner.pid"
LOG_FILE="$SCRIPT_DIR/upscaler-runner.out"

mkdir -p "$SCRIPT_DIR"

# 已在运行则直接提示
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "[upscaler-runner] already running (pid=$PID)"
    exit 0
  fi
fi

echo "[upscaler-runner] using config: $CONFIG_PATH"

# 后台启动并记录 PID 与日志
cd "$SCRIPT_DIR"
rm -f "$LOG_FILE" 2>/dev/null || true
nohup env RUNNER_CONFIG="$CONFIG_PATH" RUN_ONCE=true node index.js > "$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"
sleep 1

if kill -0 "$PID" 2>/dev/null; then
  echo "[upscaler-runner] started (pid=$PID)"
  echo "[upscaler-runner] logs: $LOG_FILE"
else
  echo "[upscaler-runner] failed to start"
  exit 1
fi

echo "[upscaler-runner] stop hint: use ./stop.sh to terminate immediately"
