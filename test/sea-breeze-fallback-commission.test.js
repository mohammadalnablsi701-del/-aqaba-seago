import test from "node:test";
import assert from "node:assert/strict";
import { SEA_BREEZE_PILOT_TRIP } from "../src/services/realPilotData.js";

test("Sea Breeze fallback trip uses the approved fixed per-person commissions",()=>{
  assert.deepEqual({
    commissionType:SEA_BREEZE_PILOT_TRIP.pricing.commissionType,
    commissionValue:SEA_BREEZE_PILOT_TRIP.pricing.commissionValue,
    adultCommission:SEA_BREEZE_PILOT_TRIP.pricing.adultCommission,
    childCommission:SEA_BREEZE_PILOT_TRIP.pricing.childCommission,
    buffetAdultCommission:SEA_BREEZE_PILOT_TRIP.pricing.buffetAdultCommission,
    buffetChildCommission:SEA_BREEZE_PILOT_TRIP.pricing.buffetChildCommission
  },{
    commissionType:"fixed_per_person",
    commissionValue:3,
    adultCommission:3,
    childCommission:2,
    buffetAdultCommission:3,
    buffetChildCommission:2
  });
});
