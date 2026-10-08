# Aqaba SeaGo Mobile

The customer web app is prepared for iOS and Android with Capacitor.

## App identity

- App name: `Aqaba SeaGo`
- Bundle / package ID: `com.aqabaseago.app`
- Web build directory: `dist`

## Requirements

Capacitor 8 requires Node.js 22 or newer. Native iOS builds require macOS with Xcode. Native Android builds require Android Studio and the Android SDK.

## First native project generation

From `customer-app/`:

```bash
npm install
npm run build
npm run mobile:add:android
npm run mobile:add:ios
npm run mobile:sync
```

Commit the generated `android/` and `ios/` projects after they are created and verified.

## Daily development

After changing the React app:

```bash
npm run mobile:sync
```

Open the native projects with:

```bash
npm run mobile:open:android
npm run mobile:open:ios
```

## Production API

The mobile app continues to use the same production API as the web app. Native WebView origins are explicitly allowed by the backend CORS configuration.

## Store readiness still pending

Before store submission, complete native app icons/splash assets, Sign in with Apple, native push notifications, privacy/terms/account-deletion review, signing certificates, store screenshots, TestFlight testing, and Google Play internal testing.
