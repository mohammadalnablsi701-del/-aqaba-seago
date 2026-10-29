# Apple signing secrets for Aqaba SeaGo

The iOS App Store release workflow is intentionally fail-closed. TestFlight upload is unavailable until all required GitHub Actions secrets are configured.

## Required values

### `APPLE_TEAM_ID`
Apple Developer Team ID that owns `com.aqabaseago.app`.

### `APPLE_DISTRIBUTION_CERT_P12_BASE64`
Base64 of an Apple Distribution certificate exported as `.p12` together with its private key.

On macOS:

```bash
base64 < AqabaSeaGo-Distribution.p12 | tr -d '\n'
```

### `APPLE_DISTRIBUTION_CERT_PASSWORD`
Password used when exporting the `.p12`.

### `APPLE_PROVISIONING_PROFILE_BASE64`
Base64 of the App Store distribution provisioning profile for `com.aqabaseago.app`.

```bash
base64 < AqabaSeaGo_AppStore.mobileprovision | tr -d '\n'
```

### `APP_STORE_CONNECT_KEY_ID`
Key ID for an App Store Connect API key authorized to upload builds.

### `APP_STORE_CONNECT_ISSUER_ID`
Issuer ID shown for App Store Connect API keys.

### `APP_STORE_CONNECT_API_KEY_P8_BASE64`
Base64 of the downloaded `AuthKey_<KEY_ID>.p8` private key.

```bash
base64 < AuthKey_XXXXXXXXXX.p8 | tr -d '\n'
```

## Security rules

- Never commit any of these values or decoded files.
- Store them only as GitHub Actions secrets or another approved secret store.
- Keep native iOS push disabled for V1; APNs credentials are not required for the first release.
- Rotate/revoke the App Store Connect API key immediately if it is exposed.
- The workflow removes temporary certificate/profile/key material from the runner in its cleanup step.
