# Aqaba SeaGo — Production Readiness Checklist

Last reviewed: 2026-10-04

This checklist is the single launch-control document for SeaGo. Do not add non-essential features until all **P0 launch blockers** are complete.

Status legend:
- ✅ Done / verified in current code
- 🟡 Partially done / needs final verification
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
- ✅ Payment webhook idempotency exists.
- ✅ Late/invalid payment handling uses `needs_review`.
- ⬜ Implement real gateway webhook signature verification.
- ⬜ Test success, failure, abandoned payment, duplicate webhook and delayed webhook.
- ⬜ Test full and partial refund behavior if supported.
- ⬜ Disable mock checkout in production.

**Exit criterion:** real test transaction reaches SeaGo, confirms one booking only, and reconciles correctly.

## 2. End-to-end booking test

- 🟡 Customer booking flow exists.
- ✅ Server-side pricing exists.
- ✅ Temporary seat holds exist.
- ✅ Hold timeout currently defaults to 5 minutes.
- ✅ Capacity is atomically reserved to reduce overselling.
- ✅ Checkout idempotency is required.
- ⬜ Run clean E2E test on a fresh real provider/departure with capacity > 1.
- ⬜ Test two customers attempting the final seat simultaneously.
- ⬜ Test checkout expiry and released seat.
- ⬜ Test successful payment after hold expiry.
- ⬜ Test duplicate submit from customer device.
- ⬜ Test browser reload during payment return.

**Exit criterion:** no duplicate booking, no oversell, no stranded reserved seat.

## 3. QR ticket and check-in

- 🟡 QR scanner exists in provider app.
- 🟡 Rear-camera preference exists.
- 🟡 Torch support exists where device/browser supports it.
- 🟡 Ticket ownership/provider validation exists.
- 🟡 Second check-in should be rejected.
- ⬜ Verify scan using a real customer QR on at least 2 iPhones and 1 Android device.
- ⬜ Verify ticket changes to USED immediately after successful scan.
- ⬜ Verify second scan reports already used without changing financial data.
- ⬜ Verify wrong provider cannot check in another provider's ticket.
- ⬜ Verify manual check-in works as fallback.

**Exit criterion:** provider can process a real boarding line without admin intervention.

## 4. Authentication and account security

- ✅ JWT authentication exists.
- ✅ Role checks exist for customer/provider/admin.
- ✅ Disabled users are rejected by authenticated routes.
- ✅ Passwords are hashed.
- 🟡 Google sign-in is integrated/configured but needs final production verification.
- ⬜ Review JWT expiry duration and production secret strength.
- ⬜ Confirm no secrets exist in Git history.
- ⬜ Rotate any credential ever shared during development before public launch.
- ⬜ Add/verify password reset or documented support recovery process.
- ⬜ Verify admin account cannot be created through a public registration route.
- ⬜ Verify provider ownership and team-role boundaries with negative tests.

**Exit criterion:** account takeover and privilege escalation basics are covered.

## 5. Remove temporary development hooks

- ⬜ Remove `RELEASE_WHITE_PRINCE_PILOT_HOLD` startup hook and hard-coded pilot departure ID from `src/server.js`.
- ⬜ Confirm demo seeding is disabled in production.
- ⬜ Confirm one-time demo cleanup switches are disabled.
- ⬜ Confirm pilot E2E startup flag is disabled.
- ⬜ Confirm email-test recipient startup hook is disabled.
- ✅ Public launch guard blocks demo seed and mock checkout.

**Exit criterion:** production startup performs no provider-specific or test-only mutations.

## 6. Database safety and backups

- ✅ MongoDB connection health is exposed through readiness endpoint.
- ⬜ Confirm production database is separate from test/dev.
- ⬜ Enable automated database backups.
- ⬜ Document restore procedure.
- ⬜ Perform one restore test into a non-production database.
- ⬜ Confirm retention period for backups.
- ⬜ Restrict database network/user permissions to minimum required access.

**Exit criterion:** accidental deletion or bad deployment can be recovered.

## 7. Error monitoring and operational visibility

- ✅ Health/readiness endpoint exists.
- ✅ Graceful shutdown exists.
- ⬜ Add production error monitoring/alerting.
- ⬜ Alert when API is unavailable.
- ⬜ Alert on repeated payment webhook failures.
- ⬜ Alert on email delivery failures above threshold.
- ⬜ Alert or admin queue for `needs_review` payments.
- ⬜ Define log retention and remove sensitive fields from logs.

**Exit criterion:** important failures are discovered automatically, not by customers.

## 8. Domain, HTTPS and production URLs

- ✅ Current Render API uses HTTPS.
- ✅ Current GitHub Pages frontend uses HTTPS.
- ⬜ Buy/choose official SeaGo domain.
- ⬜ Connect customer-facing production domain.
- ⬜ Decide whether provider/admin stay on subpaths or subdomains.
- ⬜ Update OAuth authorized origins/redirects.
- ⬜ Update CORS allow-list.
- ⬜ Update payment return/webhook URLs.
- ⬜ Verify HTTPS certificate renewal is automatic.

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
- ✅ Provider Home was simplified for pilot use.
- 🟡 Verify upcoming-trip Quick Start against production data after latest deployment.
- ⬜ Test all provider roles: owner, manager, staff, check-in.
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
- ⬜ Verify sold-out departures never appear bookable.
- ⬜ Verify cancelled departures cannot be purchased.

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
- ⬜ Test settlement calculations against hand-calculated examples.
- ⬜ Test refunds before and after provider settlement.
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

- ✅ Helmet is reported as implemented in current milestone.
- ✅ CORS is reported as implemented.
- ✅ Rate limiting is reported as implemented.
- ⬜ Review rate-limit thresholds by endpoint.
- ⬜ Add stronger rate limits to login/OTP/payment endpoints.
- ⬜ Validate request bodies consistently with schemas.
- ⬜ Review Mongo query injection risks.
- ⬜ Review XSS exposure in rendered customer/provider/admin data.
- ⬜ Review CSRF assumptions for bearer-token flows.
- ⬜ Review webhook replay protections.
- ⬜ Review file/image upload restrictions and MIME validation.
- ⬜ Review dependency vulnerabilities.
- ⬜ Run dependency audit in CI.
- ⬜ Add security headers verification test.
- ⬜ Ensure no PII/payment secrets are written to logs.
- ⬜ Perform external security/code review before wide public launch.

---

# P2 — Quality and testing

- ✅ Backend automated test command exists.
- ✅ CI builds backend, customer app, provider app and admin app.
- ✅ GitHub Pages deployment workflow exists.
- ⬜ Add automated integration test for full checkout flow.
- ⬜ Add concurrent-seat reservation test.
- ⬜ Add payment webhook duplicate/replay test.
- ⬜ Add expired-hold test.
- ⬜ Add provider permission tests.
- ⬜ Add QR/check-in integration tests.
- ⬜ Add settlement calculation tests.
- ⬜ Add refund + settlement tests.
- ⬜ Add smoke test after production deploy.
- ⬜ Define rollback procedure after a bad deployment.

---

# P2 — Production infrastructure

- ✅ API currently deployed on Render.
- ✅ Frontends currently deployed on GitHub Pages.
- ⬜ Separate production and staging environment variables.
- ⬜ Decide whether GitHub Pages remains final hosting for customer/provider/admin.
- ⬜ Configure production custom domain.
- ⬜ Confirm Render service plan is sufficient for expected traffic.
- ⬜ Confirm no sleep/cold-start behavior is acceptable for paid bookings.
- ⬜ Confirm MongoDB plan/storage/connection limits.
- ⬜ Add uptime monitoring.
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

## Sprint 1 — Clean and prove the core
1. Remove temporary pilot/development hooks.
2. Run clean booking/hold/capacity tests.
3. Run real QR/check-in tests.
4. Verify provider/admin financial numbers.
5. Test provider settlements with refunds.
6. Fix any discovered functional bugs.

## Sprint 2 — Production foundation
1. Production/staging separation.
2. Backups and restore test.
3. Monitoring and alerts.
4. Domain + HTTPS + CORS + OAuth cleanup.
5. Production email sender.
6. Legal/policy pages.

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
4. Run full E2E launch rehearsal.
5. Create stable release tag.
6. Enable public launch.

---

# Current high-level assessment

Based on the current repository:

- Core marketplace workflow: **well underway**
- Provider operations: **well underway**
- Admin operations: **well underway**
- Real payment: **not yet production-ready**
- Production operations/monitoring/backups: **incomplete**
- Security review: **not yet externally reviewed**
- Public launch: **not ready yet**
- Controlled non-real-money pilot: **close**

The goal from this point is **not to add more features**. The goal is to close this checklist from top to bottom.
