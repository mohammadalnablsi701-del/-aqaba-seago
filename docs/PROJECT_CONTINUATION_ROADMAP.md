# Aqaba SeaGo — Phase 2A cloud continuation roadmap

Assessment date: **2026-10-19 UTC**. This is a repository assessment and continuation plan, not authorization to change hosted data or release software.

## Current verified baseline

| Check | Evidence and result |
| --- | --- |
| Source of truth | Fresh cloud clone of remote `mohammadalnablsi701-del/-aqaba-seago`; no previous computer checkout or uncommitted work used. |
| Access and default branch | GitHub repository metadata returned successfully; `default_branch=main`; remote symbolic `HEAD` also resolves to `refs/heads/main`. |
| Staging | Remote `refs/heads/staging` exists at **`b0bb3c36b189acc9b3554d647e1907963f9068c1`**, matching the authoritative baseline. |
| Working branch | Newly created `codex/phase2-aqaba-seago-roadmap-cloud` from that staging SHA; the branch did not exist remotely at baseline inspection. |
| Phase 1 | **PASS**, as supplied by the owner and corroborated by the code/test contract and exact-SHA successful CI below. This does not mean every business area is launch-ready. |
| Baseline CI | [CI run 39153022557](https://github.com/mohammadalnablsi701-del/-aqaba-seago/actions/runs/39153022557), `head_sha` equal to the authoritative SHA, completed successfully on 2026-10-18. All nine jobs succeeded: secret scan, dependency audit, backend tests, backend supply chain, disposable payment integration, three app builds and release guard. |
| Staging post-deploy smoke | **PASS**, independently corroborated through [Staging Smoke run 39153022457](https://github.com/mohammadalnablsi701-del/-aqaba-seago/actions/runs/39153022457), successful at the same SHA on 2026-10-18. No live smoke was rerun for this assessment. |

### Evidence boundaries and Phase 1 completion

Phase 1 provides explicit safety/unit/database test manifests, a runner-owned local replica set, scrubbed child environments, expiring PID-bound IPC authority, unique owned database names, connection/deletion guards and guarded cleanup. Database files require fixture authority before importing application tests; missing authority fails closed. See [test safety contract](TEST_SAFETY.md), [runner](../scripts/test-safety/run.mjs), [policy](../scripts/test-safety/policy.mjs) and [fixture](../scripts/test-safety/fixture.mjs). The manifests contain 30 database files and 49 unit files, plus the separate safety file.

Baseline CI executes safety/unit tests and a selected disposable integration set, including booking/payment, ticket/check-in, provider permissions, pilot booking/ticket, password recovery and backup/restore. Additional focused workflows at that SHA also succeeded for pricing, ticket lifecycle, payment correlation/durability, refunds, settlement safety and notification privacy. A green workflow is evidence for its configured checks, not for untested live operations.

Staging smoke checks API readiness/content identity, public trips, `publicLaunch=false`, Provider CORS, Provider shell/assets/API configuration and PWA scope. It compares backend content with the deployed commit; it does not require a documentation-only commit to redeploy. It does **not** execute customer payment, refund, ticket or QR business mutations. See [current smoke workflow](../.github/workflows/staging-smoke.yml), especially lines 32–44.

This assessment did not contact Production or Staging services, inspect live databases, run migrations, dispatch workflows, deploy, or create business records. Hosted credentials, actual inventory, physical-device behavior and real money movement remain outside the verified evidence. GitHub metadata and historical workflow results were read through GitHub only.

## Architecture

- **API:** Node **20.20.2**, Express ES modules, JWT/bcrypt authentication, Mongoose/MongoDB. `src/app.js` mounts the route groups; `src/server.js` validates startup flags, connects MongoDB, starts hold cleanup/reminders and handles shutdown. Routes delegate financial/inventory rules to `src/services/` and persist through `src/models/`.
- **Customer:** `customer-app/`, React 18/Vite 6, API-configured catalog/checkout/tickets/cancellation/support and Capacitor 8 packaging. Node >=22; CI uses 22. Native projects are generated and ignored. Shared native push context lives in `shared/`.
- **Provider:** `provider-app/`, React 19/Vite 8, provider onboarding, inventory, manifests, team capabilities, finance views and camera/manual check-in. CI uses Node 20.
- **Admin:** `admin-app/`, React 19/Vite 8, provider access/lifecycle, commission and platform controls, operations, booking/payment/refund support, audits and settlement ledger. CI uses Node 20.
- **Transaction flow:** server quote → idempotent checkout hold and atomic seat reservation → pending payment → verified webhook → confirmed booking and financial snapshot → signed ticket → provider-scoped check-in. The old direct booking-create endpoint returns HTTP 410; it is not the current checkout architecture.
- **Messaging:** database-backed in-app notifications; Resend email; VAPID web push; customer Android-only Firebase Admin/FCM delivery. Reminder processing currently runs in the API process. No durable delivery outbox/independent worker was found.
- **Infrastructure represented in source:** Render API/Provider URLs in smoke/build workflows, `RENDER_EXTERNAL_URL`/hostname CORS support and `RENDER_GIT_COMMIT` health metadata. No `render.yaml`, Dockerfile, Procfile or Railway configuration was found. Hosted service definitions, auto-deploy rules, secrets, plans and MongoDB topology were not verified.

MongoDB transactions underpin checkout, payment and audit behavior; deployment needs a compatible replica set. `src/config/db.js:31` reuses Mongoose's application connection and performs payment-index repair and expired-hold cleanup. Do not start it against a live database for inspection. Connection-pool tuning requires observed workload/topology evidence; no speculative pool changes are proposed here.

## Feature status matrix

Classification: **A. COMPLETE AND VERIFIED**, **B. IMPLEMENTED BUT NEEDS STAGING VALIDATION**, **C. PARTIALLY IMPLEMENTED**, **D. NOT IMPLEMENTED**, **E. BLOCKED BY EXTERNAL SERVICE / CREDENTIAL / BUSINESS DECISION**, **F. PRODUCTION-LAUNCH BLOCKER**. F is an additional release constraint; E can accompany implemented code. A applies only to the explicitly bounded evidence, not an entire production system. Native/store blockers apply when that channel is included in the release scope.

| Major area | Status | Current evidence and remaining gap |
| --- | --- | --- |
| Phase 1 test safety and baseline CI | **A**, bounded to baseline checks | Runner/fixture contract above and successful exact-SHA CI. Not a live business acceptance pass. |
| Backend API | **B** | `src/app.js:48` mounts auth, inventory, bookings, payments, tickets, admin, notifications and support. Health/smoke passed historically; full operational routes need acceptance evidence. |
| Customer App | **B** | `customer-app/src/api.js` and `src/App.jsx` implement catalog, checkout, payment return, tickets, cancellation and support. Baseline build passed; browser/device business flow not proved by that build. |
| Provider App | **B** | `provider-app/src/App.jsx` implements onboarding, trips/departures, team, manifests, scanning/manual check-in and finance visibility. Historical smoke covers its sign-in shell, not authenticated operations. |
| Admin App | **B** | `admin-app/src/App.jsx` exposes current operations, provider/commission controls, refunds, settlement/payment support and audit. Sensitive actions require workflow signoff. |
| Email/password authentication | **B** | `src/routes/auth.js:69` and `src/middleware/auth.js:4`: bcrypt, active account/role checks, JWT auth-version invalidation. Recovery and deletion are implemented; reset delivery has an external dependency. |
| Google Sign-In, web | **B/E** | `src/routes/auth.js:27`: audience, subject and verified-email checks; Customer/Provider GIS UI. OAuth client/origins and actual sign-in/conflict handling need environment evidence. |
| Google Sign-In, native | **D**, intentionally unavailable | `customer-app/src/main.jsx:52` hides GIS in Capacitor and presents email/password. No native Google implementation found; hidden component still initializes GIS, so explicit component-level gating is a possible improvement. |
| Apple Sign-In | **D/E**, scope-dependent | No Apple auth backend/identity/plugin found. Decide whether native social login is in scope; implementing it may require Apple Sign-In and Apple Developer capabilities. Current native UI offers email/password. |
| Phone OTP | **D/E**, explicitly disabled | `src/routes/auth.js:170` returns HTTP 410 for request/verify. Dormant Twilio helpers are not a working OTP feature. Require a product decision before activation work. |
| Trips | **B** | `src/routes/trips.js:82`: capability/ownership checks, sale configuration, active/platform state and approved-provider public visibility. Live catalog not inspected. |
| Departures | **B** | `src/routes/departures.js:31`: capacity, scheduling, sales closure/cancellation and transition rules. Future sellable inventory/capacity require operational evidence. |
| Pricing | **B** | `src/services/pricing.js:17`: adult/child/buffet and financial arithmetic. Unit/integration evidence exists; current provider price agreements and live records remain unverified. |
| Commission | **B/E** | `src/services/commission.js:40`: percentage, fixed/person, fixed/booking, strict fail-closed configuration; audited admin updates and provider edit restrictions. Pilot plans and agreement reconciliation discussed below. |
| Booking and capacity | **B** | `src/services/checkout.js:16` uses transactions and idempotency; `src/services/payments.js:165` confirms booking after payment. Current full quote-to-check-in acceptance still needed. |
| Payments | **C; D/E/F for real gateway** | Only `mock` is registered in `src/payments/index.js:3`. Webhook signatures, amount/currency checks and event idempotency are implemented. No real gateway or merchant settlement was verified or implemented. |
| Ticket lifecycle and PDF/links | **B** | `src/services/ticketLifecycle.js:48` defines usable/checked-in/cancelled/refunded/expired/completed states. `tickets.js` separates boarding and expiring public-link credentials; routes enforce access. |
| QR validation/check-in | **B** | `src/routes/tickets.js:220` and `providerCheckin.js:23`: capability/provider isolation and atomic duplicate prevention. Need real camera/device and staff acceptance evidence. |
| Cancellation/refunds | **C/E/F for real money** | Durable intent, seat release, 100%/50%/0% customer policy and reconciliation/idempotency paths in `cancellations.js`, `refunds.js` and booking routes. Real refund execution depends on the missing gateway. |
| Settlements | **C/E** | `src/services/settlements.js:70` and `src/routes/adminSettlements.js:100`: refund-adjusted ledger, blocking/recovery states and audited mark-paid/reversal. Mark-paid records an operator payout; no bank-transfer integration found. Manual payout ownership/evidence must be agreed before paid launch. |
| Notifications and web push | **B/E** | User-scoped in-app list/read routes, provider-owner alerts and VAPID delivery in `notifications.js`, `push.js`. Verify recipients, configuration, permission and device receipt. Provider push is web push, not native FCM. |
| Notification durability | **C** | Confirmation mail can be fire-and-forget; reminders use a 15-minute API timer (`src/server.js:52`). No durable outbox/replay found. Staff monitoring can cover controlled pilot; dependable essential delivery needs recovery design. |
| Email and password recovery delivery | **B/E/F for dependable public recovery** | Real Resend adapter (`src/services/notifications.js:80`, `passwordRecovery.js:46`); unconfigured delivery skips/fails softly. Sender defaults to `onboarding@resend.dev`. Domain authentication, sender credentials, environment-correct links and external inbox receipt unverified. |
| Android packaging | **B/E** | Capacitor app `com.aqabaseago.app`; debug and signed AAB/APK workflows exist. Signing secrets, store account and real-device/internal-track evidence unverified. Existing mobile workflows build Production API artifacts; do not use them as staging-device validation. |
| Firebase / Android FCM | **B/E** | `nativeFcm.js:9`, push routes, Android native bridge and Firebase injection script implement strict project/package/context validation and token ownership/revocation. Configuration and foreground/background/terminated-device receipt remain unverified. **F if promised at release.** |
| iOS real-device build | **C/E/F for iOS release** | Capacitor iOS dependency and optional unsigned simulator build only (`mobile-native.yml:124`). No signed device archive/TestFlight pipeline found; simulator compilation does not prove physical iPhone readiness. |
| iOS native push | **D/E**, scope-dependent | Current native push context/controller is explicitly Android-only. APNs registration/capabilities/backend delivery path and real-device receipt not implemented. |
| Provider roles and permissions | **B** | `src/services/providerAccess.js:4` defines owner/manager/staff/checkin capabilities and approved-provider/active-membership requirements. Tests cover isolation and redaction; live role assignments/revocation not inspected. |
| Aladdin suspension | **B for generic guard; E for actual status** | Approved-provider sales guards exist; no Aladdin-specific activation lock found. Generic audited admin reactivation is allowed. Preserve unavailability pending business confirmation; see inventory section. |
| Current six pilot trips | **E** | Cannot establish six current hosted records from this repository. Four approved-program definitions and one candidate declaring `active:false` in repository JSON are identifiable; no live inventory was queried. |
| MongoDB integration | **B/E** | Mongoose connection, transaction-based services and disposable tests exist. Hosted topology, database/user separation, least privilege, network access and recovery settings unverified. |
| Backups / restore | **B for tooling; E/F for operational recovery** | BSON/index/empty-collection round-trip tooling and CI test exist. Provider-native snapshot schedule/retention, encrypted offsite access, restore drill and recovery objectives remain unverified. |
| Render configuration | **C/E** | URLs and runtime metadata hooks exist; service infrastructure/settings are not represented as a complete checked-in deployment definition and were not inspected externally. |
| CI/CD | **A for baseline run; B/E for enforcement** | Exact-SHA CI passed. PR/push filters, release-guard, audits/builds exist. Actual required branch checks/reviews and protected hosting environments remain unverified. |
| Security | **B/E** | JWT strength checks, authorization, input/operator rejection, Helmet/CORS/rate limits, token lifetimes and audit trails exist; baseline scans passed. Hosted configuration, threat review and operational incident readiness are not certified by those checks. |
| Launch configuration / release process | **C/E/F** | Flag safeguards and main/staging smoke/build workflows exist. Real gateway, required hosted controls, recovery and signed release artifacts are not proved. `pilotReady` is not Production approval. |

## Specific pilot inventory, permission and E2E findings

### Six trips and Aladdin

The repository identifies the following approved-program descriptions, not a verified live inventory count:

1. **White Prince Swimming Cruise**, Fun N Sun (`real-pilot-data/fun-n-sun.json:8`).
2. **White Prince Evening Cruise**, Fun N Sun (same file, line 33).
3. **Coral Whisper + White Prince Experience**, Fun N Sun (same file, line 50).
4. **Sunset Cruise**, Sea Breeze / Aquamarina (`real-pilot-data/sea-breeze-aquamarina.json:7`; current code `src/services/realPilotData.js` identifies **Breeze Wooden Boat**).

Aladdin's separate [candidate](real-pilot-data/aladdin-yachts-marine-tours.candidate.json) has `active:false` and unresolved capacity, fares/child policy, commission, schedule and meeting-point details. Do not import or activate it. The retired blanket commission migration is now a no-op (`src/services/commission20Migration.js`); it does not establish Aladdin's current suspension. Generic approved-provider gates protect listings, quote, checkout, confirmation and provider access, but an admin can generically reactivate a suspended provider (`adminProviderLifecycle.js:12`). A named hold is a business safeguard that must be verified and preserved, not assumed immutable in code.

To reconcile the claimed six trips, obtain a separately authorized, redacted read-only inventory snapshot with trip/provider identities, approval/suspension, trip/platform sales status, approved prices/commission, meeting point, future departure status and capacity. Record the two additional identities rather than inventing them. Avoid live departure/quote GET requests as a purported read-only audit: they call expired-hold cleanup and may write data (`src/routes/departures.js:93,209`). No such snapshot was obtained here.

### Commission and provider operations

Commission is implemented, not a blanket current 20% rule. Strict validation supports percentage, fixed/person and fixed/booking and fails closed on malformed configuration. Fun N Sun's three named plans are encoded in `pilotCommissionRules.js`: Swimming base adult/child **3/2 JOD**, buffet **5/3 JOD**; Evening and combined experience fixed/person **5 JOD**. Sea Breeze has explicit adult/child/buffet handling in `realPilotData.js` and correction/commission code. Fun N Sun admin changes must match its approved plan. Provider edits exclude commission keys. Booking snapshots retain the financial values at purchase. New provider-created trips still default to configured percentage or 20%, so every pilot trip's actual agreement needs reconciliation before sale.

Roles: **owner** has team/settings/trips/departures/bookings/check-in/finance; **manager** has all except team management; **staff** has departures/bookings/check-in; **checkin** has bookings/check-in only. Verify actual membership, revocation, finance redaction and cross-provider denials before operational use; do not infer those identities from fixtures.

### Booking/payment/ticket/QR E2E status

Baseline CI passed the disposable pilot booking/ticket test and complementary capacity, payment, ticket and provider tests. However, `test/pilot-booking-ticket.e2e.test.js:37` directly inserts trip/departure/hold/payment fixtures before invoking a mock webhook. It covers confirmation, financial snapshot, provider isolation and duplicate check-in; it does not exercise public quote → checkout, browser UI or a real gateway. Its buffet fixture prices total **17 + 12 = 29**, while the inserted hold/payment uses **27**. That snapshot assertion cannot verify current quote arithmetic.

The legacy `src/services/pilotE2E.js` performs broader API actions but creates/deletes entities; it is not a safe live acceptance shortcut. Current startup does not invoke it and rejects its development flag in Production. No current live six-trip booking/payment/ticket/QR E2E pass is established by this assessment.

## Remaining work by release horizon

### 1. Must complete before Pilot

These conditions apply to a **controlled mock-payment pilot**. Any pilot collecting real money inherits the real-gateway/refund/reconciliation requirements below.

- Agree web versus native pilot scope, accepted authentication, known participants, staff responsibilities and the fact mock payment does not collect money. Keep `PUBLIC_LAUNCH=false`, mock/demo/startup flags explicitly reviewed and destructive helpers unused.
- Reconcile the six-trip inventory and approved financial agreements using separately authorized evidence. Verify Aladdin remains unavailable; resolve its operator questions and activation safeguards before considering any change.
- Close the quote-to-check-in automated acceptance gap using only the Phase 1 disposable runner, including current pricing, retry/idempotency, cancellation, provider suspension and role boundaries. Record exact commit/check results.
- Obtain browser/provider-camera operational acceptance evidence and inventory/capacity reconciliation under a separately authorized test plan. This roadmap does not authorize Staging business writes. Use disposable test fixtures for mutations unless a future task explicitly authorizes an isolated environment and test data.
- Confirm approved provider personnel and owner/manager/staff/checkin permissions, revocation, manifests, manual fallback, refund/support escalation and settlement responsibilities.
- Verify environment separation and correct API/public/frontend origins. Use a dedicated staging-configured mobile artifact if native devices are in pilot scope; existing Production-targeted mobile workflows are unsuitable for that rehearsal.
- Provide a workable participant sign-in/recovery/support path. In-app notifications can cover a controlled pilot if email is explicitly deferred and staff own recovery; otherwise verify sender/reset receipt first. FCM is a pilot blocker only if promised for that pilot.
- Confirm backup ownership and a recovery plan before relying on pilot business records. Repository restore tests alone do not establish hosted backups.

### 2. Must complete before Production Launch

- Select an available Jordan/JOD-capable merchant gateway and agree merchant onboarding, supported methods, fees, refunds and reconciliation responsibilities. Implement the real adapter, authenticated webhooks, idempotent checkout/refund, correlation, ambiguous outcomes and reconciliation; validate through the provider sandbox first.
- Harden startup/readiness to validate the actual supported provider and its required configuration. Current `PUBLIC_LAUNCH` checks reject the literal `mock` string but an arbitrary non-mock name passes until checkout throws; Admin readiness similarly treats a non-mock name as configured. Keep the gate closed until evidence exists.
- Validate paid booking → ticket → check-in and cancellation/refund → settlement accounting in an authorized sandbox, including duplicate/delayed webhooks, expired holds, wrong amount/currency, suspension/pause, failed/refunded/review states and payout blockers. Confirm actual commissions and operator payout evidence.
- Configure verified email domain/sender and SPF/DKIM/DMARC as applicable; prove external receipt and environment-correct booking/reset links. Ensure recovery/support works reliably and essential failed notifications can be recovered.
- Verify isolated MongoDB identities/topology, least privilege, provider-native automated backups, retention, encrypted restricted storage, restore-to-new-target drill and agreed RPO/RTO. Never restore over live business data as a test.
- Verify hosted Render settings and deployment branch linkage, secrets/origins, HTTPS/domain/support ownership, monitoring/alerts/incident owner, rate limits and audit access. Complete security/privacy/terms and business/refund/commission approval.
- Establish protected PR review/check requirements, staging validation, explicit Production release approval, rollback commit/artifact and backup readiness. Validate the final Production environment artifact before an authorized release; then require post-release smoke. No release is authorized in Phase 2A.
- For **Android launch**: signing/Play account/internal testing and real-device evidence; FCM configuration/lifecycle receipt if promised. For **iOS launch**: Apple Developer signing/provisioning, signed archive/TestFlight and physical iPhone evidence. iOS push and native social login are separate scope decisions, not implemented features.

### 3. Important but can follow after launch

Provided the initial scope has an explicitly accepted manual recovery process: durable notification outbox/retries and independent scheduling, richer operational dashboards, automated reconciliation assistance, bank-payout automation, broader browser/accessibility/performance coverage and measured MongoDB connection/capacity monitoring. Move any item earlier if essential to a promised launch flow or required for financial control.

### 4. Optional improvements

Native Google/Apple and phone OTP if product scope does not require them; iOS native push when not promised; explicit React native-auth gating instead of DOM hiding; checked-in infrastructure definitions; expanded analytics and design polish. Automating hosted infrastructure must follow the authorized release workflow.

## External dependencies

| Dependency | Required evidence / decision |
| --- | --- |
| Business owner and pilot operators | Exact six-trip snapshot, price/commission/refund/payout approval, Aladdin hold and unresolved operator answers, pilot participants and channel scope. |
| Payment gateway / merchant account | Provider selection, Jordan/JOD support, merchant onboarding, sandbox/live credentials, webhook contract, refund/reconciliation capabilities. No real adapter exists yet. |
| Email / Resend / DNS | Verified domain, restricted `RESEND_API_KEY`, `EMAIL_FROM`, correct `FRONTEND_BASE_URL`/`PUBLIC_BASE_URL`, authenticated DNS and external inbox receipt; support mailbox ownership. |
| Google OAuth | `GOOGLE_CLIENT_ID`, allowed web origins/audiences, owner access and tested sign-in/conflict behavior. Native OAuth remains separate. |
| Firebase / FCM | `FCM_ENABLED`, exact `FIREBASE_PROJECT_ID`, mounted `GOOGLE_APPLICATION_CREDENTIALS`, native `VITE_NATIVE_PUSH_ENABLED`, context-validated `FIREBASE_ANDROID_CONFIG_BASE64` and physical Android evidence. No secret presence was checked. |
| Web push | VAPID public/private keys and subject, browser permission/subscription/receipt and revocation evidence. |
| Android distribution | Play Console access, keystore/alias/password secrets, approved package/version, internal-track installation and device testing. |
| Apple / iOS | Developer account/team, bundle ID, signing/profiles/entitlements, device/TestFlight pipeline; APNs and Apple Sign-In only if those features are chosen. |
| Phone OTP | Product decision; if required, Twilio Verify account/service credentials, abuse controls and delivery evidence. Existing endpoints remain disabled. |
| Hosting / database / GitHub administrators | Render service/branch settings, separate databases/users, replica-set transactions, backup/restore evidence, required PR checks/review, protected environments and release/incident owners. |

## Production release process represented in the repository

Current CI targets pushes/PRs to `main` and `staging`; `release-guard` requires its constituent jobs. Staging Smoke triggers on `staging`. Pages deployment and Production Smoke trigger on `main`; native release/build workflows use main/path or manual triggers. A documentation-only push to this new branch does not match those push filters. External hosting hook configuration is not represented sufficiently to certify it.

Several older notes conflict with current evidence: `STAGING_PROMOTION.md` describes Railway and direct staging work/direct-main emergency fixes, while current smoke uses Render URLs and this task requires task branches plus PRs. Treat [AGENTS.md](../AGENTS.md), this task's restrictions and current workflow code as the continuation rules. Do not infer a hosting migration or current database provider from stale prose.

Recommended future release sequence: feature branch → requested PR to staging → exact-commit CI/review → authorized merge and staging validation → explicit release approval and requested promotion PR to main → reviewed Production build/deploy → post-release smoke/monitoring, with a documented rollback target and operator. Branch protection, review enforcement and Render auto-deploy behavior must be verified separately. Existing automatic triggers are a deployment risk to inspect before promotion; do not dispatch or change them during this assessment.

## Risk register

| Risk | Impact | Required mitigation / owner |
| --- | --- | --- |
| Mock provider mistaken for real payment | Critical: unpaid bookings presented as commercial sales | Business/payment lead: label pilot scope, implement real adapter and sandbox evidence, keep public launch closed. |
| Readiness accepts arbitrary non-mock name | High: flag appears ready while checkout cannot work | Backend lead: validate registered provider/configuration at startup and readiness; add fail-closed regressions. |
| Six-trip count and Aladdin state assumed | High: unapproved inventory or prices sold | Pilot owner: redacted authorized snapshot, explicit Aladdin hold, approved agreements; never infer live state from fixtures. |
| Apparently read-only audit writes data | High: hold cleanup/reminders or helpers touch business records | All contributors: no live server/quote/departure/legacy E2E calls; Phase 1 runner for mutation tests. |
| Narrow/seeded E2E treated as complete | High: quote/capacity/payment/ticket chain gaps | Backend/QA: derive prices through public API in disposable fixture; exercise retries, isolation and cancellation end to end. |
| Unverified backups or non-isolated databases | Critical: loss or cross-environment writes | Infrastructure owner: isolated credentials, provider-native snapshots and measured restore drill to new target. |
| Reset mail skipped or links point to wrong environment | High: lockout or environment crossover | Email/app owner: verified sender/receipt, per-environment link checks and monitored recovery. |
| Simulator/debug artifacts mistaken for mobile release | High: device/store failure | Mobile owner: staging-targeted artifacts, signed Android/iOS device tests and distribution evidence. |
| Push/email lost during process restart | Medium/high depending on operational reliance | Operations/backend: monitored manual recovery initially; durable outbox/retry/scheduler before relying on guaranteed delivery. |
| Old promotion notes or automatic main triggers followed | Critical: unintended release | Release owner: task branches/PRs, protected checks/environments and explicit deployment authorization. |

## Recommended implementation order

1. **Phase 2B: close safe pilot acceptance gaps** as scoped below; record unresolved live inventory/business dependencies without changing them.
2. Reconcile six-trip/Aladdin/commission and personnel evidence, pilot scope, environment separation and recovery ownership through authorized review.
3. Validate browser/provider-camera behavior and, if needed, a dedicated staging-configured Android artifact; configure/verify email and FCM only through separately authorized tasks.
4. Select and implement the real payment/refund adapter and strengthen the public-launch/readiness gate; run provider-sandbox financial acceptance before any paid pilot/launch.
5. Close provider-native recovery, security/legal/support, protected release/rollback and operational monitoring evidence.
6. Complete signed Android distribution and signed iOS/TestFlight/device work for the channels selected for launch; then seek separate release authorization.
7. Improve durability, reconciliation automation, capacity/performance and optional auth/push features according to agreed scope.

## Exact recommended Phase 2B task

**“AQABA SEAGO — Phase 2B: disposable pilot quote-to-check-in acceptance.”**

Start a fresh branch from the then-authorized remote staging SHA. Extend safe repository integration coverage so the public API quote and checkout create the hold/payment, a signed mock webhook confirms the booking, the customer retrieves the ticket, the authorized provider inspects/checks in, and a second check-in fails. Compute expected adult/child/buffet gross, commission and provider net independently from approved fixture inputs, then compare the quote, hold and confirmed booking snapshots against those expectations; remove the inconsistent seeded 27-versus-29 pilot assertion. Include idempotent retry, capacity/expiry, cancellation/refund, suspended-provider denial (an Aladdin-labelled disposable fixture), cross-provider denial, owner/manager/staff/checkin capabilities and revocation.

Use **only** the Phase 1 disposable runner and owned fixture databases; register new files in its manifest and appropriate CI lane. Do not weaken test safety or run legacy live E2E helpers. Produce an exact-commit acceptance report distinguishing API automation, browser/device work and unresolved six-trip/Aladdin/external configuration evidence. Do not create or modify live inventory, assume six trips verified, contact Production, mutate Staging, deploy, merge, or open a PR without explicit instructions. Keep real gateway activation, FCM credentials and store signing as separately scoped work.

Acceptance: relevant safety/unit/disposable tests succeed with nonzero counts and no skipped required cases; quote/checkout and persisted financial snapshots match independently calculated expectations; duplicate payment/check-in and permission denials have assertions; only owned fixture data is changed; report exact source SHA and test results. No live business E2E or Production readiness claim follows from this task alone.

## Phase 2A validation record

Validation used backend **Node v20.20.2** in the fresh cloud clone, with locked dependencies installed using `npm ci --ignore-scripts --no-fund --no-audit` and a writable temporary npm cache. Install scripts were disabled; no database fixture or application server was started as setup.

- `npm run test:safety`: **18 passed, 0 failed, 0 skipped**.
- `npm run test:unit`: **308 passed, 0 failed, 0 skipped**, across 49 manifest files. The unit gate blocks MongoDB connection APIs; HTTP tests use loopback servers and mocked delivery.
- An initial restricted-sandbox attempt produced inconclusive zero counters and seven HTTP-listener test-file failures. The permission-adjusted rerun above produced actual nonzero counts and passed; no source change was made to obtain the pass.
- `git diff --check`, local documentation-link validation, baseline-parent verification and the two-file change allowlist passed before commit.
- Database lanes, browser/mobile builds, live smoke workflows, backup/restore commands and business E2E were **not rerun** for this documentation-only change. Their historical baseline CI evidence and limitations are stated above.

Only `AGENTS.md` and this roadmap are intended source changes. No application implementation, dependency lockfile, workflow, business data or hosted configuration change is part of Phase 2A. The commit/push identifiers belong in the accompanying completion report; neither a merge nor a PR nor a deployment is authorized here.
