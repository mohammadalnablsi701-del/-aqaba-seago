import test from "node:test";
import assert from "node:assert/strict";
import { buildCommissionUpdate } from "../src/routes/adminCommission.js";

test("legacy percentage editor cannot convert fixed per-person commission",()=>{
  assert.throws(()=>buildCommissionUpdate({commissionType:"fixed_per_person",commissionValue:3,adultCommission:3,childCommission:2},{percentage:20}),error=>error.statusCode===409);
});

test("fixed per-person tiered commission can be updated without changing type",()=>{
  assert.deepEqual(buildCommissionUpdate({commissionType:"fixed_per_person",commissionValue:3,adultCommission:3,childCommission:2},{commissionType:"fixed_per_person",commissionValue:3,adultCommission:3,childCommission:2,buffetAdultCommission:5,buffetChildCommission:3}),{
    commissionType:"fixed_per_person",commissionValue:3,adultCommission:3,childCommission:2,buffetAdultCommission:5,buffetChildCommission:3
  });
});

test("commission type changes require explicit confirmation",()=>{
  assert.throws(()=>buildCommissionUpdate({commissionType:"percentage",commissionValue:20},{commissionType:"fixed_per_person",commissionValue:5}),error=>error.statusCode===409);
  assert.equal(buildCommissionUpdate({commissionType:"percentage",commissionValue:20},{commissionType:"fixed_per_booking",commissionValue:5,confirmTypeChange:true}).commissionType,"fixed_per_booking");
});
