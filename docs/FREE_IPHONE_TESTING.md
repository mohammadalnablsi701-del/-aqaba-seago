# Aqaba SeaGo — Free iPhone Testing

This path is for testing Aqaba SeaGo on a personal iPhone without paying for the Apple Developer Program yet.

## What this gives us

- A real Aqaba SeaGo iOS/Capacitor project.
- Branded iOS assets.
- Native web base `./`.
- iOS native push kept off for V1.
- Staging backend by default for safe testing.
- Optional Production backend preparation when we intentionally choose it.
- Free on-device signing through Xcode using an Apple Account `Personal Team`.

It does **not** provide TestFlight or App Store distribution. Those require Apple Developer Program membership.

## Requirements

- A Mac capable of running Xcode 26 or newer.
- Xcode 26 or newer.
- The iPhone to be tested.
- A normal Apple Account. Paid Apple Developer membership is not required for this stage.
- USB or supported wireless device connection between the Mac and iPhone.

## Easiest path: use the GitHub-generated Xcode project

The workflow `.github/workflows/free-ios-device-project.yml` prepares a ready iOS project without any signing secrets.

For pull requests it intentionally builds against **Staging** by default.

1. Open the GitHub Actions run named `Free iPhone Device Project` for the current Apple RC.
2. Download the artifact named similar to `aqaba-seago-free-iphone-staging-<commit>`.
3. Unzip it on the Mac.
4. Open `ios/App/App.xcodeproj` in Xcode.
5. In Xcode, go to **Xcode > Settings > Accounts** and sign in with your Apple Account.
6. Select the `App` project, then the `App` target, then **Signing & Capabilities**.
7. Enable **Automatically manage signing**.
8. Under **Team**, choose your **Personal Team**.
9. Connect the iPhone and select it as the run destination.
10. Press **Run**.
11. If iOS asks for Developer Mode, enable it and follow the phone's restart/confirmation flow.

### If Xcode says the bundle identifier is unavailable

The release bundle identifier is `com.aqabaseago.app`.

For this local free build only, change the target's Bundle Identifier to a unique development value, for example:

`com.aqabaseago.app.dev`

If that is also unavailable, add a unique suffix. This local change is only for free development signing and must not be committed back to the release branch.

## Local preparation alternative

If the repository is cloned on the Mac, from `customer-app` run:

```bash
brew install imagemagick librsvg
npm run ios:free:staging
```

For an intentional Production-backed local build:

```bash
npm run ios:free:production
```

The script rebuilds the app using `--base=./`, regenerates the iOS project and branding, verifies the correct backend is embedded, performs an unsigned simulator compile, and opens Xcode.

## Safe test order on the iPhone

Use Staging first:

1. Cold launch and splash screen.
2. Home and trip list.
3. Trip details and dates.
4. Login/register using email/password.
5. Profile and account-deletion entry point.
6. Booking flow up to the controlled Staging payment boundary.
7. Ticket/QR display using test data.
8. Background/foreground cycles.
9. Airplane mode / network loss and recovery.
10. Reopen after force-close.
11. Check safe areas, keyboard, back navigation, external links, and orientation behavior.

Only after Staging is clean should we intentionally prepare a Production-backed free build for non-destructive acceptance checks.

## Free Personal Team limits

Apple currently allows personal-device testing without paid membership through Xcode Personal Team signing. Free provisioning is temporary: Personal Team App IDs, devices, and provisioning profiles expire after 7 days, and the app must then be rebuilt/reinstalled. Apple also documents limits of up to 10 App IDs, 3 devices, and 3 installed free-development apps per device.

Official Apple references:

- https://developer.apple.com/help/account/basics/about-your-developer-account
- https://developer.apple.com/help/account/membership/programs-overview

## Promotion rule

Passing this free iPhone test does not authorize merging the Apple RC to `main` or submitting to Apple.

The paid-release gate remains separate: signed Distribution archive, TestFlight upload, exact-TestFlight physical-iPhone acceptance, future sellable Production departure, real payment-to-confirmed-booking-to-ticket flow, reviewer account, and App Store Connect metadata/privacy labels.
