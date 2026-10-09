#!/usr/bin/env bash
set -euo pipefail

platform="${1:-all}"
case "$platform" in
  all|android|ios) ;;
  *) echo "Usage: $0 [all|android|ios]" >&2; exit 2 ;;
esac

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGO_SVG="$ROOT_DIR/assets/logo.svg"
SPLASH_SVG="$ROOT_DIR/assets/splash.svg"

for file in "$LOGO_SVG" "$SPLASH_SVG"; do
  [[ -s "$file" ]] || { echo "Missing required asset source: $file" >&2; exit 1; }
done

command -v rsvg-convert >/dev/null 2>&1 || { echo "rsvg-convert is required" >&2; exit 1; }

if command -v magick >/dev/null 2>&1; then
  identify_dims() { magick identify -format '%w %h' "$1"; }
elif command -v identify >/dev/null 2>&1; then
  identify_dims() { identify -format '%w %h' "$1"; }
else
  echo "ImageMagick identify is required" >&2
  exit 1
fi

render_svg_like_target() {
  local source="$1"
  local target="$2"
  local dims width height tmp
  dims="$(identify_dims "$target")"
  read -r width height <<<"$dims"
  [[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]] || {
    echo "Could not determine dimensions for $target" >&2
    exit 1
  }
  tmp="${target}.tmp.png"
  rsvg-convert -w "$width" -h "$height" "$source" -o "$tmp"
  mv "$tmp" "$target"
  echo "Branded $target (${width}x${height})"
}

render_android() {
  local res="$ROOT_DIR/android/app/src/main/res"
  [[ -d "$res" ]] || { echo "Android project not found at $res" >&2; exit 1; }

  local icon_count=0 splash_count=0 file base
  while IFS= read -r -d '' file; do
    base="$(basename "$file")"
    case "$base" in
      ic_launcher*.png)
        render_svg_like_target "$LOGO_SVG" "$file"
        icon_count=$((icon_count + 1))
        ;;
      splash*.png)
        render_svg_like_target "$SPLASH_SVG" "$file"
        splash_count=$((splash_count + 1))
        ;;
    esac
  done < <(find "$res" -type f -name '*.png' -print0)

  (( icon_count > 0 )) || { echo "No Android launcher PNG assets found" >&2; exit 1; }
  (( splash_count > 0 )) || { echo "No Android splash PNG assets found" >&2; exit 1; }
  echo "Android branding complete: $icon_count launcher assets, $splash_count splash assets"
}

render_ios() {
  local assets="$ROOT_DIR/ios/App/App/Assets.xcassets"
  local icons="$assets/AppIcon.appiconset"
  local splash="$assets/Splash.imageset"
  [[ -d "$icons" ]] || { echo "iOS app icon set not found at $icons" >&2; exit 1; }
  [[ -d "$splash" ]] || { echo "iOS splash set not found at $splash" >&2; exit 1; }

  local icon_count=0 splash_count=0 file
  while IFS= read -r -d '' file; do
    render_svg_like_target "$LOGO_SVG" "$file"
    icon_count=$((icon_count + 1))
  done < <(find "$icons" -type f -name '*.png' -print0)

  while IFS= read -r -d '' file; do
    render_svg_like_target "$SPLASH_SVG" "$file"
    splash_count=$((splash_count + 1))
  done < <(find "$splash" -type f -name '*.png' -print0)

  (( icon_count > 0 )) || { echo "No iOS app icon PNG assets found" >&2; exit 1; }
  (( splash_count > 0 )) || { echo "No iOS splash PNG assets found" >&2; exit 1; }
  echo "iOS branding complete: $icon_count app icons, $splash_count splash assets"
}

case "$platform" in
  android) render_android ;;
  ios) render_ios ;;
  all)
    rendered=0
    if [[ -d "$ROOT_DIR/android" ]]; then render_android; rendered=1; fi
    if [[ -d "$ROOT_DIR/ios" ]]; then render_ios; rendered=1; fi
    (( rendered == 1 )) || { echo "No native Android or iOS project exists yet" >&2; exit 1; }
    ;;
esac
