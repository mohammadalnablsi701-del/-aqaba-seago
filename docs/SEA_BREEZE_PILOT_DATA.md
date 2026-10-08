# Sea Breeze / Aquamarina — Pilot Data

Status: confirmed working trip/pricing data for pilot preparation. Publicly listed provider contact details are adopted provisionally for the pilot until provider onboarding confirms them directly. Boarding point and default capacity are confirmed for pilot use; customer-facing images and the exact sunset-cruise vessel name still need confirmation.

## Provider

- Display name: Sea Breeze / Aquamarina
- Pilot status: planned
- Provisional provider login email from current public listings: info@aquamarina-aqaba.com
- Alternate public contact email: info@seabreezeaqaba.com
- Public phone/mobile: +962 79 088 7163
- WhatsApp: not assumed from the phone listing; confirm with provider before marking as WhatsApp-enabled
- Public address: Prs. Haya Cir., Aqaba, Jordan
- Public website: www.seabreezeaqaba.com
- Boarding / meeting point: مارينا أيلة — Ayla Marina
- Google Maps: https://maps.app.goo.gl/oDBcHhKdzih9Y2RU8?g_st=ic
- Default capacity: 10
- Capacity rule: 10 is the default only; each departure capacity remains editable.
- Contact-data rule: these details are acceptable for pilot setup, but replace them with provider-confirmed onboarding details before public launch if the provider supplies different contact information.

---

## SB-01 — Sunset Cruise

- Arabic title: رحلة غروب — Sea Breeze / Aquamarina
- English title: Sunset Cruise — Sea Breeze / Aquamarina
- Vessel name: TO CONFIRM
- Vessel-name rule: do not infer the sunset-cruise vessel from public fleet lists because the provider publishes multiple boat/yacht names and the current public booking page does not identify which one operates this specific sunset product.
- Category: sunset
- Duration: 120 minutes
- Operating pattern: near-daily / شبه يومية
- Common operating slots:
  - 17:00–19:00
  - 18:00–20:00
- Time rule: departure time is not fixed at trip level; use an editable start/end time per Departure because the provider may operate either common slot depending on the day/season.
- Boarding / meeting point: مارينا أيلة — Ayla Marina
- Google Maps: https://maps.app.goo.gl/oDBcHhKdzih9Y2RU8?g_st=ic
- Buffet/meal option: enabled
- Commission model: fixed_per_person
- Default capacity: 10, editable per departure

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

1. Confirm the exact vessel/yacht name used for the Sunset Cruise.
2. Collect customer-facing images.
3. Confirm whether the published mobile is also the preferred WhatsApp number.
4. Create future departures using either 17:00–19:00 or 18:00–20:00 as appropriate for the day.
