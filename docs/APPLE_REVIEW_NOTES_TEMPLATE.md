# Aqaba SeaGo — App Review Notes Template

Use this only after the exact TestFlight build has passed physical-device acceptance.

## Review account

Provide a permanent reviewer account using email/password authentication. Do not require SMS OTP, a time-limited code, or Google Sign-In.

- Email: `<APP_REVIEW_EMAIL>`
- Password: `<APP_REVIEW_PASSWORD>`

## What the app does

Aqaba SeaGo is a marketplace for booking real-world marine trips and experiences in Aqaba, Jordan. Customers browse trips, choose a scheduled departure and guest count, complete payment using the configured external payment provider for the real-world service, receive a confirmed booking and QR ticket, and can manage eligible cancellations from the app.

## Suggested review path

1. Sign in with the review account.
2. Open the featured review trip: `<TRIP_NAME>`.
3. Choose the future departure: `<DATE/TIME>`.
4. Select guests and continue to checkout.
5. Complete the configured review-safe payment flow using: `<PAYMENT_TEST/REVIEW INSTRUCTIONS>`.
6. Return to Aqaba SeaGo and open Tickets.
7. Verify the confirmed booking and QR ticket.
8. Open Profile → Personal details to see the in-app account deletion control.

## Notes for Apple

- The booked product is a real-world marine trip consumed outside the app; Apple In-App Purchase is not used for the trip price.
- Native iOS Google Sign-In is intentionally not offered in this release. Email/password authentication is available.
- Native iOS push notifications are intentionally disabled in this first release and are not required to use the app.
- The Customer app displays the QR ticket; it does not scan QR codes and therefore does not request camera/photo-library permission.
- Production API: `https://aqaba-seago-api.onrender.com`.

Do not submit until placeholders above are replaced and the referenced trip/departure remain sellable throughout the expected review window.