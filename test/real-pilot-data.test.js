import test from "node:test";
import assert from "node:assert/strict";
import { isSeaBreezeSunsetCandidate } from "../src/services/realPilotData.js";

test("matches the approved Sea Breeze sunset pilot trip",()=>{
  assert.equal(isSeaBreezeSunsetCandidate({
    providerName:"Sea Breeze / Aquamarina",
    trip:{
      titleEn:"Sunset Cruise",
      titleAr:"رحلة غروب",
      category:"sunset",
      durationMinutes:120,
      departureLocation:{name:"Ayla Marina"}
    }
  }),true);
});

test("rejects similar trips that are not the exact pilot shape",()=>{
  assert.equal(isSeaBreezeSunsetCandidate({
    providerName:"Sea Breeze / Aquamarina",
    trip:{
      titleEn:"Sunset Cruise",
      category:"sunset",
      durationMinutes:180,
      departureLocation:{name:"Ayla Marina"}
    }
  }),false);

  assert.equal(isSeaBreezeSunsetCandidate({
    providerName:"Another Operator",
    trip:{
      titleEn:"Sunset Cruise",
      category:"sunset",
      durationMinutes:120,
      departureLocation:{name:"Ayla Marina"}
    }
  }),false);
});
