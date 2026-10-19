# Phase 2B — Disposable pilot quote-to-check-in acceptance

## Baseline and scope

- Repository: `mohammadalnablsi701-del/-aqaba-seago`.
- Authoritative remote staging baseline: `62b88bd9364fba67512d692e8cc8c5f491a97ffe`.
- Default branch `main` and exact staging HEAD verified before implementation; staging `AGENTS.md` was read before changes.
- Fresh task branch: `codex/phase2b-disposable-pilot-e2e`, created from that exact commit in a fresh cloud clone.
- Scope: local public HTTP/API acceptance of synthetic quote, checkout, payment, financial snapshot, ticket and check-in, with focused regressions for defects established by failing tests. No real gateway integration or business rate changes.

## Safety boundary

All database-dependent execution uses `npm run test:db` through the unchanged Phase 1 runner. The runner creates its own `MongoMemoryReplSet`, scrubs inherited configuration, issues expiring PID-bound fixture authority over IPC and restricts connections/deletion to independently allocated owned database names. Tests use `requireFixture()`, `connectFixture()` and `cleanupFixtures()`; they do not run directly, accept an external URI or weaken guards/manifests.

The acceptance harness imports `createApp()` and listens on ephemeral `127.0.0.1` only. It never imports `src/server.js`, loads dotenv, starts background jobs or calls deployed APIs. Test-only JWT/ticket/webhook secrets are generated locally. Payment uses only the in-memory mock adapter. Resend/VAPID credentials are absent and native FCM is disabled. Harness fetch is restricted to its exact loopback origin with redirects rejected; attempted external requests are checked. Public/frontend link configuration is local.

Production and Staging are not contacted. No live records, existing provider/trip/customer IDs, email, FCM, web push or SMS are used. Official Node/MongoDB/package downloads are tool provisioning, not business service access. MongoDB binary caching does not change runner authority, environment scrubbing or connection policy. Generated binaries, caches and fixture data are excluded from the source diff.

## Architecture exercised and prior coverage

| Concern | Implementation | Existing evidence extended or retained |
| --- | --- | --- |
| Quote / tiered price | `src/routes/departures.js`; `src/services/pricing.js`, `commission.js`, `pricingVisibility.js` | Pricing and commission unit tests, customer pricing truth integration |
| Checkout / capacity / hold | `src/routes/payments.js`; `src/services/checkout.js`, `inventory.js`; Departure and CheckoutHold models | Checkout-capacity integration: final-seat race, unique key, mismatch rollback, expiry |
| Mock checkout / signed completion | `src/payments/providers/mock.js`; `src/routes/paymentWebhooks.js`; `src/services/payments.js` | Payment transitions, correlation and event-durability integration |
| Confirmed booking / snapshot | Booking, Payment, CheckoutHold, PaymentEvent models; `payments.js` | Snapshot/history and customer DTO integration |
| Customer ticket / QR / lifecycle | `src/routes/bookings.js`, `tickets.js`, `providerCheckin.js`; `src/services/tickets.js`, `ticketLifecycle.js` | Customer ticket lifecycle, ticket check-in and link-security tests |
| Provider capabilities / suspension | `src/services/providerAccess.js`; Provider, ProviderMember and User models; sales checks in routes/services | Provider role, provider-sales-control and access-admin integration |
| Cancellation / refund / settlement | Booking routes; `cancellations.js`, `refunds.js`, `settlements.js`; Refund and settlement models | Customer cancellation, refund contract/durability/retry and settlement safety integration |

The former pilot test directly inserted hold/payment values, called the payment service directly and generated a QR without customer retrieval. It therefore did not prove the HTTP quote-to-checkout chain. The existing approved pilot test file is extended rather than adding a parallel database entry; the safety manifest and CI lane already include it.

## Synthetic fixtures and expected financial truth

Fixtures use `Phase2B Test` names and synthetic users, providers, trips and future departures. A separate synthetic Aladdin-labelled provider tests generic suspension behavior; it has no relationship to a live operator record. Each HTTP purchase creates its own hold/payment/booking through application code; direct fixture writes are reserved for setup and deliberate owned-data corruption/expiry/status controls.

The price contract is independently calculable:

| Package, one adult plus one child | Adult | Child | Gross | Commission | Provider net |
| --- | ---: | ---: | ---: | ---: | ---: |
| Without buffet | 15 | 10 | 25 | 3 + 2 = 5 | 20 |
| With buffet | 17 | 12 | 29 | 3 + 2 = 5 | 24 |

Currency is JOD. Buffet prices are inclusive package prices; the model does not store a separate meal surcharge. The package difference is 4 JOD for this synthetic adult/child pair. Expected values must be compared against quote, hold, payment amount/currency and confirmed booking snapshots, not derived solely from a returned API total. Payment stores amount/currency and hold/booking relationships; the full commission split resides in hold/booking pricing.

## Pricing 27 versus 29 investigation

**Finding: stale/inconsistent test fixture, not a business-price defect.** At the authoritative baseline, `test/pilot-booking-ticket.e2e.test.js` configured buffet adult 17 and child 12 but directly inserted gross 27, commission 5 and net 22. The same 17/12 prices exist in `SEA_BREEZE_FIXED_PRICING` in `src/services/seaBreezeCorrection.js`; `test/sea-breeze-correction.test.js` independently expects 29/5/24. The unrelated 27 in `test/pricing.test.js` is a valid net result for gross 35 less commission 8 and is preserved.

The replacement acceptance flow uses synthetic prices and actual quote/checkout rather than changing an operator rate or replacing numbers blindly. Live price agreements and actual inventory remain outside this assessment.

## Commission, capacity, payment and ticket evidence

The acceptance flow checks server-only financial authority, snapshots surviving later catalog/rule changes, trusted settlement derivation and no duplicate financial effect after payment replay. Customer responses redact commission/provider net. Customer financial checkout overrides are rejected; provider trip edits accept sale-price fields while ignoring administrative commission fields, leaving the trusted rates unchanged. Historical snapshot persistence means later catalog changes do not re-price the purchased booking; it does not grant arbitrary database writers permission to alter snapshots.

Capacity cases use concurrent local HTTP submissions for the final seat and repeated identical checkout keys, then inspect owned persisted inventory, holds and payments. Expiry is induced only on an owned synthetic hold; quote cleanup must release seats once and late paid events must not recreate a booking.

Payment cases traverse the raw HTTP webhook route with HMAC-signed JSON. Pending/invalid-signature/correlation/money cases cannot issue a booking; valid paid completion and replay are checked against persisted identities and event counts. Mock execution is not evidence of real payment or refund movement.

Current boarding QR v2 signs the booking identity. The server loads persisted provider/trip/departure relationships; changing the booking ID to another trip/departure while retaining its signature must fail. Legacy v1 carries optional relationship claims, all of which must agree with the booking. Provider ownership and capability are checked before boarding state is disclosed or changed. A successful check-in must become used and reject replay without changing the original check-in time/count.

The current provider API accepts a token, not a selected manifest trip/departure context. Cryptographic/legacy binding rejection is distinct from a UI-enforced selected-departure workflow; this phase does not invent or claim that additional contract.

All supported active provider roles (owner, manager, staff, checkin) include check-in capability. The supported denial cases are unassigned/revoked membership, inactive user/auth revocation and unapproved provider status, rather than an invented active staff role lacking that capability. Existing role tests retain finance redaction and management-boundary evidence.

## Aladdin source safeguard and business decisions

Generic approved-provider requirements protect sales and provider operations. No named immutable Aladdin activation lock was found. The repository candidate declares `active:false` and unresolved commission, capacity, fares, child policy, schedule and meeting point; audited admin reactivation exists generically.

**LIVE STATUS REQUIRES AUTHORIZED STAGING READ-ONLY VERIFICATION**

No live inventory count, provider status or six-trip readiness is established here. Do not activate Aladdin or run legacy pilot/demo/correction helpers. Unresolved business decisions remain payment gateway, actual inventory/price/commission approval, operational roles, pilot channel scope and manual recovery/refund/payout ownership.

## Execution results and verdict

### Executed lifecycle and negative/security cases

The focused green run of the pilot acceptance and customer ticket lifecycle files completed **24 tests: 24 PASS, 0 FAIL, 0 SKIP**. The pilot file contributes 17, including its parent; the lifecycle file contributes 7, including its parent. Cases inside grouped tests are assertions, not additional TAP test counts.

| Case | Result | Executed evidence |
| --- | --- | --- |
| Synthetic eligible provider, active trip, scheduled future departure and customer authentication | PASS | Local registration/login and persisted fixtures; unauthenticated checkout 401, provider-role checkout 403 |
| Base/adult/child and inclusive buffet quote | PASS | Independent 25/29 gross, 15/10 and 17/12 unit/subtotal expectations; no quote capacity effect |
| Zero/negative/fractional/malformed/string/object/array/excessive checkout quantities | PASS | HTTP 400 without hold/payment/inventory changes |
| Invalid quote quantities and excessive quote quantity | PASS | Invalid quantities 400; quantity beyond available capacity 409, safely rejected |
| Malformed meal selection | PASS | Quote/checkout HTTP 400; shared pricing function rejects invalid enum |
| Disabled buffet, missing selected buffet rates, negative stored base/buffet rates | PASS | Quote and checkout fail closed (existing HTTP 500 contract); checkout transaction leaves zero reserved seats/holds |
| Legitimate zero-priced child and legacy non-buffet fallback | PASS | Focused pricing unit run preserves these valid configurations |
| Client total, amount, pricing, commission/value, provider payout and provider-ID overrides | PASS | Checkout allowlist returns 400; provider cannot invoke customer checkout |
| Provider commission edit attempt | PASS | Trip PATCH safely ignores administrative financial fields; stored 3/2 rates unchanged |
| Checkout hold/payment and no unpaid confirmed booking | PASS | Actual HTTP creates one pending mock payment and active authoritative hold; booking count stays zero; direct booking-create route returns 410 |
| Invalid payment signature | PASS | HTTP 400 before durable event or booking creation |
| Verified paid completion, replay and distinct repeated success | PASS | Raw-body signed HTTP webhook; one booking/payment, one seat allocation, unique durable event claim and one customer confirmation notification |
| Financial/relationship snapshot | PASS | Adult/child/seats/meal, currency, selected units/subtotals, gross/commission/net and customer/provider/trip/departure checked in owned documents |
| Catalog/commission mutation after checkout | PASS | Booking copies hold snapshot 29/5/24 despite changed current catalog; admin settlement reports one booking, gross 29, fee 5, net/payable 24 |
| Customer ticket, privacy and QR signing | PASS | Ticket obtained through authenticated booking API; correct relationships; private finance fields absent; current v2 HMAC independently checked |
| Wrong provider / revoked or unassigned member / customer attempting check-in | PASS | HTTP 403; check-in count remains zero before authorized redemption |
| Owner/manager/staff/checkin capability and authorized redemption | PASS | All four supported roles can inspect; active checkin member redeems with recorded actor/time and count 1 |
| Used ticket / duplicate QR or manual scan | PASS | Used state observed through customer API; 409; original checked-in actor/time/count remain unchanged |
| Forged/modified current QR, different-trip or different-departure booking substitution | PASS | HTTP 400 for modified signature/booking identity; other genuine bookings remain unused |
| Contradictory legacy trip claim | PASS | Provider inspect/check-in and public validation return 400; no mutation; matching legacy trip remains compatible |
| Concurrent last-seat race and same-key retry | PASS | One 201 plus one 409 for final seat; repeated key returns the same payment, one hold and one reservation; changed details 409 |
| Hold expiry/release and late success | PASS | Owned hold moved past expiry; repeated quote cleanup releases once; payment expired, later paid event needs_review and no booking |
| Unknown/wrong/cross-correlated payment identity, wrong amount/currency | PASS | Unknown 404 or acknowledged needs_review; unrelated payment remains pending; no booking issued |
| Actual cancellation, mock refund and retry | PASS | Paid future booking cancelled twice: one succeeded Refund, processed amount 29, one inventory release; boarding denied; late paid event cannot resurrect refunded payment |
| Expired genuine ticket | PASS | Paid ticket moved beyond its planned end in owned fixture; QR/manual check-in 409 with zero check-ins |
| Approved to suspended/pending/rejected synthetic provider | PASS | Quote/sales/inspect/check-in/manual denial; late paid checkout reviewed and its hold released; confirmed booking remains unused |
| Outbound/data boundary | PASS | Exact loopback-only HTTP guard reports no attempted external request; only mock payments, no sent email logs, no negative/oversold departure counters |

Existing full-lane coverage additionally exercises customer isolation, pending/failed payment transitions, durable event crash/retry, refund reconciliation/races, refunded-booking lifecycle, management permissions and settlement allocation safety. Final full-lane counts are recorded below; the table above is already supported by the focused executed runs, with pricing-unit evidence where indicated.

### Verified defects and minimal fixes

| Defect established by failing regression | Fix |
| --- | --- |
| Quote silently converted malformed meal selection into a different package | `src/routes/departures.js` explicitly validates the supported enum and returns 400; omitted meal still defaults to without buffet |
| Shared pricing accepted malformed meal selection | `src/services/pricing.js` rejects the unsupported enum, preserving omitted-value default |
| Selected enabled buffet with missing/null stored prices silently substituted base prices | Pricing now requires both selected buffet prices, consistent with the existing trip-management input contract; legitimate zero prices and non-buffet legacy fallback remain supported |
| Signed historical QR with contradictory trip claim was accepted | `src/routes/tickets.js` applies the existing optional relationship-binding rule to trip ID as well as provider/departure, including public validation |
| Old pilot fixture inserted inconsistent 27/5/22 values and bypassed quote/checkout | Existing pilot test now uses synthetic API-generated financial state and independently verified 29/5/24; no business rates were changed |

Regression evidence before the relevant source fixes: focused pricing **11 total / 9 pass / 2 fail / 0 skip**; pilot HTTP **17 / 14 / 3 / 0** (two failed groups plus failed parent); corrected legacy-binding regression **7 / 5 / 2 / 0** (failed group plus parent). These are expected red proof, not the final validation verdict. An earlier authoring run of the legacy test also failed **7 / 5 / 2 / 0** because its new synthetic Trip omitted required `pricePerPerson`; that fixture was corrected before reproducing the actual binding failure. One initial pilot red run expected quantity 501 to return 400; its existing safe 409 capacity rejection was retained and the assertion corrected before the meal regression was confirmed. No application change was made for that already-safe quantity behavior.

Focused checks after fixes: pricing **11 / 11 / 0 / 0**; combined pilot/ticket DB **24 / 24 / 0 / 0**. All database runs used the approved runner. No Phase 1 code, authority, manifest, connection/deletion guard, environment allowlist or cleanup contract changed. No existing required case was skipped or removed to obtain green results.

### Pilot verdict and remaining scope

- **PASS — Phase 2B local disposable API acceptance.** The quote-to-checked-in transaction and the tested negative/security/financial paths have executed evidence.
- **PARTIAL — overall controlled-pilot readiness.** Real six-trip inventory, Aladdin live status, operator agreements/identities, browser/camera/physical-device behavior, hosted credentials and recovery ownership are not proved by API fixtures.
- **BLOCKED — real-money/public launch.** This phase uses mock payments/refunds only. The real gateway, operational recovery/email/release controls and channel-specific mobile readiness remain separate roadmap work.
- Selected scanner manifest trip/departure context remains outside the existing token-only API contract. The PASS above covers authoritative booking binding and contradictory/tampered credentials, not a new scanner selection feature.

### Final validation record

Executed with backend **Node v20.20.2** and MongoDB **8.2.6**, the installed runner's default, on 2026-10-19 UTC. Dependencies were installed from the unchanged lockfile with lifecycle scripts disabled. Binary archives were verified and cached locally outside source control; no runner/environment-policy bypass was introduced.

| Command / lane | Files | Total | Pass | Fail | Skip |
| --- | ---: | ---: | ---: | ---: | ---: |
| `npm run test:safety` | 1 | 18 | 18 | 0 | 0 |
| `npm run test:unit` | All 49 approved unit entries | 312 | 312 | 0 | 0 |
| `npm run test:db` | All 30 approved database entries | 226 | 226 | 0 | 0 |
| Final full-lane total | 80 | **556** | **556** | **0** | **0** |

The DB lane includes the 17-test pilot acceptance, 7-test customer ticket lifecycle, pricing truth, checkout capacity, payment correlation/transitions/event durability, provider roles/sales/access, customer cancellation, refund contract/retry/durability, settlement safety and all other entries in the unchanged `scripts/test-safety/manifest.mjs`. No approved DB file was omitted. The full-lane counts above include nested parent tests according to Node TAP output; targeted reruns are not added again to this total.

Additional checks: `node --check` passed for all six changed JavaScript files; `git diff --check` and the source-change allowlist passed. Phase 1 scripts/manifests/safety tests, workflows, dependency manifests/lockfiles and `AGENTS.md` have no diff. Independent source/test review found no blocking issue. No frontend/native build or browser/device test was run because no app/build source changed; those are not implied by this API verdict. No hosted smoke, deployment, migration or live backup/restore command was run. The backup/restore integration test executed only within the runner's owned fixtures as part of the full DB lane.

Changed source is limited to three small backend fixes, three existing test files and this acceptance document. No secrets, generated database data, caches, build artifacts or live fixture IDs are included. Commit/push identifiers are reported separately; no PR, merge or deployment is performed.

### Exact recommended Phase 2C task

**AQABA SEAGO — Phase 2C: Read-only pilot inventory reconciliation and isolated browser/check-in acceptance.**

Start from the then-authorized remote staging SHA on a fresh branch. Obtain separately authorized redacted read-only inventory/personnel evidence to reconcile the six pilot trips, provider approval/suspension, fares/commission, sellable schedules/capacity and Aladdin hold. Avoid departure/quote GET routes that can perform cleanup writes. Exercise Customer/Provider browser flows and scanner UX against a local API backed only by Phase 1 disposable fixtures; arrange explicit physical-device evidence separately. Record operator recovery/support ownership and any remaining scanner-context decision. No Production contact, Staging mutations, real payments/delivery, deployment, merge or PR without separate instructions.
