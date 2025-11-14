#!/usr/bin/env bash
set -euo pipefail

# 一键停止去水印服务

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT_DIR/watermark-server.pid"

if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "[watermark] stopping (pid=$PID)"
    kill "$PID" 2>/dev/null || true
    sleep 1
    kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# 兜底：清理残留进程
pkill -f "node .*src/server/index.js" 2>/dev/null || true

echo "[watermark] stopped"

