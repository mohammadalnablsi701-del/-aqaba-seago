# Native Customer acceptance (post splash #251)

This branch reconciles the previously approved Direction A launcher from PR #240 with the **current** native launch animation and fixes Capacitor-relative JS/CSS URLs.

## Change boundary
- Customer native icon sources and generator only; icon PNG masters are the exact Git blobs already validated on PR #240.
- `customer-app/assets/logo.svg` exactly matches the approved `customer-app/public/app-customer.svg`.
- Preserve `customer-app/scripts/native-launch-assets.mjs`, Customer splash React logic, splash theme/color and existing start-up duration.
- Add explicit `--icons-only` mode; the pre-existing `--splash-only` stays supported.
- Switch **native jobs only** in `mobile-native.yml` and `mobile-release.yml` to `--base=./` and ensure the verifier rejects incorrect JS/CSS paths; Pages production `/-aqaba-seago/` remains unchanged.
- No backend, booking, payment, QR, Provider/Admin, signing or credential changes.

## Test gates and source of truth
1. GitHub CI must pass, including static icon integrity (decode/CRC/safe-circles), Customer native splash tests, Node Security Gate, Android APK/AAB build and iOS simulator build.
2. [Mobile Native Build](https://github.com/mohammadalnablsi701-del/-aqaba-seago/actions/workflows/mobile-native.yml) on **this PR** builds three artifacts: a Production API Android debug APK, an unsigned iOS Simulator app, and a separate **`Aqaba-SeaGo-STAGING-device-qa-debug`** APK that points strictly to `https://aqaba-seago-api-staging.onrender.com` and has native push disabled. Only use the **STAGING** APK with test accounts for reservation/check-in trials. Never create test bookings/payments/check-ins using the Production API artifact.
3. The Staging APK keeps the same Android package ID `com.aqabaseago.app` and therefore **cannot be safely co-installed** with the production app; it is labelled `SeaGo STAGING` in the launcher. Install only on a spare/test device or after preserving existing app data. Do not replace a real customer's installed app. This is a debug build, not Play-distributable, and no iOS physical-device build is produced.
4. Physical Android install: fresh installation and upgrade with preserved app storage, OS 12+ splash handoff, launcher icon masks on multiple launchers, 3-second WebView animation, signed-in/signed-out app open, deep links, back navigation and retry after airplane mode.
5. Physical iOS: signed development/TestFlight build needed; the unsigned CI simulator artifact cannot be installed on an iPhone. Validate icon against approved master, static OS-to-animated WebView handoff, account validation and PWA shortcuts separately.
6. Return actual device model, OS version, install type (PWA/native), scenario, expected/observed, screenshots and pass/fail. Keep the branch unmerged until these gates have objective evidence.

## Explicit limitations
This PR only prepares and builds code. No one has confirmed physical-device pass or test transactions. A successful GitHub Actions build is *not* acceptance of a native app.
