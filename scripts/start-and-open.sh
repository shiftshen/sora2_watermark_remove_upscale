#!/usr/bin/env bash
set -euo pipefail

# 一键启动：清端口 → 启服务 → 打开浏览器 → 启动批处理
PORT=${SERVER_PORT:-25348}
BASE_URL=${SORA_API_BASE_URL:-https://sora.xmanx.com}
export SERVER_PORT="$PORT"
export SERVER_HOST="0.0.0.0"
export SORA_API_BASE_URL="$BASE_URL"
export NODE_ENV=development

# 端口卫生
npx kill-port 3000 5173 25348 || true

# 启动服务到后台
nohup node src/server/index.js > logs/server.start.log 2>&1 &
PID=$!

echo "Server starting on http://localhost:${PORT} (pid=$PID)"

# 等待服务就绪（最多10秒）
for i in {1..20}; do
  sleep 0.5
  if curl -fs "http://localhost:${PORT}/api/status" >/dev/null; then
    break
  fi
done

# 打开监控面板
open "http://localhost:${PORT}/"

# 启动批处理（无论 output 是否已有文件）
curl -fs -X POST "http://localhost:${PORT}/api/batch/start" >/dev/null || true

echo "Batch started. Monitor at http://localhost:${PORT}/"
