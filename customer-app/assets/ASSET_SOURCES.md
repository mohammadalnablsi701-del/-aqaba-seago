# Native asset sources

Editable brand masters:

- `logo.svg` — square SeaGo wheel mark for the app icon
- `splash.svg` — centered SeaGo wheel on the navy launch background

The mobile GitHub Actions workflow renders these SVG masters into the PNG source sizes required by `@capacitor/assets` before generating Android and iOS resources:

- `icon-only.png` — 1024×1024
- `splash.png` — 2732×2732

Brand colors:

- Navy `#071F33`
- Teal `#18B8B0`

Generated PNG and native resource files do not need to be committed because the build pipeline reproduces them deterministically.