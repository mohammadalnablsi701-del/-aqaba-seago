import test from "node:test";
import assert from "node:assert/strict";
import { calculateTieredPricing } from "../src/services/pricing.js";
import { SEA_BREEZE_FIXED_PRICING } from "../src/services/seaBreezeCorrection.js";

test("Sea Breeze correction preserves approved prices and fixed commissions",()=>{
  const p=SEA_BREEZE_FIXED_PRICING;
  assert.equal(p.adultPrice,15);
  assert.equal(p.childPrice,10);
  assert.equal(p.buffetAdultPrice,17);
  assert.equal(p.buffetChildPrice,12);
  assert.equal(p.commissionType,"fixed_per_person");
  assert.equal(p.adultCommission,3);
  assert.equal(p.childCommission,2);
  assert.equal(p.buffetAdultCommission,3);
  assert.equal(p.buffetChildCommission,2);
});

test("Sea Breeze commissions remain 3/2 JOD with and without buffet",()=>{
  const withoutBuffet=calculateTieredPricing({pricing:SEA_BREEZE_FIXED_PRICING,adults:1,children:1,mealPlan:"without_buffet"});
  assert.equal(withoutBuffet.grossAmount,25);
  assert.equal(withoutBuffet.commissionAmount,5);
  assert.equal(withoutBuffet.providerNetAmount,20);

  const withBuffet=calculateTieredPricing({pricing:SEA_BREEZE_FIXED_PRICING,adults:1,children:1,mealPlan:"with_buffet"});
  assert.equal(withBuffet.grossAmount,29);
  assert.equal(withBuffet.commissionAmount,5);
  assert.equal(withBuffet.providerNetAmount,24);
});
