#!/bin/sh
# Starts Dodobox. Installs what it needs on first run and again after an upgrade or downgrade changes the dependencies.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Dodobox needs Node.js 24 or newer: https://nodejs.org (or run it with Docker: docker compose up)"
  exit 1
fi
# node_modules/.dodobox-lock is the package-lock.json of the last finished install; comparing contents (not times) also catches a downgrade or an archive with old file times.
# npm writes node_modules/.package-lock.json after a finished install, so a missing one means the install is partial.
if [ ! -f node_modules/.package-lock.json ] || ! cmp -s package-lock.json node_modules/.dodobox-lock; then
  # npm install, not npm ci: ci empties node_modules first, which would leave nothing to start with when offline.
  if npm install --omit=dev; then
    cp package-lock.json node_modules/.dodobox-lock
  else
    # Offline: carry on when what is installed is already enough to start.
    [ -f node_modules/.package-lock.json ] || exit 1
    echo "Could not update the dependencies; starting with the ones already installed."
  fi
fi
OPEN=1 exec node server.js
