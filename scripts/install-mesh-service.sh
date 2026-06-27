#!/usr/bin/env bash
#
# Install the mesh API as a systemd service inside WSL2 (Ubuntu).
# Run from WSL:  sudo bash scripts/install-mesh-service.sh [install|uninstall|status]
#
# Pairs with scripts/install-mesh-service.ps1 (Windows side), which registers a
# logon Scheduled Task so WSL — and therefore this enabled service — comes up
# at Windows logon. WSL must have systemd enabled (it is by default here).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_SRC="$ROOT/backend/deploy/mesh-api.service"
UNIT_DST="/etc/systemd/system/mesh-api.service"
ACTION="${1:-install}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }

case "$ACTION" in
  install)
    command -v systemctl >/dev/null || { echo "systemd not available in this WSL distro." >&2; exit 1; }
    [ -f "$UNIT_SRC" ] || { echo "Missing unit: $UNIT_SRC" >&2; exit 1; }
    install -m 0644 "$UNIT_SRC" "$UNIT_DST"
    systemctl daemon-reload
    systemctl enable mesh-api
    echo "Enabled mesh-api (starts on WSL boot)."
    echo "Start now with: sudo systemctl start mesh-api"
    ;;
  uninstall)
    systemctl disable --now mesh-api 2>/dev/null || true
    rm -f "$UNIT_DST"
    systemctl daemon-reload
    echo "Removed mesh-api service."
    ;;
  status)
    systemctl status mesh-api --no-pager || true
    ;;
  *)
    echo "Usage: $0 [install|uninstall|status]" >&2
    exit 2
    ;;
esac
