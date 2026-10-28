# Branding identity v4

Customer icon source: `customer-app/assets/logo.svg`.
Provider icon source: `provider-app/public/app-provider.svg`.

Both production SVGs preserve the approved SeaGo identity: helm, yacht, sun, birds and layered waves. Customer uses the light sea palette; Provider uses the dark navy operational palette.

PWA manifests include a 192 px raster fallback and the scalable SVG as the primary all-size/maskable representation. Native Android/iOS Customer builds continue to use `customer-app/scripts/generate-native-assets.sh`, which renders `assets/logo.svg` into platform launcher/AppIcon PNG resources.

Do not pre-round the icon canvas; Android/iOS/PWA launchers apply their own masks.
