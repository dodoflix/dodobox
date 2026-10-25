#!/bin/sh
# Rebuilds banner.jpg (the README banner) from banner.html and the screenshots in src/. Needs
# Chromium (or set CHROME) and ImageMagick 7. src/ holds screenshots of the app (desktop 1374x868,
# phone 370x789, no scrollbars). After replacing them, run:
#   sh docs/screenshots/banner.sh
set -e
D=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
"${CHROME:-chromium}" --headless --disable-gpu --hide-scrollbars --no-sandbox \
  --window-size=1800,860 --force-device-scale-factor=2 --virtual-time-budget=4000 \
  --screenshot="$T/banner.png" "file://$D/banner.html" >/dev/null 2>&1
magick "$T/banner.png" -resize 1800x -quality 90 "$D/banner.jpg"
