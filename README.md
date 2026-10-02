# Aqaba SeaGo

Commission-based booking platform for marine trips, boats, yachts and sea activities in Aqaba, Jordan.

## Current backend milestone — v0.3

Implemented:
- JWT authentication and roles: customer, provider, admin.
- Provider profile creation and admin approval.
- Provider-owned trips.
- Scheduled departures with capacity tracking.
- Server-side pricing and SeaGo commission calculation.
- Temporary seat holds for pending bookings.
- Atomic capacity reservation to reduce overselling risk.
- Idempotent booking creation using `Idempotency-Key`.
- Cancellation and expiry flow that releases held seats.
- Payment abstraction that is not tied to one gateway.
- Separate `Payment` model linked one-to-one with a booking.
- Checkout creation for payable bookings.
- Signed raw-body webhooks.
- Webhook event idempotency.
- Amount and currency verification before confirming a booking.
- Booking confirmation only after a valid successful payment event.
- Late/invalid successful payments are marked `needs_review` instead of silently confirming.
- Mock payment provider and local completion route for development.
- Pricing and mock provider tests.

## Payment flow

1. Customer creates a booking. The booking starts as `pending_payment` and holds seats temporarily.
2. Customer calls `POST /api/payments/checkout` with the booking ID.
3. Backend creates/reuses a payment record and returns a checkout URL.
4. Payment provider sends a signed webhook to:
   `POST /api/payments/webhooks/:provider`
5. Backend verifies the signature, amount, currency, payment state, booking state and seat-hold validity.
6. Only then is the booking changed to `confirmed`.

For development with `PAYMENT_PROVIDER=mock`, complete a payment by calling:
`POST /api/mock-payments/:paymentId/complete`

The mock route is disabled when `NODE_ENV=production`.

## Core routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/providers`
- `PATCH /api/admin/providers/:providerId/approve`
- `POST /api/trips`
- `POST /api/departures`
- `GET /api/departures/:departureId/quote?seats=2`
- `POST /api/bookings` with `Idempotency-Key`
- `POST /api/bookings/:bookingId/cancel`
- `POST /api/payments/checkout`
- `GET /api/payments/:paymentId`
- `POST /api/payments/webhooks/:provider`
- `POST /api/mock-payments/:paymentId/complete`
- `POST /api/admin/bookings/release-expired`

## Stack

Node.js, Express, MongoDB/Mongoose.

## Run locally

```bash
cp .env.example .env
npm install
npm test
npm run dev
```

API default: `http://localhost:4000`

## Next milestone — v0.4

- Connect a real payment gateway.
- Refund/cancellation orchestration.
- Payment reconciliation/admin views.
- Scheduled expiry worker.
- Integration tests against MongoDB.
- Customer/provider/admin frontends.
