# Phase 2C — Isolated browser and check-in acceptance

## Baseline and scope

- Repository: `mohammadalnablsi701-del/-aqaba-seago`.
- Authoritative staging baseline: `a5059d005929a9a99bdc591359bdcda0d67bffae`.
- Working branch: `codex/phase2c-browser-checkin-acceptance`.
- Baseline verification: **PASS**. GitHub `ls-remote --symref origin HEAD refs/heads/main refs/heads/staging` reported default `main`, main `186ed735fd5220450695fba381886bc6118819fc` and staging exactly `a5059d005929a9a99bdc591359bdcda0d67bffae`. The working branch starts at that staging commit; existing uncommitted Phase 2C work was preserved when execution resumed. `AGENTS.md` exists at the baseline and was read before changes.
- Phase 1, Phase 2A and Phase 2B were supplied as PASS. This document records Phase 2C evidence separately.
- Scope: Customer and Provider browser behavior against a local API and synthetic, Phase 1-owned disposable MongoDB fixtures. Backend acceptance from Phase 2B alone does not establish browser acceptance.

Result vocabulary: **PASS** requires executed evidence; **PARTIAL** identifies demonstrated behavior with gaps; **BLOCKED** identifies a dependency preventing acceptance; **FAIL** identifies an executed unmet assertion.

## Supplied read-only Staging inventory evidence

The following evidence was supplied with the task. Phase 2C does not repeat Atlas discovery, contact a deployed API or verify these records independently.

| Area | Supplied evidence |
| --- | --- |
| Provider | Fun N Sun — approved |
| Provider | Sea Breeze / Aquamarina — approved |
| Provider | Aladdin Yachts & Marine Tours / Alaa Aldeen — approved |
| Trips | Exactly six trips exist |
| Aladdin 8 | `active=true`, `platformStatus=allowed`, `commissionType=percentage`, `commissionValue=20` |
| Sukar | `active=true`, `platformStatus=allowed`, `commissionType=percentage`, `commissionValue=20` |
| Only reported departure | Trip `70cc00000000000000000004`; `2026-10-16T06:00:00Z`; capacity 2; reserved 0; scheduled; `salesClosed=false` |
| ProviderMember | Count 0 |

**STAGING PILOT INVENTORY — BLOCKED — INVENTORY NOT PILOT READY.**

The only supplied departure is historical, and no future sellable departure was established. The supplied Aladdin approval and both active/allowed Aladdin trips conflict with the intended hold/suspension safeguard. Zero ProviderMember records also leave staff assignments unestablished; provider-owner behavior is a separate capability.

The intended business state cannot be inferred from these records. Business/operator authorization is required before any remediation of providers, trips, commission, prices, departures or memberships. This task must not activate, suspend or otherwise modify Aladdin or any live inventory. The supplied live trip ID appears only in this evidence section and must not become a runtime fixture.

## Safety boundary and local architecture

- Read `AGENTS.md` before changes; preserve Phase 1 authority, environment scrubbing, connection and cleanup guards, ownership verification, reserved-name protection and test manifests.
- Database-dependent execution uses only the approved Phase 1 runner and its owned `MongoMemoryReplSet`. No direct DB test invocation, external MongoDB/Atlas URI or existing `.env` startup is permitted.
- The local harness imports application routes without starting `src/server.js`. Its API, Customer and Provider listeners bind only to `127.0.0.1`/localhost.
- Synthetic providers, customers, trips and future departures are created inside the disposable fixture. Payments use the mock provider with local secrets. External email, FCM, web push, SMS and other delivery must remain disabled or safely stubbed.
- Browser driver: `playwright-core` 1.64.1 with system Chromium 154. This is browser automation, not physical-camera evidence.
- The frontend build script uses Node 22.23.3, Vite `envDir: false`, local build artifacts for Customer/Provider, and the same-origin `/__local_api` prefix. Artifacts and generated database data must not be committed.
- The approved DB manifest includes the new browser acceptance entry, bringing that lane to 31 files. Phase 1 policy, authority, connection guards, cleanup guards, ownership verification and environment allowlisting were not changed. Safety-test manifest counts were updated without removing assertions.
- No Production contact, deployed Staging flow, Staging mutation, deployment, merge or PR is within scope. In particular, deployed departure/quote GET routes are excluded because they can release expired holds.

Executed isolation and external-request evidence: **PASS** in the browser run. A single random-port listener binds `127.0.0.1`, mounts the real `createApp()` under `/__local_api` and serves both local frontend artifacts. Node HTTP fetches reject any other origin and redirects. Browser contexts block service workers and abort every nonlocal request before delivery. Existing decorative font/image origins are separately recorded as blocked; unexpected business origins fail the test. The final assertions observed zero unexpected external origins, zero browser page exceptions, mock-only Payment records and `FCM_ENABLED=false`. Runner scrubbing excludes live credentials, and the harness supplies fresh local signing secrets plus local mock return URLs. No deployed API, Atlas, Production or real delivery service was used.

Synthetic fixtures are `Phase2C Test Customer`, `Phase2C Test Owner`, `Phase2C Test Other Owner`, `Phase2C Test Company`, `Phase2C Test Other Company`, `Phase2C Test Browser Cruise` and `Phase2C Synthetic Pier`. IDs are newly allocated by the disposable database; emails use `example.invalid`. The scheduled departure is generated 72 hours ahead with capacity 10. One adult plus one child costs 25 JOD without buffet or 29 JOD with buffet; trusted commission is 5 JOD and provider net is 24 JOD. These values are synthetic acceptance inputs, not decisions about pilot business prices.

## Source-traced Customer flow

`customer-app/src/App.jsx` implements Home trip cards, trip details and future-departure selection, Booking passenger steppers and meal selection, quote display, checkout handoff, payment return verification and tickets. `customer-app/src/api.js` selects the API using `VITE_API_BASE_URL` and sends passenger/departure/meal selections without authoritative client financial fields. Auth uses `localStorage.seago_auth`; checkout requires a customer phone number.

The browser path is trip card → **Continue with selected time** → adult/child controls and **Add open buffet** → **Continue to secure payment** → **Test payment ready** → **Pay securely** → local mock gateway **Pay now** → verified confirmation → **Open my ticket**. `src/routes/mockPayments.js` supplies the mock gateway and signed completion path. Its `FRONTEND_BASE_URL` must be explicitly local to prevent its deployed fallback from being used.

Tickets display the populated provider business name and a signed token QR through `QRCodeSVG`. Departure-map links exist where location information is supplied; their targets can be inspected without external navigation. `customer-app/src/ticketsRefresh.js` refreshes ready tickets while visible and on foreground events; used tickets should lose their QR and display the used state.

| Customer browser assertion | Executed result / evidence |
| --- | --- |
| Home shows synthetic sellable trip; details open | PASS — actual UI login, Home card and detail navigation |
| Synthetic future departure visible and selectable | PASS — detail selection continues to the selected booking departure |
| Adult/child quantities update correctly | PASS — steppers reach zero, then one adult plus one child |
| Buffet selection updates the authoritative quote | PASS — server quote changes from 25.00 to 29.00 JOD |
| Invalid input and manipulated totals cannot override the server | PASS for tested cases — zero passengers disables checkout without a hold; browser-origin financial override POST is rejected with 400; changing displayed DOM total to 0.01 still produces a 29.00 JOD pending payment. Broader malformed payload coverage remains in Phase 2B API tests |
| Checkout reaches local mock gateway | PASS — real handoff, gateway and Pay now controls |
| Booking remains unconfirmed before payment | PASS — zero Booking records before successful payment; pending mock Payment and two reserved seats |
| Mock success yields verified confirmed booking | PASS — gateway completion, verification return and BOOKING CONFIRMED UI; stored booking confirmed |
| Correct ticket and provider/company name appear | PASS — correct synthetic company, trip and 29.00 JOD details |
| Signed QR renders | PASS — Customer's actual SVG is fed into the Provider's real decoder |
| Used-ticket state refreshes after provider check-in | PASS — foreground/focus refresh shows USED and removes QR; no page reload required |
| Maps/location link represented where implemented | PASS — synthetic location link target inspected; no external map navigation |

## Source-traced Provider and QR/check-in flow

`provider-app/src/App.jsx` implements email/password login, dashboard/bookings, booking-detail manual check-in and the `Scanner` component. `provider-app/src/api.js` calls the real local ticket inspection and check-in endpoints. `html5-qrcode` decodes the synthetic video; neither its decoded callback nor successful API responses are substituted. The booking detail supplies trip/departure context. Scanner lookup uses the signed token rather than a separate selectable trip/departure scanner filter. No free-text token field or camera-picker interface was found in the inspected scanner; the manual alternative is booking-detail check-in. The browser cancels that manual confirmation without redeeming the booking.

| Provider/browser assertion | Executed result / evidence |
| --- | --- |
| Authorized provider reaches check-in screen | PASS — real owner login, dashboard, booking lookup and scanner navigation |
| Trip/departure context and ticket inspection work | PASS for covered context — upcoming booking detail and decoded preview show the synthetic trip; Customer departure selection is exercised. The Provider's exact displayed departure timestamp/ID is not independently asserted by this browser suite; backend relationship coverage is separate |
| Valid synthetic ticket token is accepted | PASS — signed Customer SVG decodes to VALID TICKET; explicit confirmation is required |
| Ticket changes to used | PASS — CHECKED IN success and database checkInCount exactly 1 |
| Duplicate scan is visibly rejected | PASS — ALREADY USED preview and disabled confirmation; count remains 1 |
| Wrong provider is visibly rejected | PASS — second synthetic provider sees another-provider error |
| Invalid/forged QR is visibly rejected | PASS — generated forged signature reaches visible Invalid ticket signature error |
| Scanner cancel returns to a usable screen | PASS — preview Cancel/scan-again does not redeem; Close returns to usable navigation with ended tracks |
| Scanner back navigation returns without a blank screen | PARTIAL — scanner Close provides the tested return path. Browser-history Back and Android/iOS system Back were not exercised; no distinct scanner history integration is established |

## Scanner and device evidence classification

| Evidence category | Classification | Required distinction |
| --- | --- | --- |
| BROWSER SCANNER UX | PASS for covered flows; PARTIAL for history/system Back | Real decoder, inspection, explicit redemption, used/error states and Close/Cancel exercised locally |
| Mocked camera constraints | PASS | First request `video.facingMode.exact=environment`; synthetic exact-camera failure retries `video.facingMode=environment`; microphone is not requested |
| Mocked camera selection | PARTIAL | A single synthetic rear device demonstrates preference/fallback; no camera-picker UI or multiple physical devices were tested |
| Mocked flash/torch behavior | PASS | Exposed torch capability enables Toggle flash; true request observed and false requested on Close |
| Mocked scanner cleanup | PASS | Normal Close, pending-permission Close, close/reopen before old permission resolves, and late inspection response isolation; retired tracks end, current scanner survives, and final close ends all tracks/removes retired owned hosts |
| PHYSICAL CAMERA | BLOCKED — unverified | No physical camera/device evidence is authorized by cloud automation alone |
| ANDROID DEVICE | BLOCKED — unverified | Browser results do not establish Android device readiness |
| IOS DEVICE | BLOCKED — unverified | Browser results do not establish iOS device readiness |

Mocked media APIs establish browser state transitions and cleanup only. This suite decodes actual QR pixels from a canvas-backed video using the application library; it does not synthesize scan-success callbacks. That is software-decoder evidence, not optical camera, focus, lighting, physical permission-prompt or real-phone reliability evidence. The bounded startup cleanup wait is not a guarantee for every device's media timing.

## Defects and fixes

Two Provider UI defects were reproduced through the local disposable browser harness:

1. **Late camera startup after Close.** Holding the synthetic `getUserMedia` promise, closing the scanner, then releasing permission created a stream after unmount. The original component did not stop it and the library attempted to render into removed/zero-size DOM, producing an uncaught minimum-QR-box error. An initial stop-only fix also exposed the library's unhandled interrupted `video.play()` promise. The final fix gives each scanner an owned child host, retains that host offscreen while startup settles, disposes that exact instance, stops late tracks and removes the host. Cancellation guards prevent fallback and retired inspection callbacks from updating the scanner. React's own wrapper is never moved. Regression cases prove pending-close cleanup, close/reopen generation isolation and late inspection response isolation, with no page exceptions.
2. **Distorted video crop prevents QR decoding.** The scanner requests a square `aspectRatio:1.0` stream. The measured synthetic video was intrinsically 640×640 but forced by CSS to 398×558. The library computes its source crop from the two client-dimension ratios; the captured 286×286 decoder canvas visibly squeezed the QR and repeatedly failed to decode it. Preserving intrinsic video height (`height:auto`, `object-fit:contain`) removes that distortion; centering the owned host retains the portrait scanner stage. The same Customer-rendered QR then decoded through the actual library, including repeated valid/used scans and rejection cases. The square media fixture was retained so the test does not hide the defect by changing input aspect.

The synthetic media helper was also corrected to add a standalone SVG namespace when serializing React's inline SVG, and to keep its QR quiet zone within the frame. Those were test-helper corrections, not Customer product defects. No Customer runtime change was needed.

Final local regression result: **PASS**, 11/11 reported tests, comprising ten scenario subtests and their parent. This includes cancellation during pending camera startup and pending ticket inspection, plus reopening before a retired camera request resolves.

Unrelated redesigns, business pricing changes, provider activation changes and hosted configuration changes are excluded.

## Validation and exact counts

Final repository validation used backend Node **20.20.2**, frontend build Node **22.23.3**, system Chromium **154.0.8037.57** and runner-owned MongoDB **8.2.6**. No DB-dependent file was invoked directly.

| Validation | Passed | Failed | Skipped | Execution evidence |
| --- | ---: | ---: | ---: | --- |
| `npm run test:safety` | 18 | 0 | 0 | PASS — unchanged Phase 1 guards plus updated manifest cardinality |
| `npm run test:unit` | 312 | 0 | 0 | PASS — all 49 manifest files; repeated after final runtime source changes |
| `npm run test:db` through Phase 1 runner | 237 | 0 | 0 | PASS — all 31 manifest files, including browser acceptance |
| Local browser acceptance: `npm run test:browser` | 11 | 0 | 0 | PASS — ten scenario subtests plus their parent; also included in the 237 DB tests, do not add twice |
| Customer build: `npm run test:browser:build` | — | — | — | PASS — local API artifact, env-file loading disabled |
| Provider build: same command | — | — | — | PASS — final scanner source/CSS included |
| Affected JS syntax and `git diff --check` | — | — | — | PASS — new build/helper/test modules parse; frontend JSX/CSS compiled by Vite |

The final three validation lanes report **567 passed, 0 failed, 0 skipped** in total. Standalone browser reruns are overlapping execution evidence, not additional distinct tests. Both frontend builds passed; Vite reported the existing large-chunk advisory, which is not a build failure. Hosted CI was not dispatched or claimed as executed. A dedicated browser-acceptance CI job is added for a future authorized PR; no PR is opened by this task.

Diagnostic runs during implementation were not all green. Their reported TAP counts are retained here to distinguish red reproductions from final acceptance:

| Local browser run | Passed | Failed | Skipped | Finding |
| --- | ---: | ---: | ---: | --- |
| Initial resumed Node 20 run | 4 | 5 | 0 | Inline SVG helper failure; pending camera leaked a track and raised QR-box error |
| SVG correction / red run | 5 | 4 | 0 | Actual decode still timed out; dependent scanner state remained open |
| Initial cleanup fix | 4 | 5 | 0 | Interrupted library `play()` promise; QR decode still failed |
| Owned-host cleanup | 5 | 4 | 0 | Cleanup/page-exception checks passed; QR-dependent assertions still failed |
| Decoder diagnostic | 5 | 4 | 0 | Measured square intrinsic video/portrait client dimensions and captured squeezed crop |
| Aspect-ratio fix | 9 | 0 | 0 | Real decoding and complete original browser flow passed |
| Expanded final browser run | 11 | 0 | 0 | Added reopen-before-late-permission and late-inspection isolation |

The early resumed attempt that referenced an expired temporary Node path fell back to unsupported Node 24, failed the lane and reported zero test counts. It is inconclusive infrastructure evidence and is excluded from acceptance totals. The required Node 20 runtime was restored before all reported acceptance runs. Earlier interrupted execution without a complete result is not counted as a pass.

Screenshots, decoder-crop diagnostics, synthetic signed ticket SVG, local frontend artifacts, browser/runtime caches and disposable DB files are not committed. The diff contains no secrets, live database data, hosted configuration change or runtime live IDs. No source changes were made to Customer, pricing, commission, inventory or payment rules.

## Remaining blockers and verdict

- **BLOCKED:** Staging inventory remains unsuitable for the pilot on the supplied evidence: intended Aladdin hold mismatch and no established future departure.
- **BLOCKED:** Provider-member assignments require an operator decision and separately authorized remediation; current supplied count is zero.
- **BLOCKED:** Physical camera, Android device and iOS device acceptance remain unverified.
- **PARTIAL:** Browser-history/system Back and multi-device camera selection remain unverified; the tested app return controls are Close and preview Cancel/scan-again.
- Browser implementation and local disposable acceptance verdict: **PASS** for the covered Customer purchase, Provider inspection, actual software QR decoding, check-in, rejection and scanner lifecycle flows.
- Overall Phase 2C verdict: **PARTIAL** — isolated browser acceptance passes; pilot operational readiness remains **BLOCKED** by inventory and physical-device gaps. A browser acceptance result does not authorize pilot activation or live remediation.

## Exact recommended Phase 2D

**AQABA SEAGO — Phase 2D: Operator-authorized pilot inventory remediation and physical-device QR/check-in acceptance.**

Obtain explicit business/operator decisions for Aladdin, the six-trip pilot catalog, future sellable departures and provider check-in assignments before making any live change. In a separately authorized task, reconcile those decisions and validate the selected mobile delivery channels and physical-camera scanner behavior, including permissions, rear-camera selection, repeated scans, duplicate rejection and cancel/back cleanup. Preserve the Production boundary and report operational readiness separately from mock-payment acceptance.
