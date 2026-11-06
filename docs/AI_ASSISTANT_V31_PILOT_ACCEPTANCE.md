# SeaGo AI Assistant V3.1 — Pilot acceptance (2 providers)

**Scope:** Verify the live assistant, its Admin AI Monitoring metrics, and privacy/role boundaries **without manipulating production bookings, payments, QR tickets or trip availability**.

## Automated CI evidence

- The existing disposable MongoDB `test/providerAssistantV2.integration.test.js` suite now performs **20 typed, provider-scoped inquiries** and **10 mocked audio-transcript routing requests** across authorized staff from two independent providers.
- Typed price/visibility inquiries must be answered using each provider's own saved data without Gemini calls; missing-booking inquiries must ask for a departure date rather than guess.
- Mock audio requests assert language switching, real owned seats/prices, visibility, booking/QR diagnoses, clarification for garbled speech and rejection of a foreign trip.
- All results must omit customer identifiers, phone numbers, commissions, payment keys and audio payloads. Trip/booking counts and check-in fields must remain unchanged.
- The audio fixture is synthetic base64 plus a **mocked Gemini JSON transcript**. It proves backend routing, **not** actual microphone recording, speech recognition accuracy, model reliability or iPhone compatibility.
- Production Smoke additionally checks that anonymous and fake-token users cannot access `/api/admin/assistant/metrics`.

## Real iPhone pilot — manual steps

1. Open the live Admin PWA and **AI Monitoring**. Note `processStartedAt`, requests, failures, source breakdown, and latency. These metrics are in-memory, process-local and reset if Render restarts; a successful HTTP 200 does **not** mean the answer was correct.
2. With **Provider A**, send 10 typed messages (one at a time): `شو أسعار رحلاتي؟`, `ليش رحلاتنا مش مبينة للعملاء؟`, `الحجز مش ظاهر`, `اليوم` (immediately after the booking question), `المقاعد مش مطابقة`, `بكرا` (as follow-up), `عندي مشكلة QR`, `بكرا`, `اشرح الفرق بين المقاعد المؤكدة والمحجوزة`, `احكيلي شو معلومات الرحلة اللي عندي`. Mark responses correct only when grounded in actual saved company data, explicit limits and appropriate clarification. Avoid real customer names/IDs.
3. Then with Provider A, send five **real voice recordings**: `بدنا نحكي بالإنجليزية`, `شو أسعار رحلاتي؟`, `كم مقعد محجوز اليوم؟`, `ليش الرحلات مش ظاهرة؟`, and one deliberately unclear phrase. Confirm the microphone transcription, language, answer accuracy, correction prompt and handling of transient Gemini downtime.
4. Repeat the same **10 typed + 5 voice** with **Provider B** in its own authorized account. Check answers are based only on its own company. Never paste Provider A's booking/customer details into Provider B's chat.
5. Open AI Monitoring in Admin and refresh. If the API process has not restarted and the same backend instance is serving both apps, the counters should rise by approximately **30 requests** (20 text / 10 voice); some retry/error attempts can be higher than user-visible failures. A request blocked by authentication or rate limit may not be counted in the handler metrics. The 25-assistant-requests/15-minute limit applies per user.
6. Finally verify that using a **customer or provider JWT** for the admin metrics endpoint receives 403, and anonymous requests receive 401. Do not share credentials or tokens.
7. Record pass/fail for each scenario, any inaccurate transcript, route, date or scope, and any 503/429 error. Submit **redacted screenshots or anonymized observations only**. Never submit genuine customer records or raw private recordings.

## Pilot sign-off

| Gate | Required |
| --- | --- |
| GitHub CI and disposable multi-provider integration | All passing |
| Live production Pages/API versions | Matching expected commit / production smoke PASS |
| User-visible cross-provider disclosures | **Zero** |
| Unauthorized DB writes or QR check-ins | **Zero** |
| PII in Admin metrics API | **Zero** |
| Typed questions (manual) | 20 reviewed, no uncorrected factual errors |
| Real iPhone voice questions | 10 reviewed, transcript accuracy assessed manually |
| Response errors/latency | Record real values; investigate 503/429 and repeated high latency |

**Do not claim the full live pilot is complete until both real-provider iPhone sessions are reviewed.** No automated AI action should modify bookings, payment verification or QR check-in without explicit operational authorization.
