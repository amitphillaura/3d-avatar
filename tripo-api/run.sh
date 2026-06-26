#!/usr/bin/env bash
# Launch the TripoSR API. Binds 0.0.0.0 so it's reachable over the tailnet.
#
# Env overrides (see app.py for the full list):
#   HOST (default 0.0.0.0)  PORT (default 8000)  TRIPO_DEVICE  TRIPO_API_KEY
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck disable=SC1091
source .venv/bin/activate

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"

# Single worker on purpose: the model is large and loaded per-process; multiple
# uvicorn workers would each hold a full copy of the weights.
exec uvicorn app:app --host "$HOST" --port "$PORT" --workers 1 --timeout-keep-alive 75
