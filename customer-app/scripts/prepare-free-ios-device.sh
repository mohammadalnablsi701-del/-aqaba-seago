#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-staging}"

case "$TARGET" in
  staging)
    API_URL="https://aqaba-seago-api-staging.onrender.com"
    FORBIDDEN_URL="https://aqaba-seago-api.onrender.com"
    ;;
  production)
    API_URL="https://aqaba-seago-api.onrender.com"
    FORBIDDEN_URL="https://aqaba-seago-api-staging.onrender.com"
    ;;
  *)
    echo "Usage: bash scripts/prepare-free-ios-device.sh [staging|production]" >&2
    exit 2
    ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Free physical-iPhone signing requires macOS + Xcode." >&2
  exit 1
fi

for cmd in xcodebuild npm node; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing required command: $cmd" >&2; exit 1; }
done

XCODE_VERSION="$(xcodebuild -version | awk 'NR==1{print $2}')"
XCODE_MAJOR="${XCODE_VERSION%%.*}"
if [[ ! "$XCODE_MAJOR" =~ ^[0-9]+$ ]] || (( XCODE_MAJOR < 26 )); then
  echo "Xcode 26 or newer is required. Found: $XCODE_VERSION" >&2
  exit 1
fi

if ! command -v magick >/dev/null 2>&1 || ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "Native branding tools are missing." >&2
  echo "Install once with: brew install imagemagick librsvg" >&2
  exit 1
fi

echo "Preparing Aqaba SeaGo free iPhone project for: $TARGET"
echo "API: $API_URL"

npm ci --no-fund
rm -rf dist ios

VITE_API_BASE_URL="$API_URL" \
VITE_NATIVE_PUSH_ENABLED="false" \
npm run build -- --base=./

node scripts/verify-build-env.mjs \
  --expected="$API_URL" \
  --forbidden="$FORBIDDEN_URL" \
  --base="./" \
  --label="Free iPhone $TARGET pre-sync"

npx cap add ios
bash scripts/generate-native-assets.sh ios
npx cap sync ios

node scripts/verify-build-env.mjs \
  --dist="ios/App/App/public" \
  --expected="$API_URL" \
  --forbidden="$FORBIDDEN_URL" \
  --base="./" \
  --label="Free iPhone $TARGET synced"

PBX="ios/App/App.xcodeproj/project.pbxproj"
INFO="ios/App/App/Info.plist"

grep -q 'PRODUCT_BUNDLE_IDENTIFIER = com.aqabaseago.app;' "$PBX"
grep -A1 '<key>CFBundleDisplayName</key>' "$INFO" | grep -q 'Aqaba SeaGo'

if grep -Eq 'NSAllowsArbitraryLoads|NSAllowsArbitraryLoadsInWebContent' "$INFO"; then
  echo "Unexpected broad ATS exception" >&2
  exit 1
fi

xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -derivedDataPath ios/DerivedDataFree \
  CODE_SIGNING_ALLOWED=NO \
  build

cat <<'EOF'

Free iPhone project is ready.

In Xcode:
1. Open Xcode > Settings > Accounts and sign in with your Apple Account.
2. Select project "App" > target "App" > Signing & Capabilities.
3. Enable "Automatically manage signing".
4. Choose your "Personal Team".
5. Connect your iPhone, select it as the run destination, then press Run.
6. If Xcode says the bundle identifier is unavailable, change it ONLY for this local free build to a unique value such as com.aqabaseago.app.dev.

Free Personal Team provisioning expires periodically; rebuild/reinstall when Xcode asks.
EOF

npx cap open ios
