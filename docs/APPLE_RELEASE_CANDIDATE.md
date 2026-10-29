# Aqaba SeaGo — Apple Release Candidate Gate

This branch is the controlled release-candidate integration point for the first Aqaba SeaGo Customer iOS/App Store build.

## Baseline

- Feature baseline: current `staging` branch.
- Production security contract carried forward: Node.js `22.23.4`, patched backend lockfile, High/Critical dependency rejection.
- Customer native identity: `Aqaba SeaGo` / `com.aqabaseago.app`.
- iOS native web base: `./`.
- Production API: `https://aqaba-seago-api.onrender.com`.
- Staging API is forbidden in the production iOS artifact.
- Native push remains disabled for the first iOS release.

## Release order

1. Merge current `main` into this RC branch so Production-only security history is represented without changing Production.
2. Run the Apple RC workflow with TestFlight upload disabled. The unsigned/simulator and signed archive gates must pass as applicable.
3. Configure Apple signing/App Store Connect secrets.
4. Run the workflow with TestFlight upload enabled.
5. Complete physical iPhone acceptance from the exact TestFlight build.
6. Only then promote this RC to `main`.

## Required Apple secrets

The TestFlight path expects these GitHub Actions secrets:

- `APPLE_TEAM_ID`
- `APPLE_DISTRIBUTION_CERT_P12_BASE64`
- `APPLE_DISTRIBUTION_CERT_PASSWORD`
- `APPLE_PROVISIONING_PROFILE_BASE64`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_P8_BASE64`

The certificate secret must contain the Apple Distribution `.p12` including its private key. The provisioning profile must be an App Store distribution profile for `com.aqabaseago.app`. The App Store Connect API key is used only for TestFlight upload.

Do not commit certificates, provisioning profiles, API private keys, or passwords.

## Gate requirements

A release candidate is not eligible for promotion unless all of the following are true:

- Node runtime contract is exactly `22.23.4`.
- `body-parser` is at least the patched `1.20.9` dependency resolved by the lockfile.
- `ip-address` is at least the patched `10.7.5` dependency resolved by the lockfile.
- Backend safety/unit/disposable-DB tests pass.
- Customer, Provider and Admin builds pass.
- Customer iOS production build embeds only the Production API.
- Capacitor assets use `./` as the native web base.
- Bundle ID remains `com.aqabaseago.app`.
- No broad ATS bypass is introduced.
- No unnecessary Customer camera/photo permission is introduced.
- Native push stays disabled for iOS V1.
- A signed `.xcarchive` and exported `.ipa` pass signing verification.
- The exact `.ipa` is uploaded to TestFlight successfully before App Review submission.

## Physical-device acceptance

Use the TestFlight build, not Add to Home Screen, for final acceptance:

- cold launch and relaunch
- login/register/password reset
- Home/trip/departure loading from Production
- pricing and booking selection
- payment handoff and return
- confirmed booking and ticket QR
- cancellation path
- account deletion
- external Maps/support links
- notch/Dynamic Island/home-indicator safe areas
- no blank or browser-like dead-end screens

Production submission remains blocked until a future sellable departure and a complete real payment-to-confirmed-ticket flow are available to App Review.