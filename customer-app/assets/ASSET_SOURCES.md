# Native asset sources

Editable brand masters:

- `logo.svg` — approved full-bleed Aqaba SeaGo customer app icon; this is the single native icon source for Android and iOS.
- `splash.svg` — centered SeaGo wheel on the navy launch background.

The mobile GitHub Actions workflow renders these SVG masters into the Android launcher and iOS AppIcon PNG sizes during the native build. Generated native resource files do not need to be committed because the build pipeline reproduces them deterministically.

PWA identity is versioned separately in `customer-app/public/manifest.webmanifest`. The customer and provider manifests use a 192 px raster fallback plus a scalable SVG production icon so browsers can select the best representation for the device.

Brand colors:

- Navy `#071F33`
- Teal/Cyan `#18B8B0`
