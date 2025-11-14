#!/usr/bin/env bash
# purpose: One-click remote deploy to target host/port with cleanup and restart
# author: auto
# created: 2025-11-09
# updated: 2025-11-09
# deps: ssh, rsync, bash

set -euo pipefail

REMOTE_HOST=${REMOTE_HOST:-"192.168.1.200"}
REMOTE_PORT=${REMOTE_PORT:-"25348"}
REMOTE_USER=${REMOTE_USER:-"$USER"}
REMOTE_DIR=${REMOTE_DIR:-"/home/data/water_mark_remove"}
LOCAL_DIR=${LOCAL_DIR:-"$(pwd)"}
SERVER_PORT=${SERVER_PORT:-"25348"}

echo "[remote-deploy] host=$REMOTE_HOST user=$REMOTE_USER dir=$REMOTE_DIR port=$SERVER_PORT"

# Create remote directory and required subfolders
ssh -o ConnectTimeout=5 "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p ${REMOTE_DIR} ${REMOTE_DIR}/logs ${REMOTE_DIR}/data ${REMOTE_DIR}/Input ${REMOTE_DIR}/Output ${REMOTE_DIR}/Failed"

# Sync local project excluding bulky/generated folders
rsync -avz --delete --exclude-from "${LOCAL_DIR}/scripts/rsync-exclude.txt" "${LOCAL_DIR}/" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"

# Prepare start script remotely: kill ports, install deps if needed, start server
ssh -o ConnectTimeout=5 "${REMOTE_USER}@${REMOTE_HOST}" bash -lc "\
  set -e; \
  cd ${REMOTE_DIR}; \
  echo '[remote] cleaning ports'; \
  (command -v npx >/dev/null && npx kill-port ${SERVER_PORT} 3000) || true; \
  echo '[remote] install deps'; \
  if command -v npm >/dev/null; then \
    if [ -f package.json ]; then npm install --silent; else echo 'package.json not found'; fi; \
  else \
    echo 'npm not found. Please install Node.js on remote.'; \
  fi; \
  echo '[remote] start server'; \
  SERVER_HOST=0.0.0.0 SERVER_PORT=${SERVER_PORT} PORT=${SERVER_PORT} INPUT_DIR=${REMOTE_DIR}/Input OUTPUT_DIR=${REMOTE_DIR}/Output FAILED_DIR=${REMOTE_DIR}/Failed LOG_LEVEL=info nohup node src/server/index.js > logs/remote-server.log 2>&1 & disown; \
  sleep 2; \
  (command -v ss >/dev/null && ss -lntp | grep :${SERVER_PORT} || true) || (netstat -lntp | grep :${SERVER_PORT} || true); \
  echo '[remote] started on port ${SERVER_PORT}'; \
"

echo "[remote-deploy] done. Try: curl -sS http://${REMOTE_HOST}:${SERVER_PORT}/api/health"