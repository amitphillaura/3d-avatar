#!/bin/bash
# Local production server for Live Pose Tester (macOS launchd / manual use).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/logs"
OUT_LOG="$LOG_DIR/prod.out.log"
ERR_LOG="$LOG_DIR/prod.err.log"
PID_FILE="$LOG_DIR/prod.pid"
BACKEND_OUT_LOG="$LOG_DIR/backend.out.log"
BACKEND_ERR_LOG="$LOG_DIR/backend.err.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="${HOME:-/Users/amit}"

mkdir -p "$LOG_DIR"
cd "$ROOT"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$OUT_LOG"
}

log "Starting production server in $ROOT"
echo $$ >"$PID_FILE"

if [[ ! -d node_modules ]]; then
  log "Running npm install (first launch)"
  npm install >>"$OUT_LOG" 2>>"$ERR_LOG"
fi

log "Building dist/"
npm run build >>"$OUT_LOG" 2>>"$ERR_LOG"

BACKEND_PID=""
PREVIEW_PID=""

cleanup() {
  if [[ -n "${PREVIEW_PID:-}" ]]; then
    log "Stopping preview server pid=$PREVIEW_PID"
    kill "$PREVIEW_PID" 2>/dev/null || true
    wait "$PREVIEW_PID" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]]; then
    log "Stopping Motion API pid=$BACKEND_PID"
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

if curl -fsS --max-time 2 http://127.0.0.1:5190/api/health >/dev/null 2>&1; then
  log "Motion API already online at http://127.0.0.1:5190/"
else
  log "Starting Motion API at http://127.0.0.1:5190/"
  npm run backend >>"$BACKEND_OUT_LOG" 2>>"$BACKEND_ERR_LOG" &
  BACKEND_PID=$!
  sleep 1
  if curl -fsS --max-time 5 http://127.0.0.1:5190/api/health >/dev/null 2>&1; then
    log "Motion API ready pid=$BACKEND_PID"
  else
    log "Motion API did not become ready yet; continuing so logs capture the failure"
  fi
fi

log "Serving http://127.0.0.1:5180/"
npm run preview >>"$OUT_LOG" 2>>"$ERR_LOG" &
PREVIEW_PID=$!
wait "$PREVIEW_PID"
