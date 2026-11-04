# Customer homepage hero video — controlled rollout

The Customer homepage retains **aqaba-hero.jpg** as a fast first paint and a permanent fallback.

## Current status
- Code supports a silent inline MP4 with continuous loop; motion/video is **OFF by default**.
- No actual yacht video is included in this PR; the existing photo stays visible until a licensed, Aqaba-appropriate video is supplied.
- The requested video should be an approved original operator film or commercially licensed royalty-free stock **not misrepresented as an actual Aqaba SeaGo provider trip**.
- English-only app. No translations, backend changes, icon changes or production rollout.

## Prepare media
Place a reviewed, rights-cleared `hero-seago.mp4` in `customer-app/public/`. Use a clean, no-watermark shot. Recommended target **6–9 seconds**, H.264 MP4, no audio, `yuv420p`, `faststart`, ≤3 MB where feasible.

Example optimization using ffmpeg (adjust input filename):
```bash
ffmpeg -ss 0 -i source-yacht.mp4 -t 8 -an -vf 'scale=720:-2:flags=lanczos,fps=24' -c:v libx264 -pix_fmt yuv420p -preset medium -crf 28 -movflags +faststart customer-app/public/hero-seago.mp4
```

## Activate in the *QA* build only
Build with `VITE_HERO_VIDEO_ENABLED=true` after the file exists. In Vite, the source resolves under `import.meta.env.BASE_URL`, working with both GitHub Pages `/-aqaba-seago/` and root-hosted Render Staging.

**Do not turn it on in the production build** until the clip is uploaded, approved, and physically tested on iPhone Safari. The current `VITE_HERO_VIDEO_ENABLED` default is off.

## Browser contract
- Poster photo is visible before video, on autoplay refusal, decode/load error, Save Data, Reduce Motion, 2G and background tab.
- `muted`, `playsInline`, `autoPlay`, `loop` and `preload=none` are set.
- Video is limited to the hero; search card and typography remain above it.
- QA: iPhone Safari, installed PWA, Android Chrome, 4G, 2G/Data Saver, Low Power Mode, Reduce Motion, navigation/reloading and screen-reader tab order.
- Verify video asset size, request count and LCP before any main merge.
