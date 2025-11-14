#!/usr/bin/env bash
# generated: true
# purpose: 一键将本项目部署到远程服务器，并切换目录与端口；支持杀旧进程、端口清理、同步代码、启动与验证
# author: Auto (Trae)
# usage:
#   REMOTE_USER=happy REMOTE_HOST=192.168.1.200 APP_DIR=/home/data/water_mark_remove PORT=25348 bash scripts/deploy-remote.sh
#   （变量均可覆盖：REMOTE_USER、REMOTE_HOST、APP_DIR、PORT、HOST、RSYNC_FLAGS）
# notes:
#   - 默认 120s 超时防挂；分步执行，遇错即停。
#   - 不会上传到 GitHub；仅做远程同步与启动。

set -euo pipefail

# --- 配置（可通过环境变量覆盖） ---
REMOTE_USER=${REMOTE_USER:-happy}
REMOTE_HOST=${REMOTE_HOST:-192.168.1.200}
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"
APP_DIR=${APP_DIR:-/home/data/water_mark_remove}
PORT=${PORT:-25348}
HOST=${HOST:-0.0.0.0}
TIMEOUT=${TIMEOUT:-120}
RSYNC_FLAGS=${RSYNC_FLAGS:---delete --exclude .git --exclude node_modules}
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=5 -o ServerAliveInterval=30 -o ServerAliveCountMax=2)

# 兼容 macOS 与 GNU 的 timeout：优先使用 timeout，其次 gtimeout；若都不可用则无超时回退
TIMEOUT_BIN="$(command -v timeout || command -v gtimeout || true)"

INPUT_DIR="$APP_DIR/Input"
OUTPUT_DIR="$APP_DIR/Output"
LOG_DIR="$APP_DIR/logs"
DATA_DIR="$APP_DIR/data"

print_step() {
  echo "\n==> $1" >&2
}

run_remote() {
  local cmd="$1"
  if [ -n "$TIMEOUT_BIN" ]; then
    "$TIMEOUT_BIN" "$TIMEOUT" ssh "${SSH_OPTS[@]}" "$REMOTE" "bash -lc '$cmd'"
  else
    echo "[WARN] 本机未找到 timeout/gtimeout，退回无超时执行" >&2
    ssh "${SSH_OPTS[@]}" "$REMOTE" "bash -lc '$cmd'"
  fi
}

# --- 0) 环境回显 ---
print_step "目标: $REMOTE  目录: $APP_DIR  端口: $PORT  绑定: $HOST"

# --- 1) 停止旧服务并清理端口 ---
print_step "停止旧服务并释放端口 $PORT"
run_remote "set -e; \
  # systemd/pm2 旧进程（若存在则停）\
  (command -v systemctl >/dev/null && echo '跳过 systemctl 停止（需 sudo）') || true; \
  (command -v pm2 >/dev/null && pm2 delete all && pm2 save) || true; \
  # 杀占用端口\
  (command -v fuser >/dev/null && fuser -k ${PORT}/tcp) || true; \
  for pid in \$(lsof -ti:${PORT} 2>/dev/null || true); do kill -9 \"\$pid\" || true; done; \
  sleep 1; \
  # 显示端口监听\
  (command -v ss >/dev/null && ss -lntp | grep :${PORT} || true) || (netstat -lntp | grep :${PORT} || true)"

# --- 2) 创建目录与权限 ---
print_step "创建目录并设置权限"
run_remote "set -e; mkdir -p '$INPUT_DIR' '$OUTPUT_DIR' '$LOG_DIR' '$DATA_DIR'; \
  ls -la '$APP_DIR' | head -n 50"

# --- 3) 同步代码（本地 -> 远程） ---
print_step "同步代码到远程 $APP_DIR"
# 使用 rsync 将当前项目同步到远程目标目录
rsync -av $RSYNC_FLAGS "$LOCAL_DIR/" "$REMOTE:$APP_DIR/"

# --- 4) 安装依赖（生产依赖优先） ---
print_step "安装依赖"
run_remote "set -e; cd '$APP_DIR'; \
  if command -v npm >/dev/null; then (npm ci --only=production || npm install --only=production); else echo 'npm 未安装，请先安装 Node.js'; fi"

# --- 5) 写入 .env 与一次性启动（验证） ---
print_step "写入 .env 并一次性启动验证"
run_remote "set -e; \
  cat > '$APP_DIR/.env' <<'EOF'\nSERVER_PORT=$PORT\nSERVER_HOST=$HOST\nINPUT_DIR=$INPUT_DIR\nOUTPUT_DIR=$OUTPUT_DIR\nEOF\n  nohup env SERVER_PORT=$PORT SERVER_HOST=$HOST INPUT_DIR='$INPUT_DIR' OUTPUT_DIR='$OUTPUT_DIR' node '$APP_DIR/src/server/index.js' > '$LOG_DIR/server.out' 2>&1 & disown; \
  sleep 2; \
  (command -v ss >/dev/null && ss -lntp | grep :$PORT || true) || (netstat -lntp | grep :$PORT || true); \
  curl -sS http://127.0.0.1:$PORT/api/health || true; \
  curl -sS http://127.0.0.1:$PORT/api/status || true"

# --- 6) 队列与清理校准 ---
print_step "队列与清理校准"
run_remote "set -e; \
  curl -sS -X DELETE http://127.0.0.1:$PORT/api/system/cleanup || true; \
  curl -sS http://127.0.0.1:$PORT/api/debug/input-files || true"

# --- 7) （可选）设置 systemd 自启动 ---
print_step "（可选）写入 systemd 单元并启用"
run_remote "set -e; \
  echo '跳过 systemd 自启动配置（当前会话无 sudo，可改用 pm2）'"

print_step "验证远程服务与端点"
run_remote "set -e; curl -sS http://127.0.0.1:$PORT/api/health || true; curl -sS http://127.0.0.1:$PORT/api/status || true;"

print_step "完成：请从你的电脑验证 \n  curl -sS http://$REMOTE_HOST:$PORT/api/status \n  curl -sS http://$REMOTE_HOST:$PORT/api/debug/input-files"