# Aqaba SeaGo Mobile

The customer app is prepared for native Android and iOS packaging with Capacitor.

## App identity

- App name: `Aqaba SeaGo`
- Bundle / package ID: `com.aqabaseago.app`
- Web build directory: `dist`
- Brand background: `#071F33`
- Brand accent: `#18B8B0`

## Native assets

The existing launcher icon source remains `customer-app/assets/logo.svg`. Launch branding uses the approved `customer-app/public/app-customer.svg` without modifying its artwork. `scripts/generate-native-assets.sh` renders the native PNG resources after `cap add`; see `assets/ASSET_SOURCES.md`.

For an existing native project, run `bash scripts/generate-native-assets.sh all --splash-only` (or replace `all` with `android`/`ios`) followed by `npx cap sync`. This updates only launch assets/themes and never writes launcher icon files. It requires `rsvg-convert` and ImageMagick `identify`.

## Launch handoff and platform limits

The WebView background and native launch background are navy. Capacitor's native splash auto-hides after 900ms as a safety fallback, so a JavaScript bundle failure can expose the static branded retry screen. During normal startup the app explicitly hides the native splash with no exit fade once the web artwork is decoded and the web launch surface is ready, then starts the 3000ms web sequence. The native launch is a short platform-controlled handoff, not a second timed animation.

On Android 12 and later, the OS controls launch icon dimensions, masking, and the initial launch duration. A dedicated approved-artwork drawable and navy launch theme avoid displaying the former splash wheel without changing launcher icons. Android 12/12L third-party launchers have known OS splash-image limitations. System bars may follow OS edge-to-edge policies.

iOS launch storyboards support only static content. The generated launch image is centered with aspect-fit on navy, with no storyboard animation. The animated sequence runs in the WebView. OS launch durations and the exact size match at the native/WebView boundary cannot be guaranteed across all devices. A native rebuild is required to pick up the launch resource/theme changes; a web-only update cannot change an already installed native launch screen.

## Android build pipeline

`.github/workflows/mobile-native.yml` verifies the native project with a debug Android build and iOS simulator build.

`.github/workflows/mobile-release.yml` is the store release pipeline:

- Pushes to `main` build an unsigned release AAB as a regression check.
- Manual `workflow_dispatch` builds can produce a Play-ready signed AAB and a signed release APK.
- The manual release accepts `versionName` and `versionCode` inputs.
- Signed artifacts are verified before upload and include SHA-256 checksums plus release metadata.
- The signing keystore is written only to the temporary Actions runner and deleted at the end of the job.

## Android signing secrets

The permanent upload key must remain outside the repository. Add these four GitHub Actions repository secrets before requesting a signed release:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

The keystore itself, passwords and Apple signing material must never be committed. Root `.gitignore` blocks common signing-key file extensions as an additional guard.

## Authentication policy

The web app can continue using Google Sign-In. The installed native app currently hides Google Sign-In and uses email/password authentication only. This avoids exposing a third-party social login on iOS before Sign in with Apple is configured. When native Google Sign-In is enabled, Sign in with Apple should be enabled in the same release.

## Notifications

Web Push remains available to supported browsers. Native push registration plumbing is present using `@capacitor/push-notifications`, with authenticated API endpoints for storing Android/iOS device tokens. Native push should not be enabled in the UI until the production FCM/APNs credentials and native app configuration are installed.

## Account deletion and legal URLs

Customer account deletion is available from:

`Profile → Personal details → Delete my account`

Public pages included for store metadata:

- `privacy.html`
- `terms.html`
- `delete-account.html`

The deletion endpoint anonymizes/disables the login identity, removes web/native push subscriptions, invalidates password-reset tokens, and leaves only records that may be needed for booking, payment, fraud-prevention, accounting or legal obligations.

## Remaining external store credentials

These cannot be committed before the corresponding store/provider accounts exist:

- Google Play Console organization account / Internal Testing track
- GitHub Actions signing secrets for the Android upload key
- Apple Developer organization account
- Apple distribution signing / App Store Connect access
- Sign in with Apple capability and identifiers before enabling native Google login
- Firebase Android configuration (`google-services.json`) for FCM
- Apple APNs capability/credentials (or the selected iOS push provider configuration)

Do not commit signing keys, Apple private keys, Firebase service-account secrets or other store credentials to GitHub.
