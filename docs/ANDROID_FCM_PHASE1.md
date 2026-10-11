# Android FCM, customer app only

Baseline inspected: `ff4683218a8447e96eb46366ceef955371cb2952` (main).
Backend: repository root, Express/Mongoose in `src/`. Existing JWT authentication,
MongoDB notifications and browser Web Push remain in use. iOS FCM is not implemented.

## Firebase configuration

- Project: `aqaba-seago-7c92`
- Project number: `173154283669`
- Android package: `com.aqabaseago.app`
- Nickname: `Aqaba SeaGo Customer Android`
- Firebase Android App ID: `1:173154283669:android:3553d4df3e888968772b9c`
- FCM HTTP v1 API (`fcm.googleapis.com`) was read-verified ENABLED.

Only the Android app was registered. No Analytics, Firestore, Authentication,
Storage, Functions or billing is needed or enabled by this implementation.

Download the Android app's `google-services.json` from Firebase project settings
or Firebase CLI. It is client configuration, not a service-account key.
Store its base64 encoding in the GitHub Actions secret
`FIREBASE_ANDROID_CONFIG_BASE64`. Do not commit the file. This secret has NOT been
installed by this patch.

The two Android workflows generate `customer-app/android` on each run, then run
`node scripts/configure-android-firebase.mjs` before sync/build. The script rejects
wrong project ID/number, package, Firebase App ID, malformed encoding and extra
clients, and writes `android/app/google-services.json`. It validates the generated
application ID and Google Services plugin. Analytics collection is disabled in
the manifest. Messaging auto-init follows the build gate. No Analytics SDK is added.

`VITE_NATIVE_PUSH_ENABLED` defaults to false. A disabled build may omit the config;
an enabled build fails if it is absent. A supplied wrong config always fails.
The Android workflow reads the repository variable `VITE_NATIVE_PUSH_ENABLED`,
defaulting to false. Leave it absent/false until an explicitly approved device test.

Local builds: export the same base64 variable and build gate, then run
`npm run mobile:add:android` on first generation and `npm run mobile:sync:android`
thereafter in `customer-app`. Do not use a generic sync to skip the configuration
validation step. The existing `VITE_API_BASE_URL` still selects the backend.

## Backend credentials: manual setup required, no key generated

Create a dedicated Google Cloud service account, suggested name
`seago-customer-fcm`, in `aqaba-seago-7c92`. Grant only the predefined
`roles/firebasecloudmessaging.admin` (Firebase Cloud Messaging API Admin) role
on this project, or a reviewed custom sender role with
`cloudmessaging.messages.create`. Do not grant Owner, Editor, Firebase Admin,
or service-agent roles.

For the existing Render backend, an authorized owner must create a JSON private
key for that identity and place it directly into a Render **Secret File** named:

`firebase-service-account.json`

Render runtime settings:

```dotenv
FCM_ENABLED=false
FIREBASE_PROJECT_ID=aqaba-seago-7c92
GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/firebase-service-account.json
```

Keep the key out of GitHub source, Actions secrets/artifacts, chat, logs, mobile
builds and all `VITE_*` variables. Do not paste it into an implementation PR.
This phase creates no key, configures no Render secrets, and deploys nothing.
For environment-variable edits, choose Save only when available. Do not choose a deploy option; schedule any deployment separately.

The sender uses pinned `firebase-admin@13.10.0` (Node 20 compatible), its modular
App/Messaging entry points, and FCM HTTP v1. It reads only the explicit secret-file
path, validates its service-account type/project, and never falls back to ambient
developer credentials. Missing/incorrect config skips delivery with a safe code.
No legacy FCM server key, Firebase client web config or new VAPID key is required.

## Delivery and isolation

- Native sending is gated by exact `FCM_ENABLED=true`, independently of VAPID.
- `/api/push/native-status`, `native-subscribe`, `native-unsubscribe`, and
  `native-test` require the existing JWT and the customer role.
- Registration accepts only the exact Android/FCM/project/app context in
  `shared/nativePushContext.js`. MongoDB stores that context with installation,
  owner, token and timestamps. Old rows without metadata and iOS/APNs rows are
  not sent through FCM.
- Owner-scoped upserts plus existing unique token/installation indexes reject
  cross-account collisions. Logout/switch cleanup precedes rebinding. Revocation
  works even while sending is disabled. Verify indexes exist before activation.
- Notifications are generic on the lock screen; data is allowlisted. Taps open
  the local notifications screen, never an arbitrary payload URL.
- Only FCM's explicit invalid/unregistered-token errors revoke tokens. Payload,
  credential, quota, network and service errors preserve them. There is no durable
  push retry queue in this phase: a transient failure is counted/logged safely;
  the existing in-app notification remains available, and a test/new notification
  can retry delivery. No raw token, provider error or key is logged.
- Client registration has a timeout, safe status messages, refresh listeners,
  opted-in restart/resume reconciliation and cancellation on account changes.
  Browser/PWA retains Web Push; iOS native remains unsupported for Phase 1.
- Offline logout attempts both server removal and device unregistration; failures
  are surfaced with safe status/log messages. Reconnect and verify cleanup before
  switching accounts on a device. Android plugin `unregister()` does not await
  Firebase token deletion, so real-device logout/relogin testing is mandatory.

## Validation and activation checklist

Automated coverage: customer authorization, Android metadata, MongoDB uniqueness,
cross-account rejection/revocation, disabled sender, invalid vs transient errors,
private payload/logging, Web Push independence, bad Android config, native
permission/error/timeout/restart/refresh/logout/switch lifecycle.

The ordinary backend test suite runs new unit tests. The CI disposable MongoDB
job includes `test/android-fcm.integration.test.js`. Mobile CI validates generated
Android projects; no workflow uploads to Play or deploys the backend.

Before any production claim:

1. Review/merge through the protected-main PR process, with green CI.
2. Install the Android configuration secret and the dedicated backend credential.
3. Separately authorize a controlled backend deployment and enabled Android build.
4. Use a signed Android build and real device with Google Play services. Existing
   signing secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
5. Verify foreground/background notification receipt from the actual backend,
   tap routing, Android 13+ permission denial, restart, token refresh, logout,
   account switching, invalid cleanup and disabled-feature behavior.

No real device delivery or production readiness is claimed by this phase.

## Local handoff status

At the user's final instruction, all repository changes remain local. No remote
branch or pull request was created, no merge occurred, and nothing was deployed.
Local branch: `codex/android-fcm-phase1`.

Validation completed:
- Focused Android FCM tests: 25 passed.
- Full backend suite: 323 total, 293 passed, 30 skipped, zero failed.
- Customer production build and production API/base-path verification passed.
  Windows realpath EPERM required a local Vite preserveSymlinks override; the
  repository build configuration was not changed for this workaround.
- Actual Android Firebase config validated and generated Android project synced.
- MongoDB integration could not run locally: the disposable MongoDB process
  failed to start. Those tests remain unverified; no remote CI was run.
- APK/AAB build was not run locally because Java is unavailable.
- No signed real-device delivery test was performed.

Readiness: code implemented with the validation gaps above; configuration is
partial until GitHub/Render secrets are installed; device testing and production
sending are not ready. Both feature flags remain false by default.