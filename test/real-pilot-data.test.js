import test from "node:test";
import assert from "node:assert/strict";
import { FUN_N_SUN_VESSEL, SEA_BREEZE_PILOT_TRIP, SEA_BREEZE_PROVIDER_DEFAULTS, resolveSeaBreezeDefaultDepartureTime, isSeaBreezeSunsetCandidate } from "../src/services/realPilotData.js";

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

test("Sea Breeze pilot spec preserves approved vessel, prices and fixed commissions",()=>{
  assert.equal(SEA_BREEZE_PILOT_TRIP.vesselName,"Breeze Wooden Boat");
  assert.equal(SEA_BREEZE_PILOT_TRIP.durationMinutes,120);
  assert.equal(SEA_BREEZE_PILOT_TRIP.departureLocation.name,"Ayla Marina");
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.adultPrice,15);
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.childPrice,10);
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.buffetAdultPrice,17);
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.buffetChildPrice,12);
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.commissionType,"fixed_per_person");
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.commissionValue,3);
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.adultCommission,3);
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.childCommission,2);
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.buffetAdultCommission,3);
  assert.equal(SEA_BREEZE_PILOT_TRIP.pricing.buffetChildCommission,2);
});

test("Sea Breeze provider defaults preserve capacity and Ayla departure point",()=>{
  assert.equal(SEA_BREEZE_PROVIDER_DEFAULTS.defaultCapacity,10);
  assert.equal(SEA_BREEZE_PROVIDER_DEFAULTS.defaultDepartureTime,"17:00");
  assert.equal(SEA_BREEZE_PROVIDER_DEFAULTS.departureLocation.name,"Ayla Marina");
  assert.equal(SEA_BREEZE_PROVIDER_DEFAULTS.departureLocation.googleMapsUrl,"https://maps.app.goo.gl/oDBcHhKdzih9Y2RU8?g_st=ic");
});

test("default departure time upgrades only missing or untouched generic defaults",()=>{
  assert.equal(resolveSeaBreezeDefaultDepartureTime(""),"17:00");
  assert.equal(resolveSeaBreezeDefaultDepartureTime("09:00"),"17:00");
  assert.equal(resolveSeaBreezeDefaultDepartureTime("18:00"),"18:00");
});

test("Fun N Sun pilot vessel is the approved White Prince across all three trips",()=>{
  assert.equal(FUN_N_SUN_VESSEL,"White Prince");
});
