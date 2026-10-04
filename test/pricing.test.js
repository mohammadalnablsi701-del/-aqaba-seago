import test from "node:test";import assert from "node:assert/strict";import{calculatePricing,calculateTieredPricing}from"../src/services/pricing.js";
test("fixed per person",()=>assert.deepEqual(calculatePricing({pricePerPerson:20,seats:3,commissionType:"fixed_per_person",commissionValue:4}),{currency:"JOD",unitPrice:20,grossAmount:60,commissionAmount:12,providerNetAmount:48}));
test("percentage",()=>assert.equal(calculatePricing({pricePerPerson:25,seats:2,commissionType:"percentage",commissionValue:10}).commissionAmount,5));
test("fixed per booking",()=>assert.equal(calculatePricing({pricePerPerson:15,seats:4,commissionType:"fixed_per_booking",commissionValue:7}).providerNetAmount,53));
test("cap commission at gross",()=>assert.equal(calculatePricing({pricePerPerson:3,seats:1,commissionType:"fixed_per_booking",commissionValue:10}).commissionAmount,3));
test("invalid seats",()=>assert.throws(()=>calculatePricing({pricePerPerson:20,seats:0,commissionType:"fixed_per_person",commissionValue:4})));

test("tiered fixed commissions support meal and age variants",()=>{
  const pricing={currency:"JOD",pricePerPerson:15,adultPrice:15,childPrice:10,buffetEnabled:true,buffetAdultPrice:20,buffetChildPrice:15,commissionType:"fixed_per_person",commissionValue:3,adultCommission:3,childCommission:2,buffetAdultCommission:5,buffetChildCommission:3};
  assert.deepEqual(calculateTieredPricing({pricing,adults:1,children:1,mealPlan:"without_buffet"}),{currency:"JOD",unitPrice:15,adultUnitPrice:15,childUnitPrice:10,adultSubtotal:15,childSubtotal:10,grossAmount:25,commissionAmount:5,providerNetAmount:20});
  assert.deepEqual(calculateTieredPricing({pricing,adults:1,children:1,mealPlan:"with_buffet"}),{currency:"JOD",unitPrice:20,adultUnitPrice:20,childUnitPrice:15,adultSubtotal:20,childSubtotal:15,grossAmount:35,commissionAmount:8,providerNetAmount:27});
});
