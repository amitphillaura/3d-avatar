#!/bin/bash
# Install or remove macOS login autostart for local production (port 5180).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$ROOT/scripts/com.amit.3davatar.pose-tester.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.amit.3davatar.pose-tester.plist"
LABEL="com.amit.3davatar.pose-tester"

chmod +x "$ROOT/scripts/start-prod.sh"

usage() {
  echo "Usage: $0 {install|uninstall|status|restart|logs}"
}

install() {
  mkdir -p "$ROOT/logs"
  cp "$PLIST_SRC" "$PLIST_DST"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
  launchctl enable "gui/$(id -u)/$LABEL"
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
  echo "Autostart installed. Production URL: http://127.0.0.1:5180/"
  echo "Logs: $ROOT/logs/prod.out.log"
}

uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST_DST"
  echo "Autostart removed."
}

status() {
  launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | head -20 || echo "Not loaded."
  curl -s -o /dev/null -w "HTTP %{http_code} at http://127.0.0.1:5180/\n" http://127.0.0.1:5180/ || echo "Server not responding."
}

restart() {
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
}

logs() {
  tail -n 40 "$ROOT/logs/prod.out.log" 2>/dev/null || echo "No prod.out.log yet."
  echo "---"
  tail -n 20 "$ROOT/logs/prod.err.log" 2>/dev/null || true
}

case "${1:-install}" in
  install) install ;;
  uninstall) uninstall ;;
  status) status ;;
  restart) restart ;;
  logs) logs ;;
  *) usage; exit 1 ;;
esac
