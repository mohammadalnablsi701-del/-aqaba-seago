# Aqaba SeaGo — Real Pilot Data Intake

Purpose: prepare the platform with real provider, trip and departure data before licensing, real payments and public launch.

## Pilot providers

1. Fun N Sun
2. Sea Breeze / Aquamarina
3. Aladdin Yachts & Marine Tours / Alaa Aldeen

## Provider data required

For each provider collect:

- Business/display name
- Provider login email
- Mobile / WhatsApp
- Default capacity
- Default departure time when applicable
- Boarding / meeting point
- Full meeting-point address when available
- Google Maps URL
- Pilot status

Public contact details may be used provisionally for pilot preparation, but provider-confirmed onboarding details take precedence before public launch.

## Trip data required

Create one record per sellable product. Required operational fields:

- Provider
- Arabic title
- English title
- **Vessel / yacht name (`vesselName`)**
- Category
- Duration in minutes
- Adult price
- Child price when applicable
- Buffet/meal enabled
- Adult-with-meal price when applicable
- Child-with-meal price when applicable
- Buffet/meal description when applicable
- SeaGo commission type
- SeaGo commission value
- Adult commission when custom
- Child commission when custom
- Meal commissions when custom
- Departure/meeting point
- Google Maps URL
- Images
- Active status

### Vessel-name rule

`vesselName` is independent from the customer-facing trip title. Keep it as a separate field so a provider can run multiple products or vessels without embedding the vessel name into every trip title. If the exact vessel is unknown, leave it explicitly `TO CONFIRM`; do not infer it from a public fleet list.

For combined products, record the actual marine assets used. Example: `Coral Whisper + White Prince`.

Supported categories in the current system:

- group_boat
- private_boat
- yacht
- glass_bottom
- snorkeling
- diving
- fishing
- sunset
- private_event
- water_sports
- semi_submarine

Supported commission models:

- percentage
- fixed_per_person
- fixed_per_booking

## Departure schedule required

Create one row per operating slot:

- Trip
- Date
- Start time
- Capacity
- Sales open/closed
- Status: scheduled / cancelled / completed

Capacity and operating time are editable per Departure. Defaults are convenience values only and must not lock the actual daily operation.

The current data model prevents duplicate departures for the same trip at the exact same start time.

---

## Current confirmed pilot data

### 1. Fun N Sun — working data confirmed

Provider:

- Display name: Fun N Sun
- Pilot login email: info@fun-n-sun.com
- Reservations email: reservation@fun-n-sun.com
- Mobile / WhatsApp: +962 79 577 3111
- Landline: 03 2033031
- Default capacity: 20, editable per departure

Boarding points:

1. ساحة الثورة العربية / سارية العلم — Arab Revolt Plaza
   - Google Maps: https://maps.app.goo.gl/JSwRqtx6Xw95ymLD8?g_st=ic
2. مارينا أيلة — Ayla Marina
   - Google Maps: https://maps.app.goo.gl/4TGCyvHFxYtuopiz8?g_st=ic

Selected pilot products:

- FNS-01 — White Prince / Arab Revolt Plaza
  - Vessel: White Prince
  - Duration: 120 min
- FNS-02 — Coral Whisper + White Prince
  - Vessel/assets: Coral Whisper + White Prince
  - Duration: 180 min
  - Default slot: 14:00–17:00, editable per departure
- FNS-03 — White Prince / Ayla Marina
  - Vessel: White Prince
  - Duration: 120 min

Detailed confirmed prices and commissions live in `docs/FUN_N_SUN_PILOT_DATA.md`.

### 2. Sea Breeze / Aquamarina — working data confirmed / contacts provisional

Provider:

- Display name: Sea Breeze / Aquamarina
- Provisional login email: info@aquamarina-aqaba.com
- Alternate public email: info@seabreezeaqaba.com
- Public mobile: +962 79 088 7163
- Boarding point: مارينا أيلة — Ayla Marina
- Google Maps: https://maps.app.goo.gl/oDBcHhKdzih9Y2RU8?g_st=ic
- Default capacity: 10, editable per departure

Selected pilot product:

- SB-01 — Sunset Cruise
  - Vessel name: TO CONFIRM
  - Duration: 120 min
  - Operating pattern: near-daily
  - Common slots: 17:00–19:00 or 18:00–20:00, editable per departure

Detailed confirmed prices and commissions live in `docs/SEA_BREEZE_PILOT_DATA.md`.

### 3. Aladdin Yachts & Marine Tours / Alaa Aldeen — next provider

Public draft only until we process this provider:

- Draft display name: Aladdin Yachts & Marine Tours
- Public address draft: Ayla Marina – Yacht Terminal, Aqaba, Jordan
- Public mobile draft: +962 78 677 2167
- Trips, vessel names, capacity, pricing, commission and exact boarding-point data: TO PROCESS

---

## Minimum pilot dataset

Before the first full operational rehearsal target:

- 3 approved provider accounts
- At least 6 real sellable trips total
- At least 3 future departures per selected trip where operationally appropriate
- Real prices and commission values
- Real/default capacities with per-departure editability
- Vessel/yacht name captured for every marine trip where known
- Customer-facing images
- Correct meeting points and Maps links

## Data cleanup rule

Do not delete production or staging records blindly.

Before cleanup:

1. Inventory providers/users/trips/departures/bookings/tickets/payments.
2. Identify test/demo records explicitly.
3. Keep system/admin accounts and required audit/history records.
4. Delete or archive only confirmed test/demo data.
5. Re-run Staging Smoke after cleanup.

## Pilot acceptance gate

Phase 1 is complete only when each selected provider can be opened in the Provider App and shows the correct:

- company identity
- trips
- vessel/yacht names
- meeting points
- schedules
- capacities
- prices
- commissions

No licensing, real payment gateway or public launch is required for this phase.
