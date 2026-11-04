#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: prepare-pwa-icons.sh <customer|provider> <regular.svg|png> <maskable.svg|png> [new-output-directory]

Prepare review candidates only; no installed app or repository assets are changed.
Both inputs must be final approved, square, opaque artwork. PNG masters must be
at least 1024x1024. Supply a separately approved maskable composition whose entire
essential mark fits within the central 80%-diameter circle. The script preserves
that composition; it cannot certify which visual details are essential.

Requires Python 3, ImageMagick, and rsvg-convert when either input is SVG.
Output defaults to a new temporary directory. An explicit output directory must
not exist and must be outside this repository. Review the images and candidate
manifest before integrating; installed home-screen icons may require reinstallation.
EOF
}

if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then usage; exit 0; fi
[[ $# -ge 3 && $# -le 4 ]] || { usage >&2; exit 2; }
app="$1"
case "$app" in customer|provider) ;; *) usage >&2; exit 2 ;; esac

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v python3 >/dev/null || { echo 'Python 3 is required' >&2; exit 1; }
if command -v magick >/dev/null; then
  im() { magick "$@"; }
elif command -v convert >/dev/null; then
  im() { convert "$@"; }
else
  echo 'ImageMagick is required' >&2; exit 1
fi

output="${4:-}"
if [[ -n "$output" ]]; then
  output="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$output")"
  case "$output/" in "$ROOT_DIR/"*) echo 'Output must be outside the repository' >&2; exit 1 ;; esac
  [[ ! -e "$output" ]] || { echo 'Output directory must not already exist' >&2; exit 1; }
fi
stage="$(mktemp -d /tmp/seago-pwa-icons.XXXXXX)"
trap 'rm -rf "$stage"' EXIT

prepare_source() {
  local source="$1" target="$2" extension details frames format width height opaque
  [[ -s "$source" ]] || { echo "Missing source: $source" >&2; exit 1; }
  source="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$source")"
  extension="${source##*.}"
  case "$extension" in
    [sS][vV][gG])
      command -v rsvg-convert >/dev/null || { echo 'rsvg-convert is required for SVG sources' >&2; exit 1; }
      python3 - "$source" <<'PY'
import math, re, sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
box = [float(v) for v in re.split(r'[\s,]+', root.get('viewBox', '').strip()) if v]
if (root.tag != '{http://www.w3.org/2000/svg}svg' or len(box) != 4
        or not all(math.isfinite(v) for v in box) or box[2] <= 0 or box[2] != box[3]):
    raise SystemExit('SVG must have a finite square viewBox')
dimensions = [root.get(key) for key in ['width', 'height']]
if any(value is not None for value in dimensions):
    def dimension(value):
        match = re.fullmatch(r'\s*([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|pt|pc|cm|mm|in|em|ex|%)?\s*', value or '')
        if not match:
            raise SystemExit('SVG width and height must both use matching positive dimensions')
        number = float(match[1])
        if not math.isfinite(number) or number <= 0:
            raise SystemExit('SVG width and height must be positive and finite')
        return number, match[2] or 'px'
    if dimension(dimensions[0]) != dimension(dimensions[1]):
        raise SystemExit('SVG width and height must be square with matching units')
PY
      rsvg-convert -w 1024 -h 1024 -o "$target" "$source"
      ;;
    [pP][nN][gG])
      details="$(im "$source" -format '%n %m %w %h %[opaque]' info:)"
      read -r frames format width height opaque <<<"$details"
      [[ "$frames" == 1 && "$format" == PNG && "$width" == "$height" && "$width" -ge 1024 ]] || {
        echo 'PNG source must be a single square PNG of at least 1024x1024' >&2; exit 1;
      }
      im "$source" "$target"
      ;;
    *) echo 'Sources must use .svg or .png extensions' >&2; exit 1 ;;
  esac
  opaque="$(im "$target" -format '%[opaque]' info:)"
  case "$opaque" in
    [tT][rR][uU][eE]) ;;
    *) echo "Source contains transparency; provide an approved opaque background: $source" >&2; exit 1 ;;
  esac
}

prepare_source "$2" "$stage/regular-master.png"
prepare_source "$3" "$stage/maskable-master.png"
for size in 192 512; do
  im "$stage/regular-master.png" -resize "${size}x${size}" -alpha off -depth 8 -strip "PNG24:$stage/$app-icon-$size.png"
  im "$stage/maskable-master.png" -resize "${size}x${size}" -alpha off -depth 8 -strip "PNG24:$stage/$app-maskable-$size.png"
done
touch_name=apple-touch-icon.png
[[ "$app" != customer ]] || touch_name=apple-touch-icon-v4.png
im "$stage/regular-master.png" -resize 180x180 -alpha off -depth 8 -strip "PNG24:$stage/$touch_name"
rm "$stage/regular-master.png" "$stage/maskable-master.png"
python3 - "$ROOT_DIR/$app-app/public/manifest.webmanifest" "$stage/manifest.candidate.webmanifest" "$app" <<'PY'
import json, sys
with open(sys.argv[1]) as source:
    manifest = json.load(source)
manifest['icons'] = [
    {'src': f'./{sys.argv[3]}-{kind}-{size}.png', 'sizes': f'{size}x{size}',
     'type': 'image/png', 'purpose': purpose}
    for kind, purpose in [('icon', 'any'), ('maskable', 'maskable')]
    for size in [192, 512]
]
with open(sys.argv[2], 'w') as target:
    target.write(json.dumps(manifest, indent=2) + '\n')
PY
if [[ -n "$output" ]]; then
  mkdir -p "$(dirname "$output")"
  mv "$stage" "$output"
else
  output="$stage"
fi
trap - EXIT
echo "Review candidates: $output"
echo 'Maskable safe-zone appearance and final artwork approval remain manual checks.'
echo 'No live manifest, cache version, HTML reference or repository icon was updated.'
