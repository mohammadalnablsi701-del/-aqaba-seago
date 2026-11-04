# Aqaba SeaGo — iOS Real-Device Test Build

This path is intentionally isolated from Production. It builds the existing Customer App for iOS with the Staging API and native push disabled.

## Fixed identity

- App name: `Aqaba SeaGo`
- Bundle ID: `com.aqabaseago.app`
- API: `https://aqaba-seago-api-staging.onrender.com`
- Native push: disabled for this test build
- Capacitor web base: `./`

Do not replace the bundle ID with a second ID. If Xcode reports that the identifier cannot be signed by the selected Apple team, select the correct team/account rather than changing the app identity.

## Mac prerequisites

- macOS with Xcode 26 or newer
- Node.js 22 or newer
- An Apple Account signed into Xcode
- The test iPhone connected/paird with the Mac and Developer Mode enabled when iOS requests it

Apple Developer Program membership is not required for local installation on your own iPhone through Xcode. A free Personal Team can be used; its development provisioning expires periodically and the app must then be rebuilt/reinstalled.

## One-time native project creation and sync

From the repository root:

```bash
cd customer-app
npm ci --no-fund

VITE_API_BASE_URL=https://aqaba-seago-api-staging.onrender.com \
VITE_NATIVE_PUSH_ENABLED=false \
npm run build -- --base=./

node scripts/verify-build-env.mjs \
  --expected="https://aqaba-seago-api-staging.onrender.com" \
  --forbidden="https://aqaba-seago-api.onrender.com" \
  --base="./" \
  --label="iOS STAGING real-device"

# Run only when customer-app/ios does not exist.
npm run mobile:add:ios

# Required by the existing native asset generator if not already installed.
brew list imagemagick >/dev/null 2>&1 || brew install imagemagick
brew list librsvg >/dev/null 2>&1 || brew install librsvg

bash scripts/generate-native-assets.sh ios
npx cap sync ios

node scripts/verify-build-env.mjs \
  --dist="ios/App/App/public" \
  --expected="https://aqaba-seago-api-staging.onrender.com" \
  --forbidden="https://aqaba-seago-api.onrender.com" \
  --base="./" \
  --label="iOS STAGING synced artifact"

npm run mobile:open:ios
```

For subsequent web-code changes, do not run `cap add ios` again. Rebuild with the same Staging environment and relative base, then run `npx cap sync ios`.

## Xcode signing for one personal iPhone

1. Open `ios/App/App.xcodeproj` (or use `npm run mobile:open:ios`).
2. Select the `App` target.
3. Open **Signing & Capabilities**.
4. Keep **Automatically manage signing** enabled.
5. Select your Apple Account / **Personal Team**.
6. Confirm bundle identifier remains `com.aqabaseago.app`.
7. Do not add Push Notifications for this test build.
8. Select the connected iPhone as the run destination.
9. Press **Run**.

No TestFlight/App Store distribution is involved in this path.

## Permissions and iOS-specific scope

The current Customer App displays ticket QR codes but does not contain a QR-camera scanner implementation. It therefore does not need camera or photo-library permission for this test build. Do not add `NSCameraUsageDescription`, photo-library usage strings, or unrelated capabilities unless a real Customer App feature is later added that requires them.

Both the Staging and Production APIs use HTTPS. This Staging test build therefore requires no broad App Transport Security exception such as `NSAllowsArbitraryLoads`.

Native Google Sign-In is intentionally hidden by the current Customer App. Email/password remains the native authentication path. Do not add a Google iOS URL scheme or Sign in with Apple only for this test build.

Native push is intentionally disabled through `VITE_NATIVE_PUSH_ENABLED=false`; do not add APNs/Push Notifications capability for this task.

## Real-device acceptance checklist

- App installs and launches on the connected iPhone.
- Aqaba SeaGo splash/branding appears correctly.
- No blank/white screen on cold start or after back/close navigation.
- Email/password login works against Staging.
- Home loads and trips load from Staging.
- Date selection works.
- Trip details open correctly.
- Booking UI can be inspected, but do not execute a real payment.
- Ticket UI renders correctly for existing safe test data.
- Ticket QR renders correctly. Customer App camera scanning is not expected in the current codebase.
- Google Maps links open correctly where a departure location supplies a Maps URL/address.
- External communication links, if surfaced by current UI, open correctly.
- API calls use `https://aqaba-seago-api-staging.onrender.com` only.
- Safe-area layout is correct around the notch/Dynamic Island and home indicator.
- Native push remains disabled for this build.

## CI readiness workflow

`.github/workflows/mobile-ios-staging.yml` generates the iOS platform on a macOS runner, creates branded icons/splash assets, syncs Capacitor, verifies the Staging API and relative asset base, rejects unnecessary camera/photo or broad ATS exceptions, checks `com.aqabaseago.app` and iOS 15.0, then compiles an unsigned simulator build.

The simulator artifact is a build-readiness proof only. Installing on a physical iPhone still requires Xcode signing with the Apple Account/Team that owns the device provisioning step.
