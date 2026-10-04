import test from "node:test";
import assert from "node:assert/strict";
import { FUN_N_SUN_TRIPS } from "../src/services/funNSunCatalogSeed.js";

test("Fun N Sun catalog contains the three approved programs", () => {
  assert.equal(FUN_N_SUN_TRIPS.length, 3);
  assert.deepEqual(
    FUN_N_SUN_TRIPS.map(t => [t.titleEn, t.durationMinutes, t.pricing.pricePerPerson, t.pricing.commissionValue]),
    [
      ["White Prince Swimming Cruise", 120, 15, 3],
      ["White Prince Evening Cruise", 120, 20, 5],
      ["Coral Whisper + White Prince Experience", 180, 25, 5]
    ]
  );
});

test("Fun N Sun catalog uses fixed per-person commission", () => {
  for (const trip of FUN_N_SUN_TRIPS) {
    assert.equal(trip.pricing.currency, "JOD");
    assert.equal(trip.pricing.commissionType, "fixed_per_person");
    assert.equal(trip.active, true);
  }
});
