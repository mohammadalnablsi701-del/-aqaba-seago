# Native asset sources

Editable brand masters:

- `logo.svg` — square SeaGo wheel mark for the app icon
- `splash.svg` — centered SeaGo wheel on the navy launch background

The mobile GitHub Actions workflows call `scripts/generate-native-assets.sh` after
Capacitor creates the native projects. The script uses `rsvg-convert`, ImageMagick
and Python 3 directly; it does not use `@capacitor/assets` or intermediate
`icon-only.png` / `splash.png` source files.

Android legacy and round icons use density-specific sizes. The current helm's
adaptive foreground is rendered separately with safe padding and a navy background.
The iOS generator follows `AppIcon.appiconset/Contents.json`, including opaque RGB
1024×1024 output. A replacement design requires reviewed adaptive exports and
must not silently inherit the current wheel-specific extraction.

Use `bash scripts/generate-native-assets.sh all --icons-only` to regenerate icons
without touching splash resources. Existing default workflow calls retain splash
generation from the independent `splash.svg` source.

Brand colors:

- Navy `#071F33`
- Teal `#18B8B0`

Generated native resources do not need to be committed because the build pipeline
reproduces them. Final new branding is pending the owner's high-resolution sources;
see [the icon audit and integration plan](../../docs/APP_LAUNCHER_ICONS.md).
