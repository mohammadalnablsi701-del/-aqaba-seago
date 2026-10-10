# Provider Staging QA Checklist

Run this checklist after the `staging` branch CI, Render auto-deploy, and `Staging Smoke` are green, and before opening the promotion PR to `main`.

- [ ] Login page opens at the Provider staging URL.
- [ ] Network/API target is `https://aqaba-seago-api-staging.onrender.com`.
- [ ] Home shell renders without a white screen.
- [ ] Trips page renders.
- [ ] Bookings page renders.
- [ ] Passenger Manifest opens.
- [ ] QR screen opens.
- [ ] No duplicated UI controls are visible.
- [ ] No fatal console/runtime error appears.
- [ ] Mobile viewport remains usable.

Do not create or modify Providers, Trips, Departures, Bookings, Tickets, Pricing, Commission, Payment, or Maintenance Mode for this checklist. Authenticated E2E data belongs in a separate test-data task.
