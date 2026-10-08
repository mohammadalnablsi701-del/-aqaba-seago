# Sea Breeze / Aquamarina — Pilot Data

Status: confirmed working trip/pricing data for pilot preparation. Provider contact/account details, boarding point, capacity and customer-facing images still need confirmation.

## Provider

- Display name: Sea Breeze / Aquamarina
- Pilot status: planned
- Provider login email: pending confirmation
- Provider mobile / WhatsApp: pending confirmation
- Boarding / meeting point: pending confirmation
- Default capacity: pending confirmation

---

## SB-01 — Sunset Cruise

- Arabic title: رحلة غروب — Sea Breeze / Aquamarina
- English title: Sunset Cruise — Sea Breeze / Aquamarina
- Category: sunset
- Duration: 120 minutes
- Operating pattern: near-daily / شبه يومية
- Common operating slots:
  - 17:00–19:00
  - 18:00–20:00
- Time rule: departure time is not fixed at trip level; use an editable start/end time per Departure because the provider may operate either common slot depending on the day/season.
- Buffet/meal option: enabled
- Commission model: fixed_per_person
- Capacity: pending confirmation

### Customer pricing / SeaGo commission

| Guest | Meal plan | Sale price | SeaGo commission | Provider net |
|---|---|---:|---:|---:|
| Adult | With meal | 17 JOD | 3 JOD | 14 JOD |
| Adult | Without meal | 15 JOD | 3 JOD | 12 JOD |
| Child | With meal | 12 JOD | 2 JOD | 10 JOD |
| Child | Without meal | 10 JOD | 2 JOD | 8 JOD |

Suggested Trip.pricing fields:

```json
{
  "currency": "JOD",
  "pricePerPerson": 15,
  "adultPrice": 15,
  "childPrice": 10,
  "buffetEnabled": true,
  "buffetAdultPrice": 17,
  "buffetChildPrice": 12,
  "commissionType": "fixed_per_person",
  "commissionValue": 3,
  "adultCommission": 3,
  "childCommission": 2,
  "buffetAdultCommission": 3,
  "buffetChildCommission": 2
}
```

## Remaining Sea Breeze / Aquamarina data required before actual pilot entry

1. Confirm provider login email and mobile/WhatsApp.
2. Confirm boarding/meeting point and Google Maps link.
3. Confirm default/actual capacity.
4. Collect customer-facing images.
5. Create future departures using either 17:00–19:00 or 18:00–20:00 as appropriate for the day.
