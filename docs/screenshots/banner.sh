#!/bin/sh
# Rebuilds banner.jpg (the README banner) from src/. Needs ImageMagick 7 (`magick`).
# To update: replace the images in src/ (desktop 1374x868, phone 370x789, no scrollbars), then run: sh docs/screenshots/banner.sh
set -e
D=$(cd "$(dirname "$0")" && pwd); S=$D/src; O=$D/banner.jpg; T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

# card IN WIDTH RADIUS OUT: resize, round the corners, add a hairline border and a shadow
card() {
  magick "$1" -resize "$2"x "$T/r.png"
  w=$(magick identify -format %w "$T/r.png"); h=$(magick identify -format %h "$T/r.png")
  magick -size ${w}x${h} xc:none -fill white -draw "roundrectangle 0,0 $((w-1)),$((h-1)) $3,$3" "$T/m.png"
  magick "$T/r.png" -alpha set "$T/m.png" -compose DstIn -composite \
    -stroke 'rgba(255,255,255,0.14)' -strokewidth 1 -fill none -draw "roundrectangle 0,0 $((w-1)),$((h-1)) $3,$3" "$T/c.png"
  magick "$T/c.png" \( +clone -background black -shadow 70x28+0+22 \) +swap -background none -layers merge +repage "$4"
}

card "$S/search.jpg" 640 16 "$T/left.png"
card "$S/episodes.jpg" 640 16 "$T/right.png"
card "$S/home.jpg" 1020 20 "$T/mid.png"
card "$S/phone-home.jpg" 240 30 "$T/ph1.png"
card "$S/phone-title.jpg" 240 30 "$T/ph2.png"

# offsets include the shadow padding that card() adds around each image
magick -size 1800x860 radial-gradient:'rgb(78,40,24)-rgb(11,11,16)' -gravity center -background '#0b0b10' -extent 1800x860 -gravity NorthWest \
  "$T/left.png"  -geometry -36+150 -compose Over -composite \
  "$T/right.png" -geometry +1096+150 -composite \
  "$T/mid.png"   -geometry +333+60 -composite \
  "$T/ph1.png"   -geometry +119+280 -composite \
  "$T/ph2.png"   -geometry +1334+280 -composite \
  -quality 90 "$O"
