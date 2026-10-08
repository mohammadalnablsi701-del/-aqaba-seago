# Aqaba SeaGo Mobile

The customer app is prepared for native Android and iOS packaging with Capacitor.

## App identity

- App name: `Aqaba SeaGo`
- Bundle / package ID: `com.aqabaseago.app`
- Web build directory: `dist`
- Brand background: `#071F33`
- Brand accent: `#18B8B0`

## Native assets

The source artwork lives in `customer-app/assets/logo.svg`. The native workflow uses `@capacitor/assets` to generate the Android and iOS icon and splash resources from that source.

## Build pipeline

`.github/workflows/mobile-native.yml` now verifies:

- Android debug APK
- Android release AAB build (unsigned until the permanent Play upload key is configured)
- iOS simulator app build without code signing

Production store signing is intentionally not stored in the repository.

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

- Google Play Console organization account
- permanent Android upload keystore / Play App Signing setup
- Apple Developer organization account
- Apple distribution signing / App Store Connect access
- Sign in with Apple capability and identifiers before enabling native Google login
- Firebase Android configuration (`google-services.json`) for FCM
- Apple APNs capability/credentials (or the selected iOS push provider configuration)

Do not commit signing keys, Apple private keys, Firebase service-account secrets or other store credentials to GitHub.
