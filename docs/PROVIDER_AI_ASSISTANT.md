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
