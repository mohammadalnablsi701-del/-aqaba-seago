# Native asset sources

Editable brand masters:

- `logo.svg` — exact approved Direction A Customer master (ivory/navy/turquoise)
- `icon-master-1024.png` — supplied opaque RGB native pixel authority
- `android-adaptive-foreground.svg` / `-432.png` — supplied transparent layer
- `android-adaptive-background.svg` / `-432.png` — supplied opaque ivory layer
- `splash.svg` — centered SeaGo wheel on the navy launch background

The mobile GitHub Actions workflows call `scripts/generate-native-assets.sh` after
Capacitor creates the native projects. The script uses `rsvg-convert`, ImageMagick
and Python 3 directly; it does not use `@capacitor/assets` or intermediate
`icon-only.png` / `splash.png` source files.

Android legacy and round icons use density-specific sizes. The approved adaptive
foreground and background are independent exports: no extraction, additional
padding or emblem transform is applied during integration. Lower foreground
densities use Lanczos2 sampling to keep all alpha pixels within the safe circle.
The iOS generator follows `AppIcon.appiconset/Contents.json`, including opaque RGB
1024×1024 output copied byte-for-byte from the supplied master. Generated native
sizes are downsampled from the original high-resolution PNGs, not small PWA files.

Use `bash scripts/generate-native-assets.sh all --icons-only` to regenerate icons
without touching splash resources. Existing default workflow calls retain splash
generation from the independent `splash.svg` source.

Direction A icon colors (splash retains its independent existing palette):

- Navy `#071F33`
- Ivory `#FAF7F0`
- Turquoise `#00BFC8`

Generated native resources do not need to be committed because the build pipeline
reproduces them. See [the integration report](../../docs/APP_LAUNCHER_ICONS.md)
for the supplied archive checksum, outputs, validation and remaining device checks.
