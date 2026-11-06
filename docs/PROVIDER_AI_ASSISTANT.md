# SeaGo Provider Arabic Assistant — opt-in pilot

## Implementation
- Provider dashboard has an Arabic chat action labeled مساعد SeaGo. It accepts text or short audio via MediaRecorder and displays Arabic answers.
- POST /api/providers/me/assistant is authenticated and classifies provider requests using Google's Gemini 3.5 Flash-Lite Free Tier (model configurable).
- Seat inquiries are answered by server-side provider-scoped queries: confirmed seats from confirmed Bookings, available seats from Departure inventory. Pending-payment holds may affect available seats. No booking records are sent to Gemini.
- Requests to create trips return a sanitized draft only. The provider explicitly opens the existing TripForm, reviews all details and saves. No AI-initiated publish, update, delete, payment, or direct database mutation.
- The server requires view_bookings for seat queries and manage_trips for draft creation. In addition it rate-limits the assistant to 25 requests per authenticated provider user per 15 minutes.

## Enable on Staging only
1. In Google AI Studio obtain a Free Tier API key. Verify model access and actual free limits.
2. Add these environment variables to **Staging Render backend only**:
   - PROVIDER_AI_ENABLED=true
   - GEMINI_API_KEY=(secret API key)
   - PROVIDER_AI_MODEL=gemini-3.5-flash-lite (optional; default)
3. Never use VITE_ variables for the secret, never commit keys to GitHub, never embed credentials in frontend code.
4. Deploy Staging only, run CI and cross-provider test scenarios. Production remains inactive unless separately approved.
5. Do **not** automatically enable paid billing. If free quota is exhausted the assistant responds with a rate limit error and core bookings still work.
6. For rollback, set PROVIDER_AI_ENABLED=false.

## Privacy and device limitations
- A user's voice/text is sent to Google for intent classification. Google's Free Tier can use submissions to improve products. The assistant shows a privacy disclosure but no checkbox; **complete a privacy/legal review and obtain any required consent before a real provider pilot.** Avoid client names, phone numbers, payment information, and other personal data.
- No customer records/PII are included in the model prompt. Only the server accesses authorized data and computes answer values.
- Audio recording is capped at 60 seconds and stops/sends automatically at that limit. Maximum client upload is 1.2MB binary, server validation caps base64 at 1.6M characters, and only the assistant POST route accepts up to 2MB JSON. All other JSON endpoints retain the 1MB limit.
- iPhone Safari Home Screen PWA microphone and actual audio/mp4 handling must be verified on physical devices. Not all browsers support MediaRecorder or all audio codecs.
- Text-to-speech/audio replies, arbitrary reporting ranges, and autonomous departure scheduling are out of scope.
- Free Tier quotas and availability are not guaranteed indefinitely.

## Acceptance checks
- Run npm test at repository root and npm run build in provider-app.
- Test Arabic Jordanian voice/text for confirmed seats today, available tomorrow, a named trip/date and no departures.
- Compare returned counts with provider-scoped booking/manifests including payment holds.
- Test draft completion: missing prices stay missing, existing form stays editable, nothing is written before explicit Save.
- Verify staff role limitations and cross-provider separation. Test 401, 403, 429, disabled flag, absent key, failed AI connection and timeouts.
- Inspect requests and logs to ensure no customer details are sent to Google.
- Verify iPhone installed PWA permissions, recording, transcript and fallback. No merge/deployment without review.

- The guided trip wizard accepts English and Arabic requests. A language-switch command changes future responses without treating it as a trip field; language is kept in sanitized per-turn context.

## Grounded assistant V1 — operator help, not autonomous control

- Text and up-to-60-second voice are sent to the configured Gemini endpoint for multilingual intent recognition and optional general explanations. Voice transcripts are shown to the provider.
- The backend — not Gemini — answers provider-specific factual questions. Read-only tools include saved trip names/prices/buffet/departure locations, future-departure sellability checks, and existing confirmed/available-seat aggregation.
- Every query is scoped to the authenticated approved provider ID. Trip read access requires existing manage_trips or view_bookings capabilities; seat totals require view_bookings. Booking/customer names, phone numbers, payment details, and commission configuration are never included in Gemini prompts or trip answer payloads.
- Troubleshooting topics include QR/camera, microphone, login/session, missing bookings, payment state, trip form, and seat discrepancies. Guidance is labeled as advice rather than a diagnosis; unknown errors require the exact message and screen.
- A whitelisted conversational focus (intent, trip name, date) helps interpret follow-up questions without storing free-form chat history or raw customer data.
- The assistant NEVER saves/edits/cancels a live booking, verifies a payment, checks in a ticket, or changes trip inventory by itself. Trip creation still requires manual review and Save.
- Limitations: the model may misunderstand ambiguous speech or classify an intent incorrectly. Provider data may be incomplete or stale until synced; a visibility diagnosis cannot prove the customer UI is rendering correctly. Arbitrary questions and app repairs are not guaranteed.
- Availability and usage depend on the configured Google model/key and its quota. No new paid provider service or extra secret is needed.
- PRIVACY: Existing text/voice submissions are transmitted to Google. Keep personal customer details out of prompts and audio. The prior UI checkbox removal does not remove applicable privacy/consent obligations.

## Guided acceptance before production

1. Verify built Provider PWA and backend on isolated Staging with approved provider and a different provider account.
2. Check natural-language and voice examples: «شو سعر رحلة الغروب؟», «ليش رحلة الغروب مش ظاهرة؟», «كم مقعد متاح بكرا؟», and «ما عم يفتح الماسح».
3. Compare trip details and available seats to the real provider-scoped database; test an inactive, paused, sold-out, and unscheduled trip.
4. Confirm a user without view_bookings cannot access seat counts; confirm a user of provider A cannot retrieve provider B's trip details.
5. Verify transcripts on iPhone Safari PWA and that 60-second uploads stay within codec/size limits.
6. Test provider app can still create a draft and never save without explicit action.


## Gemini transient failure recovery (iPhone report, Nov 6, 2026)

Production Render logs recorded repeated `provider_assistant_upstream_error { httpStatus: 503 }` near 11:42–11:43 UTC on the live provider assistant, while the SeaGo API remained healthy. A 503 from Gemini means upstream temporary overload/unavailability, **not proof of account quota exhaustion**. Quota/limit status 429 is handled separately.

- Upstream 500, 502, 503, 504 and transient network exceptions receive **up to 3 attempts total** (initial + 2 retries), with short exponential backoff and bounded total timeout (26 seconds text / 48 seconds voice).
- No retry for 429 or non-retryable upstream configuration/client errors. The assistant returns a descriptive error and the existing UI Retry action can reuse an unsent voice payload.
- Explicit **text-only** provider-wide trip price and customer visibility questions are classified locally and answered from authenticated, provider-owned data without calling Google. Role guards, provider isolation and no-write guarantees remain in place.
- **Voice recognition still requires Gemini.** If Gemini is unavailable for all retry attempts, voice transcription cannot be completed; the provider can try Retry or type the question.
- Only status and attempt number are logged; never log raw audio/text, Gemini API key or customer records. No new subscriptions, env secrets, or external providers are introduced.
- Test retry success and exhaustion, 429/4xx fail-fast, transient network errors, privacy, two-provider isolation and text-only fallback before production merge.
