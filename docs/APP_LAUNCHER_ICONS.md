# Launcher icon audit and preparation

Status: **awaiting final approved high-resolution artwork**. The requester confirmed
that they will supply the final sources. This change prepares generation and review;
it does not install or claim approval of a new Customer or Provider design.

Audit baseline: `main`, `32717483c7ed8ea055301e02269c0e680907c318`.
Working branch: `fix/launcher-icons-platform-integration`. Do not merge or release
this preparation as a completed branding update.

## Architecture discovered

| Experience | Technology | Existing install surfaces |
| --- | --- | --- |
| Customer, `customer-app/` | React 18, Vite 6, Capacitor 8 | Android, iOS and PWA |
| Provider, `provider-app/` | React 19, Vite 8 | Separate PWA only |

There are separate Customer and Provider web entry points, not one native app whose
icon changes with the signed-in role. Only Customer has a Capacitor configuration:
`appId: com.aqabaseago.app`, `appName: Aqaba SeaGo`, `webDir: dist`.
Neither app is Expo/React Native. No flavors, separate native targets, alternate
icons, Expo app config, or Provider native package were found on this baseline.

Customer `android/` and `ios/` are generated, gitignored directories. The actual
native integration point is `customer-app/scripts/generate-native-assets.sh`, called
after `cap add` and before `cap sync` by `mobile-native.yml` (Android and iOS) and
`mobile-release.yml` (Android). These workflows and the app identity are unchanged.

The generated Android manifest references `@mipmap/ic_launcher` and
`@mipmap/ic_launcher_round`. Adaptive XML lives in `mipmap-anydpi-v26/`.
The installed Capacitor 8 iOS template has
`Assets.xcassets/AppIcon.appiconset/Contents.json` with a universal 1024-square
`AppIcon-512@2x.png`. Smaller entries, if required by a different reviewed catalog,
are generated from their declared size and scale. `Info.plist`, project identity,
permissions, Firebase, signing and certificates are not modified.

Two PWA icons are possible now because each web app has its own HTML and manifest.
A separate native Provider icon cannot be delivered today. The smallest future
architecture addition would be a Capacitor wrapper around the existing Provider
web app, with separately agreed package/bundle IDs and signing. That would need a
separate task; this change creates no wrapper or invented Provider identifier.

## Source evidence and missing artwork

The current `main` sources are the older navy helm design:

- Customer native: `customer-app/assets/logo.svg` (teal helm).
- Customer web: `customer-app/public/app-customer.svg` (same mark).
- Provider web: `provider-app/public/app-provider.svg` (gold helm).
- Customer splash: `customer-app/assets/splash.svg`, independent of the icon.

History also contains a newer light Customer / dark Provider nautical composition:
`4f1119da37efda956d7464ae6401f8ad24b7b0dc`, documented in its
`docs/BRANDING_IDENTITY.md` and merged to `staging` in PR #228. However,
[PR #230](https://github.com/mohammadalnablsi701-del/-aqaba-seago/pull/230)
records real-iPhone rejection of the simplified SVG-derived Customer artwork.
Subsequent corrections include only small 180/192-pixel rasters, not a verified
1024-pixel original suitable for native delivery. Those branches are not imported.
No final high-resolution attachments were available during this audit.

Required from the owner/designer for **each** experience:

1. The exact final approved square icon: vector SVG or opaque PNG at least
   1024×1024, without pre-rounded OS corners. No enlargement of the 180/192 exports.
2. A separately approved opaque maskable composition with the complete essential
   mark inside the central circle of diameter 80% of the canvas.
3. For Customer Android, separate approved transparent foreground and opaque
   background exports. Essential foreground content must fit Android's central
   66dp-diameter safe circle on its 108dp canvas. The current wheel extraction is
   explicitly limited to the old master and must be reviewed for replacement art.
4. A separately approved monochrome mark only if themed icons are requested.
   The existing template has no monochrome reference; none is invented here.

Keep the approved source exports together with their approval/provenance and
checksums. Do not redraw the design, flatten an unexpected transparent source onto
an arbitrary color, or silently reuse the historic low-resolution PNGs.

## Current output inventory and defects

| Tracked surface | Current source/reference | Audit result |
| --- | --- | --- |
| Customer PWA 192 | `customer-icon-192.png?v=identity-v3` | Decodes, but raster differs from current SVG |
| Customer PWA 512 | `customer-icon-512.png?v=identity-v3` | **Invalid IDAT CRC** |
| Customer unused legacy raster | `icon-192.png` | **Malformed/truncated PNG**, no references found |
| Customer Apple touch / push icon | `apple-touch-icon-v4.png` | Valid palette PNG, old design |
| Customer favicon | `app-customer.svg?v=identity-v2` | Old design |
| Provider manifest | `app-provider.svg?v=identity-v1` | SVG only; missing PNG 192/512 fallbacks |
| Provider Apple touch | `apple-touch-icon.png?v=identity-v2` | Valid palette PNG, old design |
| Provider favicon | `app-provider.svg?v=identity-v2` | Old design |

The existing Customer manifest combines `any maskable` on the same raster entries;
the final integration should separate those purposes. Existing query versions are
inconsistent. Neither service worker has a fetch cache or CacheStorage handler;
there is no icon service-worker cache to clear. Installed browser/OS metadata and
previous native build resources can nevertheless retain old icons.

These tracked artworks and manifest references remain unchanged pending final
sources. The known corrupted files are documented, not represented as repaired.

## Preparation implemented

- Customer native generation now handles legacy/round icons, a transparent padded
  adaptive foreground and separate navy background explicitly. It follows the iOS
  catalog instead of repainting arbitrary PNG files and emits opaque RGB icons.
  It refuses an unfamiliar adaptive master instead of assuming the old wheel's
  geometry applies. Generated resources remain gitignored.
- `--icons-only` permits isolated icon generation and preserves all splash files.
  Default workflow invocations retain their existing splash generation, using the
  same independent `splash.svg`. No splash artwork or reference is changed.
- `scripts/prepare-pwa-icons.sh` accepts separate final regular and maskable inputs,
  validates dimensions/opacity and creates review-only PNGs (180, 192 and 512) and
  a candidate manifest outside the repository. It does not overwrite live files,
  rewrite HTML, or claim visual approval of a maskable composition.

Example once final sources are available:

```sh
bash scripts/prepare-pwa-icons.sh customer /path/customer.svg /path/customer-maskable.svg
bash scripts/prepare-pwa-icons.sh provider /path/provider.svg /path/provider-maskable.svg
cd customer-app
bash scripts/generate-native-assets.sh all --icons-only
```

Native tools: Python 3, `rsvg-convert`, ImageMagick. Existing native Actions runners
already supply Python and install the image tools. No dependency or lockfile change
is required. Native generation currently uses the existing `assets/logo.svg`; it
does **not** automatically accept unreviewed new artwork as a safe adaptive icon.

## Final integration checklist (blocked on artwork)

1. Review the exact supplied sources and independent Customer/Provider identity.
   Replace the relevant masters only after that review; keep native/web Customer
   art consistent. Adapt the native foreground/background input to the final
   approved layered exports rather than reusing the old wheel transformation.
2. Generate full-quality, square, unrounded iOS RGB 1024 and every catalog entry;
   Android legacy/round density sets and adaptive layers; PWA PNG192/512 and
   separate maskable PNG192/512. Do not add native Provider assets.
3. Integrate PWA candidates, using new consistent versioned filenames/references
   across HTML, manifest and Customer push icon. Preserve manifest names,
   start URL, scope, display mode and build base. Reconcile Safari metadata with
   the real-device findings in PRs #230–234; do not assume a cache bump alone fixes
   the reported installation failure. Remove the unused corrupted `icon-192.png`
   and retire stale files after checking all references.
4. Recreate native projects or clean old resource/build outputs; regenerate,
   sync, validate XML/resource references, iOS catalog sizes and PNG full decode,
   dimensions and alpha channels. Verify all final essential art against circle,
   rounded-square and maskable launcher masks.
5. Run unsigned Android and iOS build checks and physical Android/iPhone/PWA
   installation/update checks on the exact candidate. Existing installed shortcuts
   may need removal and reinstallation; never clear app data as an icon fix.

## Verification and limits

Checks actually executed in this environment with the **unchanged old artwork**:

| Check | Result |
| --- | --- |
| Locked `npm ci` and `npm run build`, Customer and Provider | PASS; existing hero-path / bundle-size warnings |
| Capacitor 8 `cap add android` and `cap add ios` | PASS; generated projects only, not compilation |
| Native icon generation against those actual templates | PASS; 15 Android PNGs and one iOS 1024 PNG |
| PNG dimensions, RGB/RGBA encoding and adaptive alpha bounds | PASS; foreground inside 30dp radius plus one antialiasing pixel |
| Android manifest / adaptive XML references and iOS catalog mapping | PASS |
| `--icons-only` splash preservation | PASS; all 14 splash PNG hashes unchanged |
| Default splash rendering compared with previous method | PASS; byte-identical outputs |
| Repeat native icon generation | PASS; identical image hashes |
| PWA candidate preparation with old SVG and high-resolution PNG fixtures | PASS; both apps, PNG180/192/512 and separate maskable192/512 |
| PWA candidate CRC, full decode, dimensions, RGB8, manifest metadata/references | PASS |
| PWA rejection of low-resolution, non-square, transparent sources / repository output | PASS |
| Native rejection of non-square/transparent sources and existing monochrome override | PASS |
| Shell/Python syntax and `git diff --check` | PASS |

The PWA fixtures exercise preparation; they are **not** newly approved regular or
maskable artwork. Candidate generation does not establish visual approval.
The audit's existing tracked PNG corruption findings remain unresolved until final
sources can replace those files.

See the PR for the current commit and any subsequent CI results. Web builds do not
prove native compilation or correct installed home-screen appearance. Linux has no
Xcode or Android SDK here; no local APK/AAB/IPA build or device test is claimed.
Final design matching, final mask cropping, Provider native delivery, Safari
installation behavior and final before/after previews remain unverified.
The PWA tool uses syntax compatible with the default macOS Bash, but execution on
macOS/Bash 3.2 was not available locally.

No changes to UI, booking, payment, QR, check-in, backend API, app names/IDs,
Firebase configuration, permissions, environments, production settings or databases
are included. No deployment, release, merge or store upload is performed.
