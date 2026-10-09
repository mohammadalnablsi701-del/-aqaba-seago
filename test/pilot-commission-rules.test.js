import test from "node:test";
import assert from "node:assert/strict";
import { commissionMatchesApprovedPlan, isFunNSunProviderName, resolveFunNSunCommissionPlan } from "../src/services/pilotCommissionRules.js";

test("Fun N Sun pilot commissions remain locked to approved fixed-per-person values",()=>{
  assert.equal(isFunNSunProviderName("Fun N Sun"),true);
  const swim=resolveFunNSunCommissionPlan("White Prince Swimming Cruise");
  assert.deepEqual(swim,{
    commissionType:"fixed_per_person",
    commissionValue:3,
    adultCommission:3,
    childCommission:2,
    buffetAdultCommission:5,
    buffetChildCommission:3
  });
  assert.equal(commissionMatchesApprovedPlan({...swim},swim),true);
  assert.equal(commissionMatchesApprovedPlan({commissionType:"percentage",commissionValue:20},swim),false);
  assert.equal(commissionMatchesApprovedPlan({...swim,buffetAdultCommission:4},swim),false);

  const evening=resolveFunNSunCommissionPlan("White Prince Evening Cruise");
  const coral=resolveFunNSunCommissionPlan("Coral Whisper + White Prince Experience");
  assert.equal(evening.commissionType,"fixed_per_person");
  assert.equal(evening.commissionValue,5);
  assert.equal(coral.commissionType,"fixed_per_person");
  assert.equal(coral.commissionValue,5);
});
