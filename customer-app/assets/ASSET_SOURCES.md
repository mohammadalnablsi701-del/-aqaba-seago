# Native asset sources

Native launcher source, reconciled from [PR #240](https://github.com/mohammadalnablsi701-del/-aqaba-seago/pull/240):

- `logo.svg` — byte-for-byte identical to `public/app-customer.svg` (approved Direction A)
- `icon-master-1024.png` — original approved opaque RGB full-resolution iOS/Android master
- `android-adaptive-foreground-432.png` — original approved transparent foreground
- `android-adaptive-background-432.png` — original approved opaque ivory background
- `android-adaptive-foreground.svg` / `android-adaptive-background.svg` — editable approved layers

`scripts/generate-native-icons.py` creates density-matched native icons, while `scripts/native-launch-assets.mjs` continues to produce the **unchanged** navy Android/iOS static handoff for the 3-second animated WebView splash. The two paths must not overwrite each other. The wrapper `scripts/generate-native-assets.sh` supports `--icons-only` and `--splash-only`.

`scripts/native-launch-assets.mjs` embeds the approved SVG bytes intact in a navy SVG composition, then `rsvg-convert` rasterizes each splash PNG at its existing size. Portrait and landscape compositions keep the approved square artwork centered and undistorted. There is no separately drawn splash logo.

Android's system splash uses a separate `seago_launch_icon` drawable generated from the same source, with enough inset to retain the full approved artwork inside the OS mask. This resource is used only by the launch theme; launcher icons and manifest icon references are unchanged. The iOS launch storyboard remains static, uses aspect-fit, and has a navy background.

Brand colors:

- Navy `#071F33`
- Teal `#18B8B0`

Generated PNG and native resource files do not need to be committed because the build pipeline reproduces them deterministically.
