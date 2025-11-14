#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/upscaler-runner.pid"
LOG_FILE="$SCRIPT_DIR/upscaler-runner.out"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "[upscaler-runner] stopping (pid=$PID)"
    kill "$PID" 2>/dev/null || true
    sleep 1
    kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# 兜底：杀掉任何残留的 node 进程（仅限本项目 index.js）
pkill -f "node .*upscaler-runner/index.js" 2>/dev/null || true

echo "[upscaler-runner] stopped"
