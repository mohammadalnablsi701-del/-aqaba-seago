# Aqaba SeaGo

Commission-based booking platform for marine trips, boats, yachts and sea activities in Aqaba, Jordan.

## Backend v0.2
Implemented: JWT auth/roles, provider approval, trips, departures/capacity, server-side pricing and commission, temporary seat holds, atomic seat reservation, idempotent booking creation, cancellation/expiry seat release, pricing tests.

Pending: payment gateway/webhooks, customer app, provider app, admin dashboard, production notifications/media/deployment.

## Run
```bash
cp .env.example .env
npm install
npm test
npm run dev
```
