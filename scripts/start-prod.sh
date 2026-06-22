#!/bin/bash
# Local production server for Live Pose Tester (macOS launchd / manual use).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/logs"
OUT_LOG="$LOG_DIR/prod.out.log"
ERR_LOG="$LOG_DIR/prod.err.log"
PID_FILE="$LOG_DIR/prod.pid"

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

log "Serving http://127.0.0.1:5180/"
exec npm run preview >>"$OUT_LOG" 2>>"$ERR_LOG"
