#!/bin/sh
# Starts Dodobox. Installs what it needs on first run.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Dodobox needs Node.js 24 or newer: https://nodejs.org (or run it with Docker: docker compose up)"
  exit 1
fi
[ -d node_modules ] || npm install --omit=dev || exit 1
OPEN=1 exec node server.js
