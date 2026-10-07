# Aqaba SeaGo — Production Readiness Checklist

Last reviewed: 2026-10-07

This checklist is the single launch-control document for SeaGo. Do not add non-essential features until all **P0 launch blockers** are complete.

Status legend:
- ✅ Done / verified in current code or automated validation
- 🟡 Partially done / needs final manual or production verification
- ⬜ Not done
- 🚫 Deferred intentionally

---

## Launch target

SeaGo is considered ready for a real public launch only when a real customer can:

1. Sign in.
2. Select a real trip and departure.
3. Pay through a real payment gateway.
4. Receive a valid booking/ticket.
5. Present the QR to the provider.
6. Provider scans it successfully.
7. Ticket becomes used exactly once.
8. Admin sees the booking, SeaGo commission, provider payable balance and settlement status.
9. Refund/cancellation flows update the financial records correctly.

---

# P0 — Launch blockers

These must be complete before public real-money launch.

## 1. Real payment gateway

- ⬜ Select production payment provider for Jordan.
- ⬜ Confirm the provider accepts SeaGo's marketplace/aggregator business model.
- ⬜ Confirm settlement destination is SeaGo's bank account.
- ⬜ Confirm supported cards, JOD, foreign cards, refunds and chargebacks.
- ⬜ Obtain production merchant credentials.
- ⬜ Implement production checkout adapter.
- ✅ Payment abstraction already exists in backend.
- ✅ Server blocks `PUBLIC_LAUNCH=true` while payment provider is still mock.
- ✅ Payment amount/currency validation exists.
- ✅ Payment webhook idempotency/replay protection exists and is covered by integration tests.
- ✅ Late/invalid payment handling uses `needs_review`.
- ✅ Concurrent payment/webhook transitions are serialized in automated tests.
- ✅ Refund-before-settlement and refund-after-settlement accounting are covered by automated tests.
- ⬜ Implement real gateway webhook signature verification.
- ⬜ Test the selected real gateway: success, failure, abandoned payment, duplicate webhook and delayed webhook.
- ⬜ Test real gateway full and partial refund behavior if supported.
- ⬜ Disable mock checkout in production before real-money launch.

**Exit criterion:** real test transaction reaches SeaGo, confirms one booking only, and reconciles correctly.

## 2. End-to-end booking test

- ✅ Customer booking flow exists.
- ✅ Server-side pricing exists.
- ✅ Temporary seat holds exist.
- ✅ Hold timeout currently defaults to **10 minutes** in `.env.example`.
- ✅ Capacity is atomically reserved to reduce overselling.
- ✅ Checkout idempotency is required and covered by automated integration tests.
- ✅ Final-seat concurrent booking test passes with exactly one winner.
- ✅ Checkout expiry/released-seat behavior is covered by automated tests.
- ✅ Late successful payment after failed/expired checkout is handled as `needs_review` without double booking.
- ✅ Duplicate checkout with the same idempotency key shares the same hold/payment identity.
- ✅ Payload mismatch / cross-departure idempotency leakage is covered by automated tests.
- ✅ Full Pilot E2E has passed against the dedicated Staging MongoDB replica set with cleanup successful.
- ⬜ Run one final clean rehearsal with a real provider/departure and real human devices immediately before launch.
- ⬜ Test browser reload during the real payment return flow once the real gateway is integrated.

**Exit criterion:** no duplicate booking, no oversell, no stranded reserved seat.

## 3. QR ticket and check-in

- ✅ QR scanner exists in provider app.
- 🟡 Rear-camera preference exists and still needs final multi-device verification.
- 🟡 Torch support exists where device/browser supports it and still needs final multi-device verification.
- ✅ Ticket ownership/provider validation is covered by automated integration tests.
- ✅ Wrong provider is rejected by automated tests.
- ✅ Simultaneous double-scan is atomic: exactly one check-in succeeds.
- ✅ Later scan of an already-used ticket is rejected by automated tests.
- ✅ Check-in role capability boundaries are covered by provider-role tests.
- ⬜ Verify scan using a real customer QR on at least 2 iPhones and 1 Android device.
- ⬜ Verify ticket changes to USED immediately on those real devices.
- ⬜ Verify manual check-in works as operational fallback on a real pilot booking.

**Exit criterion:** provider can process a real boarding line without admin intervention.

## 4. Authentication and account security

- ✅ JWT authentication exists.
- ✅ Role checks exist for customer/provider/admin.
- ✅ Disabled users are rejected by authenticated routes.
- ✅ Passwords are hashed.
- 🟡 Google sign-in configuration and production CORS are covered by Production Smoke; one final real-user Google sign-in verification is still required.
- ✅ Provider ownership and team-role boundaries are covered by negative integration tests for owner, manager, staff and check-in roles.
- ✅ Public registration cannot create an `admin` account; an explicit HTTP regression test verifies both the returned user role and JWT role are downgraded to `customer` when `role:"admin"` is requested.
- ✅ Production JWT policy is enforced and tested: token lifetime is capped at 24 hours, production secrets must be at least 32 characters, and obvious placeholder secrets are rejected at startup.
- ✅ Full Git history is scanned by Gitleaks in CI and currently passes; `.env` has never been tracked in repository history.
- ⬜ Rotate any credential ever shared during development before public launch.
- ⬜ Add/verify password reset or documented support recovery process.

**Exit criterion:** account takeover and privilege escalation basics are covered.

## 5. Remove temporary development hooks

- ✅ `RELEASE_WHITE_PRINCE_PILOT_HOLD` startup hook and hard-coded pilot release logic were removed.
- ✅ Automatic development startup hooks were removed from `src/server.js`.
- ✅ Production fails closed if stale legacy startup flags are configured.
- ✅ Demo seeding is not run automatically at production startup.
- ✅ One-time demo cleanup is not run automatically at production startup.
- ✅ Pilot E2E is not run automatically at production startup.
- ✅ Email-test startup hook is not run automatically at production startup.
- ✅ Public launch guard blocks unsafe mock/demo launch configuration.

**Exit criterion:** production startup performs no provider-specific or test-only mutations. **Met in current code.**

## 6. Database safety and backups

- ✅ MongoDB connection health is exposed through readiness endpoint.
- ✅ Staging is separated from production and uses its own Railway MongoDB single-node replica set.
- ✅ Staging and production environment variables are separated.
- ✅ Application-level BSON backup/restore tooling exists and preserves documents, BSON types, empty collections and indexes.
- ✅ Restore is fail-closed for production/public launch, requires explicit opt-in and exact target confirmation, and refuses restoring into the source database name.
- ✅ Restore procedure is documented in `docs/DATABASE_BACKUP_RESTORE.md`.
- ✅ Automated backup → restore → verification drill passes against a disposable non-production MongoDB replica set in CI.
- ⬜ Enable/confirm provider-native automated production database backups.
- ⬜ Confirm provider-native retention period for backups.
- ⬜ Perform one provider-native backup restore test into a non-production database/cluster.
- ⬜ Restrict production database network/user permissions to minimum required access.

**Exit criterion:** accidental deletion or bad deployment can be recovered. **Application-level recovery is validated; provider-native production backup coverage remains open.**

## 7. Error monitoring and operational visibility

- ✅ Health/readiness endpoints exist.
- ✅ `/health` reports deployed commit SHA on both Railway and Render environments.
- ✅ Graceful shutdown exists.
- ✅ Production Smoke checks deployed commit identity and critical public endpoints after `main` releases.
- 🟡 Scheduled production uptime workflow is present on `main` and configured for 15-minute checks with retries/timeouts, but an actual GitHub `schedule` execution has not yet been observed and verified.
- 🟡 Persistent uptime failures are designed to fail the GitHub Actions monitor and open/update an incident issue; a real scheduled execution and guaranteed external escalation channel are still unverified.
- ✅ Protected admin operations queue surfaces `needs_review` payments, notification failures from the last 24 hours and open/in-progress support workload.
- ✅ Operations-queue authorization and counts are covered by an integration test on a disposable MongoDB replica set.
- ✅ Payment webhook processing failures emit bounded structured logs without intentionally logging raw webhook payloads or signatures.
- ✅ Central production API error logging is privacy-safe and regression-tested: request bodies, query/auth data, stack traces, arbitrary error properties and sensitive error messages are not emitted by the central production logger.
- ✅ Internal 5xx error details are not disclosed to API clients; 5xx responses return a generic error while controlled 4xx messages are bounded and normalized.
- ⬜ Alert on repeated payment webhook failures above a defined threshold after the real gateway is integrated.
- ⬜ Alert on email delivery failures above a defined threshold after the production sender is configured.
- ⬜ Define production log-retention period and complete any remaining external/platform logging review.
- ✅ Monitoring response procedure is documented in `docs/MONITORING_RUNBOOK.md`.

**Exit criterion:** important failures are discovered automatically and routed to an operator. **Core discovery/operations visibility is implemented; first scheduled uptime execution, guaranteed external escalation and final threshold/log-retention policy remain open.**

## 8. Domain, HTTPS and production URLs

- ✅ Current Render API uses HTTPS.
- ✅ Current GitHub Pages frontends use HTTPS.
- ✅ Production Smoke verifies Google auth configuration/CORS and public app pages.
- ⬜ Buy/choose official SeaGo domain.
- ⬜ Connect customer-facing production domain.
- ⬜ Decide whether provider/admin stay on subpaths or subdomains.
- ⬜ Update OAuth authorized origins/redirects for the final official domain.
- ⬜ Update CORS allow-list for the final official domain.
- ⬜ Update payment return/webhook URLs after gateway selection.
- ⬜ Verify HTTPS certificate renewal on final official domain is automatic.

**Exit criterion:** all production URLs use official domains and valid HTTPS.

## 9. Policies and legal customer flows

- ⬜ Privacy Policy.
- ⬜ Terms of Use.
- ⬜ Cancellation Policy.
- ⬜ Refund Policy.
- ⬜ Provider agreement.
- ⬜ Customer support contact method.
- ⬜ Show policies before/at checkout where required.
- ⬜ Confirm business/trade licensing classification.
- ⬜ Confirm payment provider accepts the marketplace structure.

**Exit criterion:** customer and provider obligations are explicit before accepting real money.

---

# P1 — Required for a controlled pilot

These can be completed before or during a small invited pilot, but should be done before meaningful scale.

## Provider operations

- ✅ Provider app exists.
- ✅ Trips management exists.
- ✅ Departure scheduling exists.
- ✅ Open / Sold Out controls exist.
- ✅ Passenger manifest exists.
- ✅ QR scanner exists.
- ✅ Manual check-in exists.
- ✅ Provider team roles/capabilities exist.
- ✅ Provider role permissions are covered by HTTP integration tests.
- ✅ Owner/manager/staff/check-in boundaries are automated, including finance visibility and trip/departure/check-in permissions.
- ✅ Provider Home was simplified for pilot use.
- 🟡 Verify upcoming-trip Quick Start against production data after latest deployment.
- ⬜ Confirm provider phone/contact info appears where expected.
- ⬜ Add clear provider support/escalation path.

## Customer experience

- ✅ Customer app exists.
- ✅ Booking and ticket screens exist.
- ✅ Customer phone is required/captured for booking workflow.
- ✅ Customer details are snapshotted on new bookings.
- ⬜ Final mobile UX pass on iPhone and Android.
- ⬜ Empty/loading/error states review.
- ⬜ Verify date/time display is consistently Jordan time.
- ⬜ Verify sold-out departures never appear bookable on real pilot inventory.
- ⬜ Verify cancelled departures cannot be purchased on real pilot inventory.

## Admin operations

- ✅ Admin dashboard exists.
- ✅ Revenue/bookings overview exists.
- ✅ Provider-level financial breakdown exists.
- ✅ Provider approval/status controls exist.
- ✅ Trip commission controls exist.
- ✅ Refund visibility exists.
- ✅ Provider Settlements workspace exists.
- ✅ Paid vs outstanding provider balances are tracked.
- ✅ Settlement history exists.
- ✅ Duplicate settlement protection exists.
- ✅ Settlement calculations are covered by hand-calculated automated examples.
- ✅ Refund-before-settlement reduces provider payable correctly in automated tests.
- ✅ Refund-after-settlement preserves actual cash paid and records recovery correctly in automated tests.
- ✅ Concurrent settlement payout is protected against duplicate payout.
- ✅ Protected operations endpoint exposes `needs_review`, recent notification failures and support workload to admins only.
- ⬜ Define process for correcting an incorrectly marked settlement.
- ⬜ Add export/download report if operations require it.

## Notifications

- 🟡 Email notification infrastructure exists.
- ⬜ Configure verified production sender/domain.
- ⬜ Verify customer booking confirmation.
- ⬜ Verify provider new-booking notification.
- ⬜ Verify cancellation/refund notifications.
- ⬜ Verify reminder scheduling.
- ⬜ Decide whether WhatsApp integration is needed for launch or can remain manual.

---

# P2 — Security hardening

A senior/security reviewer should review this section before broad public launch.

- ✅ Helmet is implemented.
- ✅ CORS is implemented, fails closed for an empty production allowlist, and allowed/hostile origins are covered by automated and Production Smoke validation.
- ✅ API rate limiting is implemented.
- ✅ Auth endpoints have a separate stricter rate limiter.
- ✅ Provider ownership/capability boundaries have automated negative tests.
- ✅ Public registration privilege escalation is covered by an explicit HTTP regression test: requesting `role:"admin"` yields a `customer` user and `customer` JWT claims.
- ✅ Production JWT secret and expiry policy is enforced at startup and covered by automated tests.
- ✅ Gitleaks scans the complete Git history in CI and the current scan passes.
- ⬜ Review final rate-limit thresholds by endpoint.
- ⬜ Add payment-specific abuse/rate-limit review once real gateway is selected.
- ✅ Request bodies on security-sensitive/mutating flows have explicit validation, with regression coverage added across booking/payment/support/media paths.
- ✅ Mongo query/operator injection risks are centrally hardened: unsafe `$` operators, dotted keys and prototype-pollution keys are rejected before application routes, with regression tests.
- ✅ XSS exposure was reviewed for the current React customer/provider/admin rendering path; no unsafe raw-HTML rendering path was found in the reviewed UI code. Re-review if raw HTML/content rendering is introduced later.
- ✅ CSRF assumptions were reviewed for the current bearer-token model: API auth uses bearer JWTs rather than ambient session cookies, CORS credentials are disabled, and the assumption is documented for future re-review if cookie auth is introduced.
- ✅ Mock/payment webhook duplicate/replay behavior is covered by integration tests.
- ⬜ Review real gateway webhook replay/signature protections after integration.
- ✅ File/image upload restrictions include MIME/signature verification before accepted image content is stored, with regression coverage.
- ✅ Dependency vulnerabilities are reviewed automatically through CI dependency-audit jobs for backend, customer, provider and admin packages.
- ✅ Dependency audit runs in CI and currently passes.
- ✅ Security headers have both automated app-level regression coverage and live Production Smoke verification on Render; the current runtime check passes.
- ✅ Central production error logging and webhook failure logging are privacy-hardened and regression-tested against accidental sensitive-detail leakage; production log-retention/platform policy still remains to be defined.
- ✅ Internal server errors fail closed to generic 5xx client responses; controlled 4xx messages are bounded and normalized.
- ⬜ Perform external security/code review before wide public launch.

---

# P2 — Quality and testing

- ✅ Backend automated test command exists.
- ✅ CI runs on both `staging` and `main`.
- ✅ CI builds backend, customer app, provider app and admin app.
- ✅ Full-history secret scanning runs in CI and currently passes.
- ✅ Database backup/restore roundtrip is exercised in CI against a disposable MongoDB replica set.
- ✅ Protected admin operations queue has HTTP authorization/count regression coverage in CI.
- ✅ GitHub Pages deployment workflow exists.
- ✅ Automated checkout integration test exists.
- ✅ Concurrent final-seat reservation test exists.
- ✅ Payment webhook duplicate/replay tests exist.
- ✅ Expired-hold/release tests exist.
- ✅ Provider permission tests exist.
- ✅ QR/check-in integration tests exist.
- ✅ Settlement calculation tests exist.
- ✅ Refund + settlement tests exist.
- ✅ Cancellation/inventory rollback and retry tests exist.
- ✅ Public admin-registration privilege-escalation regression test exists and passes in CI.
- ✅ Production Smoke runs on `main` and validates production endpoints, deployed backend/frontend commit identity, CORS/hostile-origin behavior and live security headers.
- ✅ Staging Smoke validates readiness, public trips, `PUBLIC_LAUNCH=false`, and verifies the deployed API is at or after the latest backend-affecting commit instead of falsely requiring docs/workflow-only commits to redeploy the API.
- ✅ Staging promotion flow is documented in `docs/STAGING_TO_PRODUCTION.md`.
- 🟡 Operational rollback procedure exists at platform level, but a formal written application rollback/runbook is still recommended.

---

# P2 — Production infrastructure

- ✅ API currently deployed on Render Production.
- ✅ Frontends currently deployed on GitHub Pages.
- ✅ Dedicated Railway Staging API exists.
- ✅ Dedicated Railway Staging MongoDB replica set exists.
- ✅ Production and staging environment variables are separated.
- ✅ `staging -> CI -> Staging Smoke -> PR -> main -> Production -> Production Smoke` release flow is established.
- ✅ Each promoted `main` release is validated by Production Smoke against the latest backend/frontend-affecting commit identity as appropriate.
- ✅ Railway Staging follows the `staging` branch without a stale commit pin; workflow/docs-only changes no longer create false Staging Smoke failures.
- 🟡 Render is configured with Auto Deploy from `main`, but multiple 2026-10-07 application promotions required manual deploys because the automatic deploy event did not fire; investigate before relying on it operationally.
- ⬜ Decide whether GitHub Pages remains final hosting for customer/provider/admin.
- ⬜ Configure production custom domain.
- ⬜ Confirm Render service plan is sufficient for expected traffic.
- ⬜ Confirm no sleep/cold-start behavior is acceptable for paid bookings.
- ⬜ Confirm production MongoDB plan/storage/connection limits.
- 🟡 Scheduled uptime workflow is implemented on `main`, but no actual GitHub `schedule` run has yet been observed in Actions; keep this open until the first scheduled production execution is verified.
- ⬜ Document ownership/access to GitHub, Render, domain, database and payment provider.

---

# P3 — After launch / scale

Not blockers for first real launch.

- 🚫 Native iOS app.
- 🚫 Native Android app.
- 🚫 Advanced dynamic pricing.
- 🚫 Automated provider bank payouts.
- 🚫 Full split-settlement marketplace payments.
- 🚫 Loyalty/referral program.
- 🚫 Advanced BI dashboards.
- 🚫 Multi-city expansion.
- 🚫 Multi-currency settlement.
- 🚫 Full Arabic UI redesign unless product decision changes.
- 🚫 Advanced CRM/marketing automation.

---

# Recommended execution order

Do not work on this list randomly.

## Sprint 1 — Clean and prove the core — substantially completed
1. ✅ Remove temporary pilot/development hooks.
2. ✅ Automate booking/hold/capacity tests.
3. ✅ Automate QR/check-in backend tests.
4. ✅ Verify provider/admin financial calculations with automated examples.
5. ✅ Test provider settlements with refunds.
6. 🟡 Complete real-device QR/mobile rehearsal before launch.

## Sprint 2 — Production foundation — in progress
1. ✅ Production/staging separation.
2. 🟡 Application-level backup/restore validated; provider-native backups/retention still need verification.
3. 🟡 Core monitoring implemented; first scheduled uptime execution, guaranteed external escalation, thresholds and log-retention policy remain.
4. ⬜ Official domain + final HTTPS/CORS/OAuth cleanup.
5. ⬜ Production email sender.
6. ⬜ Legal/policy pages.
7. 🟡 Investigate/verify Render Auto Deploy reliability.

## Sprint 3 — Real payment
1. Select gateway.
2. Get merchant approval.
3. Implement adapter/webhooks.
4. Run sandbox tests.
5. Run small real transaction.
6. Test refund and failed-payment cases.
7. Reconcile transaction against booking and provider settlement.

## Sprint 4 — Launch verification
1. External payment integration review.
2. External security/code review.
3. Fix findings.
4. Run full E2E launch rehearsal on real devices.
5. Create stable release tag.
6. Enable public launch.

---

# Current high-level assessment

Based on the repository and validated deployments on 2026-10-07:

- Core marketplace workflow: **strong automated coverage; final real-device rehearsal remains**
- Provider operations: **strong automated permission coverage; final operational rehearsal remains**
- Admin/financial operations: **core commission/refund/settlement logic plus protected operational exception queue are covered by integration tests**
- Staging/production separation: **implemented and validated**
- CI + Staging Smoke + Production Smoke: **implemented and passing; smoke checks now distinguish backend-affecting commits from workflow/docs-only changes**
- JWT/security baseline: **production expiry/secret policy enforced; full-history secret scan passes**
- Security hardening: **request validation, Mongo operator-key rejection, CORS fail-closed, image MIME/signature checks, dependency audit, live security-header verification, privacy-safe production error logs and generic 5xx client responses are implemented and automated; external review and real-gateway-specific review remain**
- Database recovery: **application-level backup/restore tooling and automated restore drill validated; provider-native production backups/retention still unverified**
- Production monitoring: **uptime workflow and protected operations queue are implemented; the first actual scheduled GitHub Actions uptime execution, external escalation/threshold alerts and log-retention policy remain open**
- Real payment: **not yet production-ready**
- Legal/policies/domain: **incomplete**
- Security review: **internal hardening substantially completed; external independent review still required before wide public launch**
- Public real-money launch: **not ready yet**
- Controlled non-real-money pilot: **technically much closer; final real-device/operational checks remain**

The goal from this point is **not to add more features**. The goal is to close the remaining P0 items from top to bottom.
