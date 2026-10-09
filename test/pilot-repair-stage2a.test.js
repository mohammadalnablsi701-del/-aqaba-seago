import test from "node:test";
import assert from "node:assert/strict";
import { expectedFunNSunCommissionForBooking, isAllowedFunNSunPreRepairCommission, isExpectedFunNSunCommission, resolveFunNSunPlan } from "../src/services/pilotRepairStage2a.js";

test("Fun N Sun approved commission plans are fixed per person",()=>{
  const swim=resolveFunNSunPlan("White Prince Swimming Cruise");
  assert.equal(swim.commissionType,"fixed_per_person");
  assert.equal(swim.adultCommission,3);
  assert.equal(swim.childCommission,2);
  assert.equal(swim.buffetAdultCommission,5);
  assert.equal(swim.buffetChildCommission,3);
  assert.equal(resolveFunNSunPlan("White Prince Evening Cruise").commissionValue,5);
  assert.equal(resolveFunNSunPlan("Coral Whisper + White Prince Experience").commissionValue,5);
});

test("historical expected commissions use approved per-person values",()=>{
  assert.equal(expectedFunNSunCommissionForBooking({titleEn:"White Prince Swimming Cruise",booking:{adults:2,children:1,seats:3,mealPlan:"without_buffet",pricing:{grossAmount:40}}}),8);
  assert.equal(expectedFunNSunCommissionForBooking({titleEn:"White Prince Swimming Cruise",booking:{adults:2,children:1,seats:3,mealPlan:"with_buffet",pricing:{grossAmount:52}}}),13);
  assert.equal(expectedFunNSunCommissionForBooking({titleEn:"White Prince Evening Cruise",booking:{adults:2,children:1,seats:3,mealPlan:"without_buffet",pricing:{grossAmount:60}}}),15);
});

test("pre-repair state accepts legacy 20 percent only as a repairable state",()=>{
  const plan=resolveFunNSunPlan("White Prince Evening Cruise");
  assert.equal(isAllowedFunNSunPreRepairCommission({commissionType:"percentage",commissionValue:20},plan),true);
  assert.equal(isExpectedFunNSunCommission({commissionType:"percentage",commissionValue:20},plan),false);
  assert.equal(isAllowedFunNSunPreRepairCommission({commissionType:"percentage",commissionValue:17},plan),false);
});
