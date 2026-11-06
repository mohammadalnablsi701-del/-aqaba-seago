# Provider assistant interaction upgrade

The assistant endpoint, bearer authentication, conversation context contract, AI engine, provider scoping, and trip form save path remain unchanged. Only the Provider app and its frontend QA tooling change.

- Header Info opens the existing Google-processing/privacy disclosure and manual-save explanation. Neither is displayed in the composer footer.
- Assistant bubbles use a 320ms CSS entrance on insertion. Conversation entries are append-only with stable keys, so typing, recording ticks, and other state updates do not remount or replay previous bubbles.
- Scroll follows new content only within 80px of the bottom. A Latest messages action lets readers return after scrolling upward. VisualViewport sizing handles available keyboard space; dynamic viewport CSS is the fallback.
- One recorder session owns microphone permission, capture, blob conversion, and upload. Stop, the 60-second deadline, and the elapsed-time ticker share an idempotent stop path. Tracks, timers, FileReader work, and audio analysis are disposed on close/unmount, including late permission results.
- MIME negotiation and the 1,200,000-byte maximum match the existing backend contract; the 150-byte minimum encodes to its 200-character base64 minimum.
- Audio bars use microphone amplitude without connecting audio to speakers. Updates happen directly on 19 DOM bars at 12.5Hz, pause in hidden tabs, and stop for reduced motion. CSS supplies the unsupported-analysis fallback.
- Failed uploads can retry the captured payload without duplicating its visible user message. Capture failures offer re-recording without clearing the conversation.

## Validation

Run `npm ci`, `npx playwright install --with-deps chromium webkit`, and `npm run test:assistant` in `provider-app`. The browser harness imports the actual assistant and shared styles through an in-memory Vite test route; it is never included in the production build. All assistant/API and microphone traffic in the browser suite is mocked. No production records are created or changed.

Browser emulation and desktop WebKit do not substitute for a physical iPhone: actual iOS microphone permission UI, keyboard behavior, and background recording suspension still require device QA.

## Local results (2026-11-06)

- Chromium + desktop WebKit: 28 browser scenarios passed; mobile widths 320, 375, 390 and 430px; recording captures at 390×844 and 320×568. Screenshots are uploaded by the Provider Assistant UI workflow as `provider-assistant-browser-qa`.
- Provider production build and build-environment verification passed against the production API URL and Provider Pages base path. Vite retains the existing application-wide chunk-size warning. No animation library was added to the runtime.
- Provider brand/boot test passed; all 32 targeted assistant backend regressions passed.
- Full root `npm test`: 420 passed, 30 skipped (database-dependent integration fixtures unavailable locally), zero failures. GitHub CI runs its disposable MongoDB integration jobs independently.
- Provider dependency audit: zero vulnerabilities.

Physical iPhone, native Safari permission prompts, and the actual iOS keyboard were unavailable. Voice input tests use deterministic microphone/recorder/analyser fixtures; they do not claim real-device capture verification.
