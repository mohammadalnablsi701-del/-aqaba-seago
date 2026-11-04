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
2. Use [the native build workflow](https://github.com/mohammadalnablsi701-del/-aqaba-seago/actions/workflows/mobile-native.yml) artifacts for static launch, icon mask and navigation checks. **The CI debug build embeds the PRODUCTION API. Do not create test bookings/payments/check-ins on it.** Use isolated Staging for transactional QA.
3. Physical Android install: fresh installation and upgrade with preserved app storage, OS 12+ splash handoff, launcher icon masks on multiple launchers, 3-second WebView animation, signed-in/signed-out app open, deep links, back navigation and retry after airplane mode.
4. Physical iOS: signed development/TestFlight build needed; the unsigned CI simulator artifact cannot be installed on an iPhone. Validate icon against approved master, static OS-to-animated WebView handoff, account validation and PWA shortcuts separately.
5. Return actual device model, OS version, install type (PWA/native), scenario, expected/observed, screenshots and pass/fail. Keep the branch unmerged until these gates have objective evidence.

## Explicit limitations
This PR only prepares and builds code. No one has confirmed physical-device pass or test transactions. A successful GitHub Actions build is *not* acceptance of a native app.
