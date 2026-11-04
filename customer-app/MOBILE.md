# Aqaba SeaGo Mobile

The customer app is prepared for native Android and iOS packaging with Capacitor.

## App identity

- App name: `Aqaba SeaGo`
- Bundle / package ID: `com.aqabaseago.app`
- Web build directory: `dist`
- Brand background: `#071F33`
- Brand accent: `#18B8B0`

## Native assets

The approved Direction A icon artwork lives in `customer-app/assets/logo.svg`,
with the supplied `assets/icon-master-1024.png` as the native pixel authority.
Android uses the separately approved foreground/background exports without extra
padding or transforms. Splash artwork is independent in `assets/splash.svg`.
The native workflows call
`scripts/generate-native-assets.sh` using `rsvg-convert`, ImageMagick and Python 3.
Use its `--icons-only` option to preserve splash resources during icon-only work.
See the [launcher icon integration report](../docs/APP_LAUNCHER_ICONS.md) for
source provenance, exact output sizes, validation and device acceptance limits.

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
