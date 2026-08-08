#!/usr/bin/env bash
# Builds the macOS/Windows/Linux app icons from a single square PNG.
#
#   ./scripts/make-app-icons.sh path/to/icon.png
#
# Writes assets/icon/logo.png, logo.icns and logo.ico, which is what
# forge.config.ts packages. Uses sips and iconutil, both part of macOS.
set -euo pipefail

SOURCE="${1:-}"
if [[ -z "$SOURCE" || ! -f "$SOURCE" ]]; then
  echo "usage: $0 <square-png>" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/icon"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ICONSET="$WORK/logo.iconset"
mkdir -p "$ICONSET"

# The sizes macOS expects in an iconset, including @2x variants.
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$SOURCE" \
    --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$SOURCE" \
    --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET" -o "$OUT/logo.icns"

# Base PNG used by the Linux makers and the BrowserWindow icon.
sips -z 1024 1024 "$SOURCE" --out "$OUT/logo.png" >/dev/null

# Windows .ico: a multi-size container. sips cannot write .ico, so use the
# largest PNG when ImageMagick is unavailable and say so.
if command -v magick >/dev/null 2>&1; then
  magick "$SOURCE" -define icon:auto-resize=256,128,64,48,32,16 "$OUT/logo.ico"
elif command -v convert >/dev/null 2>&1; then
  convert "$SOURCE" -define icon:auto-resize=256,128,64,48,32,16 "$OUT/logo.ico"
else
  echo "note: ImageMagick not found — assets/icon/logo.ico left unchanged." >&2
fi

echo "Wrote:"
ls -l "$OUT"
