import test from "node:test";
import assert from "node:assert/strict";
import { SEA_BREEZE_PILOT_TRIP, isSeaBreezeSunsetCandidate } from "../src/services/realPilotData.js";

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

test("Sea Breeze pilot spec preserves approved vessel, prices and commissions",()=>{
  assert.equal(SEA_BREEZE_PILOT_TRIP.vesselName,"بريز الخشبي");
  assert.equal(SEA_BREEZE_PILOT_TRIP.durationMinutes,120);
  assert.equal(SEA_BREEZE_PILOT_TRIP.departureLocation.name,"Ayla Marina");
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.adultPrice,15);
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.childPrice,10);
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.buffetAdultPrice,17);
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.buffetChildPrice,12);
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.commissionType,"fixed_per_person");
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.adultCommission,3);
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.childCommission,2);
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.buffetAdultCommission,3);
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.buffetChildCommission,2);
});
