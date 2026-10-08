# Aqaba SeaGo — Real Pilot Data Intake

Purpose: prepare the platform with real provider/trip/departure data before licensing, real payments, and public launch.

## Pilot providers

Start with these three anchor providers:

1. Fun N Sun
2. Sea Breeze / Aquamarina
3. Aladdin Yachts & Marine Tours / Alaa Aldeen

For each provider collect:

- Business name exactly as it should appear to customers
- Owner/primary contact name
- Provider login email
- Provider mobile/WhatsApp number
- Default capacity
- Default departure time
- Main departure/meeting point name
- Full meeting-point address
- Google Maps URL
- Provider status for pilot: approved

## Public draft provider details — confirm before data entry

These are public-source drafts only. Do not treat them as signed/confirmed provider onboarding data.

### Fun N Sun

- Draft display name: Fun N Sun
- Public office address: Aqaba office, 2nd area, Islamic International Arab Bank Building, 3rd floor, Aqaba, Jordan
- Public mobile: +962 79 577 3111
- Public WhatsApp: +962 79 882 8802
- Public email: info@fun-n-sun.com
- Publicly listed services include tourist boat cruises, snorkeling, fishing, night trips, diving and water sports.
- Pilot provider login email: TO CONFIRM
- Pilot provider login mobile: TO CONFIRM
- Meeting/boarding point: TO CONFIRM WITH PROVIDER (office address is not assumed to be boarding point)

### Sea Breeze / Aquamarina

- Draft display name: Aquamarina & Sea Breeze Company
- Public address draft: Prs. Haya Cir., Aqaba, Jordan
- Public mobile draft: +962 79 088 7163
- Public categories include boat tours/cruises, diving and water sports.
- Pilot provider login email: TO CONFIRM
- Pilot provider login mobile: TO CONFIRM
- Meeting/boarding point: TO CONFIRM WITH PROVIDER

### Aladdin Yachts & Marine Tours / Alaa Aldeen

- Draft display name: Aladdin Yachts & Marine Tours
- Public address draft: Ayla Marina – Yacht Terminal, Aqaba 77110, Jordan
- Public mobile draft: +962 78 677 2167
- Public category: boat tour agency / yacht and marine tours.
- Pilot provider login email: TO CONFIRM
- Pilot provider login mobile: TO CONFIRM
- Meeting/boarding point: TO CONFIRM WITH PROVIDER

## Trip data required

Create one row per sellable trip/product.

Required fields:

- Provider
- Arabic title
- English title
- Category
- Duration in minutes
- Base/price-per-person in JOD
- Adult price if different
- Child price if applicable
- Buffet enabled: yes/no
- Buffet adult price if applicable
- Buffet child price if applicable
- Buffet description if applicable
- SeaGo commission type
- SeaGo commission value
- Adult commission if custom
- Child commission if custom
- Buffet commission if applicable
- Departure/meeting point
- Images
- Active: yes/no

Supported categories in the current system:

- Group boat
- Private boat
- Yacht
- Glass bottom
- Snorkeling
- Diving
- Fishing
- Sunset
- Private event
- Water sports
- Semi-submarine

Supported commission models:

- Percentage
- Fixed per person
- Fixed per booking

## Departure schedule required

Create one row per departure slot.

- Trip
- Date
- Start time
- Capacity
- Sales open/closed
- Status: scheduled/cancelled/completed

Important: the current data model prevents duplicate departures for the same trip at the exact same start time.

## Minimum pilot dataset

Before the first real operational rehearsal, each of the three anchor providers should have:

- 1 approved provider account
- Complete contact/meeting-point settings
- At least 2 real trips
- At least 3 future departures per trip
- Real prices and commission values
- Real capacities
- Real customer-facing images

Target minimum for the first full pilot simulation:

- 3 providers
- 6 trips
- 18 future departures

## Data cleanup rule

Do not delete production or staging records blindly.

Before cleanup:

1. Inventory all providers/users/trips/departures/bookings/tickets/payments currently present.
2. Identify test/demo records explicitly.
3. Keep system/admin accounts and anything required for audit/history.
4. Delete or archive only confirmed test/demo records.
5. Re-run Staging Smoke after cleanup.

## Pilot acceptance gate

Phase 1 is complete only when the three anchor providers can be opened in the Provider App and each shows correct:

- company identity
- meeting point
- trips
- schedules
- capacities
- prices
- commissions

No licensing, real payment gateway, or public launch is required for this phase.
