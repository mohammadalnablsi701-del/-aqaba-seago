# Customer native launcher icons — Direction A (post-#239 reconciliation)

Prepared separately from the approved, already-published web/PWA icons.

## Source and change boundaries

- Parent: merged main commit `2f9d3f51cd01d747b68939490e8a53f2c3286720` from [PR #239](https://github.com/mohammadalnablsi701-del/-aqaba-seago/pull/239).
- Original native artwork and generator: [PR #238](https://github.com/mohammadalnablsi701-del/-aqaba-seago/pull/238).
- The Android/iOS Customer image source is the approved Direction A ivory/navy/turquoise logo.
- `customer-app/assets/logo.svg` has the exact same Git blob SHA as the `customer-app/public/app-customer.svg` deployed with #239 (`504e6168e699f347afb931cb3236ac67a7e3e8ce`).
- Original source files: RGB 1024 master, RGBA adaptive foreground 432 and opaque adaptive background 432, plus editable SVGs.
- The source-generation shell/Python code and read-only launcher integrity workflow come from #238. The verifier's SVG favicon selection is adapted for #239's new separate PNG48 + SVG favicon HTML links.

## Native output

- Android: legacy and round mipmaps at density-specific sizes; adaptive icon foreground and ivory XML background for v26 and later.
- iOS: supplied RGB 1024 master mapped to the Capacitor AppIcon asset catalog.
- Native resources are generated inside temporary Capacitor projects in the CI workflow; generated resources are not committed.
- Existing splash source, identity `com.aqabaseago.app`, Android/iOS build and signing workflows, app features and APIs remain unchanged.

## Important separation

**No Customer, Provider or Admin PWA icon/HTML/manifest/service-worker paths are modified here.** The accepted Safari Customer manifest-only installation fix from #234 and #239 must stay untouched. The separate Provider and Admin PWAs remain intact; no Provider native wrapper is invented.

No signing credentials, Firebase configuration, production deployment, merge or store release are included.

## Acceptance gates

1. All workflow checks on this exact native-only PR commit must be green, especially Launcher Icon Integrity and Mobile Native Build (Android debug APK, unsigned release AAB and iOS simulator).
2. Physically install a newly built Android APK and inspect normal/round launcher masks, splash and launch. Test upgrades separately without deleting app data.
3. Physically inspect the native iOS install/icon through TestFlight or a properly signed device build. An iOS simulator result is not physical-device approval.
4. Confirm no modified web/PWA files and no regression to the three already-accepted Safari home-screen shortcuts.
5. Require separate human approval before native merge and before signing/store distribution.

The user has already reported successful iPhone Safari **PWA** installation for Customer, Provider and Admin. That is distinct from this native acceptance gate.
