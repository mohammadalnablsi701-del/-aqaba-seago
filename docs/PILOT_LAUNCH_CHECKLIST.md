# Aqaba SeaGo — Pilot Launch Checklist

This checklist is for the first controlled pilot with real provider/trip/departure data while the real payment gateway remains deferred.

## 1. Environment gate

Before using real pilot data:

- `PUBLIC_LAUNCH=false`
- `SEED_DEMO_DATA=false`
- `PAYMENT_PROVIDER=mock`
- `ENABLE_MOCK_CHECKOUT=true` only while intentionally running the controlled pilot checkout flow
- Use a strong unique `JWT_SECRET`
- Use a strong unique `MOCK_PAYMENT_WEBHOOK_SECRET`
- Set `MONGODB_URI` to the intended pilot database
- Set `PUBLIC_BASE_URL` to the deployed API URL
- Set `ALLOWED_ORIGINS` to the deployed customer/provider/admin origins
- Set `FRONTEND_BASE_URL` to the deployed customer app URL used after mock checkout

Do not set `PUBLIC_LAUNCH=true` until the real payment gateway is configured. The backend intentionally refuses to start public launch with mock payments.

## 2. Remove demo inventory

In Admin > Pilot readiness:

1. Confirm Demo seed is false.
2. Review the Demo cleanup preview.
3. Confirm demo booking count is zero.
4. Confirm demo checkout hold count is zero.
5. Type the exact cleanup phrase.
6. Run guarded demo cleanup.
7. Refresh readiness and verify no demo provider/trips remain.

Do not delete demo inventory manually from MongoDB unless recovery work requires it.

## 3. Create the first real provider

1. Register the provider account.
2. Create the provider profile with the real business name and phone.
3. Approve the provider from Admin.
4. Sign in to Provider app again.
5. Verify the app shows APPROVED PROVIDER.
6. Verify another provider cannot access this provider's trips, bookings, manifests or tickets.

## 4. Create one real pilot trip

Keep the first pilot narrow:

- One approved provider
- One active trip
- One departure
- Small controlled capacity

Verify:

- Arabic and English title
- Category
- Duration
- Adult price
- Child price
- Buffet option/prices if used
- Departure point
- Google Maps URL
- Real trip photos
- SeaGo commission in Admin

After saving, verify the trip appears in the customer app.

## 5. Create the first departure

Create a departure at least five minutes in the future and verify:

- Correct date/time
- Correct capacity
- Status = scheduled
- Available seats = capacity before any hold
- Departure appears to customers

Operational rules already enforced:

- Capacity cannot be reduced below reserved seats.
- Time cannot be changed while seats are reserved.
- Cancelled/completed departures cannot be reactivated.
- A future departure cannot be marked completed.
- Cancelling a departure releases active checkout holds and cancels pending mock payments.

## 6. Run the customer checkout pilot

Use a real pilot customer account.

1. Open the real trip.
2. Select the departure.
3. Request a quote.
4. Verify adult/child/package totals.
5. Start checkout.
6. Confirm the seat hold reduces available capacity.
7. Complete payment through the mock checkout.
8. Verify the booking becomes confirmed.
9. Verify the customer sees the booking and ticket.
10. Verify the provider sees the booking in the correct date/manifest.
11. Verify Admin counts update.

Important safeguards already enforced:

- Seat reservation is atomic to reduce overselling.
- Reusing an idempotency key for a different request is rejected.
- Checkout is blocked if provider approval or trip availability changes.
- A payment webhook cannot confirm a cancelled/past/unavailable departure.
- Expired holds release seats.

## 7. QR and check-in test

1. Open the confirmed customer ticket.
2. Scan it from the correct Provider app.
3. Verify the preview shows the expected provider, trip, customer and guest count.
4. Confirm check-in.
5. Scan the same ticket again and verify it is rejected as already used.
6. Try the ticket from a different provider account and verify access is denied.

Check-in is accepted only for a confirmed booking on a scheduled departure.

## 8. Cancellation test

Before inviting external pilot customers, run one controlled cancellation test.

Customer cancellation:
- Confirm the applicable refund percentage.
- Cancel once.
- Verify seats are released.
- Verify the provider manifest no longer shows the cancelled booking.
- Verify Admin cancellation/refund data is correct.

Provider departure cancellation:
- Create a fresh controlled booking/hold.
- Cancel the departure.
- Verify active holds are released.
- Verify confirmed bookings are cancelled with full-refund handling.
- Verify the cancelled departure cannot be reactivated.

## 9. Admin readiness gate

Admin > Pilot readiness must show:

Required:
- At least one approved provider
- At least one active trip belonging to an approved provider
- At least one upcoming scheduled departure for approved active inventory
- Demo seeding disabled
- No demo provider/trips remaining

Deferred:
- Real payment gateway configured

The real payment gateway remains deferred for this controlled pilot and must not be interpreted as public-launch readiness.

## Email delivery

Email is not required for the controlled pilot because in-app notifications remain available, but production email delivery is not ready while Resend uses the default testing sender/domain.

Before public launch:
- Verify a real sending domain in Resend.
- Set `EMAIL_FROM` to an address on that verified domain.
- Confirm booking confirmation and cancellation emails reach a non-owner test address.

## 10. Final go/no-go before inviting pilot users

Proceed with the controlled pilot only when:

- CI is green for backend tests and all three app builds.
- Admin shows Pilot ready.
- One full checkout has completed successfully.
- One QR check-in has completed successfully.
- Seat counts match before and after checkout/cancellation.
- Provider ownership boundaries have been verified.
- Demo data has been removed.
- Pilot environment variables have been reviewed.

Keep the first pilot limited to a small known group. Do not set `PUBLIC_LAUNCH=true` yet.
