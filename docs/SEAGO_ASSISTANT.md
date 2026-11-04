# SeaGo Assistant — Customer guided trip discovery (English only)

## Scope / promise
This is a Customer-only pilot, not a general-purpose generative AI model. Its free-text intent parser guides people through trips, price, group size, date, buffet, tickets, refunds and support while using real SeaGo data.

- Displayed tours, titles and published base adult prices come from `GET /api/trips` via the Customer app. Do not invent providers, prices, excursions, departures or availability.
- Specific-date requests verify `GET /api/departures?tripId=...` at question time and require adequate available seats. Timezone: Asia/Amman.
- Suggestions appear as actual trip cards; tapping them opens **the same booking/detail screen** as ordinary browsing. Booking/payment still occur via authenticated SeaGo checkout; the assistant never creates payments or changes ticket state.
- QR ticket / cancellation / refund questions route to official My Tickets or Help & Support, without receiving token or private booking data.
- If the API is unavailable or has no future inventory, the assistant explicitly says so. Sample trips in preview cannot be represented as real saleable inventory.
- No AI key in Vite, no third-party model calls, no conversation storage/transmission. Free-text parsing runs client-side. A dedicated server-backed AI agent with strict tool contracts, rate limits, logging/consent and prompt-injection defenses would be a separate security-reviewed milestone.
- English only. No Arabic/translation.
- UI adds an accessible, dismissible, mobile-safe `Ask SeaGo` floating launcher above bottom nav, quick prompts, keyboard controls, tour cards, navigation to tickets/support.

## QA
- Run `node --test test/seagoAssistantEngine.test.mjs` inside `customer-app`.
- Verify iPhone Safari with 320–430px widths; Android Chrome; focus/escape; keyboard and safe areas; trip cards; real QA/staging API; no-sellable-departures message; login/ticket access; refund support links.
- Do **not** use real customer transactions or create database inventory for acceptance. `scripts/seagoAssistantBrowserQA.mjs` defaults to deterministic in-browser trip, departure and quote fixtures; every API mutation is blocked. With `SEAGO_QA_MODE=live-trips`, only published Staging trips are fetched live, while departures and quotes remain isolated browser fixtures. Set `SEAGO_QA_URL` to test a local preview or the deployed Customer application.
- Browser acceptance covers 390×844, 320×568 and 1280×900, navigation, authoritative quote rendering, authentication before payment, focus/Escape and a synthetic keyboard viewport resize. Chromium emulation does not establish physical iPhone Safari or OS keyboard behavior.
- This PR does not touch the previously deferred cinematic video PR #246.
- Release requires Staging cleanup, current-head automated gates and browser acceptance before an authorized merge and deployment verification. No payment-system changes.
