# Fun N Sun — Pilot Data

Status: confirmed working data for pilot preparation. Do not create public/live departures from historical sample dates.

## Provider

- Display name: Fun N Sun
- Pilot status: approved
- Login email: info@fun-n-sun.com
- Reservations email: reservation@fun-n-sun.com
- Mobile / WhatsApp: +962 79 577 3111
- Landline: 03 2033031
- Default capacity: 20
- Capacity rule: 20 is the default only; each departure capacity remains editable.

## Boarding points

1. ساحة الثورة العربية — Arab Revolt Plaza / Flagpole area
   - Google Maps: https://maps.app.goo.gl/JSwRqtx6Xw95ymLD8?g_st=ic
2. مارينا أيلة — Ayla Marina
   - Google Maps: pending confirmation

Terminology: `سارية العلم` in Fun N Sun operating material means the Arab Revolt Plaza / flagpole boarding point.

---

## FNS-01 — White Prince / Arab Revolt Plaza

- Arabic title: رحلة White Prince
- English title: White Prince Cruise
- Category: group_boat
- Duration: 120 minutes
- Observed operating slot: 14:00–16:00
- Boarding point: ساحة الثورة العربية / سارية العلم
- Google Maps: https://maps.app.goo.gl/JSwRqtx6Xw95ymLD8?g_st=ic
- Includes: swimming program + water slide
- Default capacity: 20, editable per departure
- Buffet/meal option: enabled
- Commission model: fixed_per_person

### Customer pricing / SeaGo commission

| Guest | Meal plan | Sale price | SeaGo commission | Provider net |
|---|---|---:|---:|---:|
| Adult | With meal | 15 JOD | 4 JOD | 11 JOD |
| Child | With meal | 12 JOD | 2 JOD | 10 JOD |
| Child | Without meal | 8 JOD | 2 JOD | 6 JOD |
| Adult | Without meal | 12 JOD | 4 JOD | 8 JOD |

Pricing note: the source table previously showed 16 JOD for the adult-with-meal sale price. The current confirmed sale price is 15 JOD. All other sale prices remain unchanged. For pilot setup, adult commission remains 4 JOD and child commission remains 2 JOD, so adult-with-meal provider net becomes 11 JOD.

Suggested Trip.pricing fields:

```json
{
  "currency": "JOD",
  "pricePerPerson": 12,
  "adultPrice": 12,
  "childPrice": 8,
  "buffetEnabled": true,
  "buffetAdultPrice": 15,
  "buffetChildPrice": 12,
  "commissionType": "fixed_per_person",
  "commissionValue": 4,
  "adultCommission": 4,
  "childCommission": 2,
  "buffetAdultCommission": 4,
  "buffetChildCommission": 2
}
```

---

## FNS-02 — Coral Whisper + White Prince

This is one combined product: submarine/Coral Whisper experience + White Prince yacht/boat experience.

- Arabic title: رحلة الغواصة Coral Whisper + White Prince
- English title: Coral Whisper + White Prince
- Category: semi_submarine
- Duration: 180 minutes
- Default operating slot for pilot setup: 14:00–17:00
- Time rule: 14:00–17:00 is the default only; the start/end time must remain editable per departure because the provider may change the slot by day.
- Boarding point: ساحة الثورة العربية / سارية العلم
- Google Maps: https://maps.app.goo.gl/JSwRqtx6Xw95ymLD8?g_st=ic
- Family-oriented offer
- Default capacity: 20, editable per departure
- Buffet/meal option: enabled
- Commission model: fixed_per_person

### Customer pricing / SeaGo commission

| Guest | Meal plan | Sale price | SeaGo commission | Provider net |
|---|---|---:|---:|---:|
| Adult | With meal | 25 JOD | 5 JOD | 20 JOD |
| Adult | Without meal | 20 JOD | 5 JOD | 15 JOD |
| Child | With meal | 15 JOD | 2 JOD | 13 JOD |
| Child | Without meal | 10 JOD | 2 JOD | 8 JOD |

Suggested Trip.pricing fields:

```json
{
  "currency": "JOD",
  "pricePerPerson": 20,
  "adultPrice": 20,
  "childPrice": 10,
  "buffetEnabled": true,
  "buffetAdultPrice": 25,
  "buffetChildPrice": 15,
  "commissionType": "fixed_per_person",
  "commissionValue": 5,
  "adultCommission": 5,
  "childCommission": 2,
  "buffetAdultCommission": 5,
  "buffetChildCommission": 2
}
```

---

## FNS-03 — White Prince / Ayla Marina

- Arabic title: رحلة White Prince — أيلة
- English title: White Prince Cruise — Ayla Marina
- Category: group_boat
- Duration: 120 minutes
- Observed operating slot: 18:00–20:00
- Boarding point: مارينا أيلة
- Google Maps: pending confirmation
- Default capacity: 20, editable per departure
- Family-oriented offer
- Buffet/meal option: enabled
- Commission model: fixed_per_person

### Customer pricing / SeaGo commission

| Guest | Meal plan | Sale price | SeaGo commission | Provider net |
|---|---|---:|---:|---:|
| Adult | With meal | 20 JOD | 5 JOD | 15 JOD |
| Adult | Without meal | 15 JOD | 3 JOD | 12 JOD |
| Child | Without meal | 10 JOD | 2 JOD | 8 JOD |
| Child | With meal | 15 JOD | 3 JOD | 12 JOD |

Suggested Trip.pricing fields:

```json
{
  "currency": "JOD",
  "pricePerPerson": 15,
  "adultPrice": 15,
  "childPrice": 10,
  "buffetEnabled": true,
  "buffetAdultPrice": 20,
  "buffetChildPrice": 15,
  "commissionType": "fixed_per_person",
  "commissionValue": 3,
  "adultCommission": 3,
  "childCommission": 2,
  "buffetAdultCommission": 5,
  "buffetChildCommission": 3
}
```

---

## FNS-04 — Rio Diving Club

- Arabic title: غطس — Rio Diving Club
- English title: Rio Diving Club Diving
- Category: diving
- Observed slots: 10:30, 12:30, 14:30
- Default capacity: 20 only as provider default; actual diving slot capacity must be confirmed before use
- Price: pending confirmation
- Duration: pending confirmation
- Meeting point: pending confirmation
- Minimum-age / child policy: pending confirmation
- SeaGo commission: pending confirmation

---

## Remaining Fun N Sun data required before actual pilot entry

1. Confirm Rio Diving Club price, duration, actual capacity, age rules, meeting point and commission.
2. Collect customer-facing images for each product.
3. Add Google Maps link for Ayla Marina.
4. Create only future departures; historical sample dates remain reference data only.
