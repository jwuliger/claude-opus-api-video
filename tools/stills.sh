#!/usr/bin/env bash
# Render single frames (PNG) at given times for review: tools/stills.sh 1280 720 3.6 24.2 ...
W=$1; H=$2; shift 2
mkdir -p out/stills
for t in "$@"; do
  node tools/render.mjs --width $W --height $H --fps 60 --from $t --to $(python3 -c "print($t+1/60)") --software --preset ultrafast --out out/stills/_s.mp4 >/dev/null 2>&1
  ffmpeg -loglevel error -y -i out/stills/_s.mp4 -frames:v 1 out/stills/t$t.png
done
