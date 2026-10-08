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

These are public-source drafts only. Do not treat them as signed/confirmed provider onboarding data unless marked CONFIRMED below.

### Fun N Sun — CONFIRMED FOR PILOT SETUP

- Display name: Fun N Sun
- Public office address: Aqaba office, 2nd area, Islamic International Arab Bank Building, 3rd floor, Aqaba, Jordan
- Provider login email currently reserved for pilot setup: info@fun-n-sun.com
- Reservations email supplied in current operating material: reservation@fun-n-sun.com
- Provider login mobile / reservations mobile & WhatsApp: +962 79 577 3111
- Public landline supplied in current operating material: 03 2033031
- Additional public WhatsApp from earlier public-source draft: +962 79 882 8802
- Provider status for pilot: approved
- Publicly listed services include tourist boat cruises, snorkeling, fishing, night trips, diving and water sports.
- Confirmed boarding points:
  1. ساحة الثورة العربية — Arab Revolt Plaza / Flagpole area
  2. مارينا أيلة — Ayla Marina
- Terminology confirmation: "سارية العلم" in Fun N Sun operating messages means the boarding point at ساحة الثورة العربية.
- Boarding-point rule: do not force one provider-level default. Assign the correct boarding point on each trip because Fun N Sun operates from two confirmed locations.
- Google Maps URLs: add per boarding point when confirmed/collected.

#### Fun N Sun — observed operating offers (sample dated 7 October 2026)

Use these as real product/price references. The supplied date is historical relative to the current pilot-preparation work, so do not create these exact dates as future departures.

**Trip template FNS-01 — White Prince / Arab Revolt Plaza**

- Arabic title: رحلة White Prince
- English title: White Prince Cruise
- Recommended category: group_boat
- Duration: 120 minutes
- Observed time: 14:00–16:00
- Observed price: 15 JOD per person
- Boarding point: ساحة الثورة العربية / سارية العلم
- Included/notes: swimming program and water slide
- Family-only restriction: not stated in this offer
- Capacity: TO CONFIRM
- Child price/policy: TO CONFIRM
- SeaGo commission: TO CONFIRM
- Images: TO COLLECT

**Trip template FNS-02 — Coral Whisper & White Prince / Arab Revolt Plaza**

- Arabic title: رحلة Coral Whisper & White Prince
- English title: Coral Whisper & White Prince Cruise
- Recommended category: group_boat (combined marine product; review later if a dedicated combo type is needed)
- Duration: 180 minutes
- Supplied time text: `5:00-2:00`
- Working interpretation for pilot data: 14:00–17:00 because that matches the stated 3-hour duration; requires provider confirmation before creating future departures
- Observed price: 25 JOD per person
- Boarding point: ساحة الثورة العربية / سارية العلم
- Restriction/notes: families
- Capacity: TO CONFIRM
- Child price/policy: TO CONFIRM
- SeaGo commission: TO CONFIRM
- Images: TO COLLECT

**Trip template FNS-03 — White Prince / Ayla Marina**

- Arabic title: رحلة White Prince — أيلة
- English title: White Prince Cruise — Ayla Marina
- Recommended category: group_boat
- Duration: 120 minutes
- Observed time: 18:00–20:00
- Observed price: 20 JOD per person
- Boarding point: مارينا أيلة
- Restriction/notes: families
- Capacity: TO CONFIRM
- Child price/policy: TO CONFIRM
- SeaGo commission: TO CONFIRM
- Images: TO COLLECT

**Trip template FNS-04 — Rio Diving Club diving slots**

- Arabic title: غطس — Rio Diving Club
- English title: Rio Diving Club Diving
- Recommended category: diving
- Observed departure times: 10:30, 12:30, 14:30
- Price: TO CONFIRM
- Duration: TO CONFIRM
- Boarding/meeting point: TO CONFIRM
- Capacity: TO CONFIRM
- Child/minimum-age policy: TO CONFIRM
- SeaGo commission: TO CONFIRM
- Images: TO COLLECT

#### Fun N Sun — current data-model decision

The current Trip model stores price and departure location on the trip, while Departure stores date/time/capacity/status. Because White Prince has different prices and boarding points for different operating products, keep FNS-01 and FNS-03 as separate Trip records instead of one shared trip with different departures. This avoids incorrect price/location combinations during booking.

## Sea Breeze / Aquamarina

- Draft display name: Aquamarina & Sea Breeze Company
- Public address draft: Prs. Haya Cir., Aqaba, Jordan
- Public mobile draft: +962 79 088 7163
- Public categories include boat tours/cruises, diving and water sports.
- Pilot provider login email: TO CONFIRM
- Pilot provider login mobile: TO CONFIRM
- Meeting/boarding point: TO CONFIRM WITH PROVIDER

## Aladdin Yachts & Marine Tours / Alaa Aldeen

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
