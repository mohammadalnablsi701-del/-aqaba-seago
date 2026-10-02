import test from "node:test";import assert from "node:assert/strict";import{calculatePricing}from"../src/services/pricing.js";
test("fixed per person",()=>assert.deepEqual(calculatePricing({pricePerPerson:20,seats:3,commissionType:"fixed_per_person",commissionValue:4}),{currency:"JOD",unitPrice:20,grossAmount:60,commissionAmount:12,providerNetAmount:48}));
test("percentage",()=>assert.equal(calculatePricing({pricePerPerson:25,seats:2,commissionType:"percentage",commissionValue:10}).commissionAmount,5));
test("fixed per booking",()=>assert.equal(calculatePricing({pricePerPerson:15,seats:4,commissionType:"fixed_per_booking",commissionValue:7}).providerNetAmount,53));
test("cap commission at gross",()=>assert.equal(calculatePricing({pricePerPerson:3,seats:1,commissionType:"fixed_per_booking",commissionValue:10}).commissionAmount,3));
test("invalid seats",()=>assert.throws(()=>calculatePricing({pricePerPerson:20,seats:0,commissionType:"fixed_per_person",commissionValue:4})));
