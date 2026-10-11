import test from "node:test";
import assert from "node:assert/strict";
import { InvalidCommissionConfiguration, validateCommissionConfig } from "../src/services/commission.js";
import { calculatePricing, calculateTieredPricing } from "../src/services/pricing.js";
import { publicErrorResponse, productionErrorMetadata } from "../src/utils/errorLogging.js";
import Trip from "../src/models/Trip.js";

const basePricing={
  currency:"JOD",pricePerPerson:20,adultPrice:20,childPrice:10,
  buffetEnabled:true,buffetAdultPrice:25,buffetChildPrice:15
};

function invalidConfig(config){
  assert.throws(
    ()=>validateCommissionConfig(config),
    error=>error instanceof InvalidCommissionConfiguration&&error.code==="financial_config_invalid"
  );
}

test("valid commission configurations calculate deterministically",()=>{
  assert.equal(calculateTieredPricing({pricing:{...basePricing,commissionType:"percentage",commissionValue:10},adults:2,children:1}).commissionAmount,5);
  assert.equal(calculateTieredPricing({pricing:{...basePricing,commissionType:"fixed_per_booking",commissionValue:7},adults:2,children:1}).commissionAmount,7);
  assert.equal(calculateTieredPricing({pricing:{...basePricing,commissionType:"fixed_per_person",commissionValue:3},adults:2,children:1}).commissionAmount,9);
  assert.equal(calculateTieredPricing({pricing:{...basePricing,commissionType:"fixed_per_person",commissionValue:3,adultCommission:3,childCommission:2,buffetAdultCommission:5,buffetChildCommission:3},adults:2,children:1,mealPlan:"with_buffet"}).commissionAmount,13);
});

test("explicit zero is valid but missing or malformed values fail closed",()=>{
  assert.deepEqual(validateCommissionConfig({commissionType:"percentage",commissionValue:0}),{commissionType:"percentage",commissionValue:0});
  assert.equal(calculatePricing({pricePerPerson:20,seats:2,commissionType:"percentage",commissionValue:0}).commissionAmount,0);
  assert.equal(calculatePricing({pricePerPerson:20,seats:2,commissionType:"fixed_per_booking",commissionValue:0}).commissionAmount,0);
  assert.equal(calculateTieredPricing({pricing:{...basePricing,commissionType:"fixed_per_person",commissionValue:0},adults:1,children:1}).commissionAmount,0);
  for(const config of[
    null,undefined,{},[],
    {commissionType:"foo",commissionValue:0},
    {commissionType:"percentage"},
    {commissionType:"percentage",commissionValue:null},
    {commissionType:"percentage",commissionValue:undefined},
    {commissionType:"percentage",commissionValue:NaN},
    {commissionType:"percentage",commissionValue:Infinity},
    {commissionType:"percentage",commissionValue:"0"},
    {commissionType:"percentage",commissionValue:"bad"},
    {commissionType:"percentage",commissionValue:-1},
    {commissionType:"percentage",commissionValue:100.01},
    {commissionType:"fixed_per_booking"},
    {commissionType:"fixed_per_booking",commissionValue:"5"},
    {commissionType:"fixed_per_booking",commissionValue:-1},
    {commissionType:"fixed_per_person",commissionValue:3,adultCommission:3},
    {commissionType:"fixed_per_person",commissionValue:3,adultCommission:3,childCommission:2,buffetAdultCommission:4},
    {commissionType:"fixed_per_person",commissionValue:3,buffetAdultCommission:4,buffetChildCommission:2}
  ])invalidConfig(config);
});

test("missing persisted commission type is not silently defaulted by Mongoose",()=>{
  const trip=new Trip({pricing:{pricePerPerson:20,commissionValue:0}});
  assert.equal(trip.pricing.commissionType,undefined);
  assert.throws(
    ()=>calculateTieredPricing({pricing:trip.pricing,adults:1,children:0}),
    error=>error instanceof InvalidCommissionConfiguration&&error.code==="financial_config_invalid"
  );
});

test("tier fallback is intentional only from complete overrides to complete base tiers",()=>{
  const config={commissionType:"fixed_per_person",commissionValue:3,adultCommission:4,childCommission:2};
  const withoutBuffet=calculateTieredPricing({pricing:{...basePricing,...config},adults:1,children:1});
  const withBuffet=calculateTieredPricing({pricing:{...basePricing,...config},adults:1,children:1,mealPlan:"with_buffet"});
  assert.equal(withoutBuffet.commissionAmount,6);
  assert.equal(withBuffet.commissionAmount,6);
});

test("commission is capped at gross and gross/commission/net remain internally consistent",()=>{
  const result=calculatePricing({pricePerPerson:3,seats:1,commissionType:"fixed_per_booking",commissionValue:10});
  assert.deepEqual(result,{currency:"JOD",unitPrice:3,grossAmount:3,commissionAmount:3,providerNetAmount:0});
  assert.equal(result.grossAmount,result.commissionAmount+result.providerNetAmount);
});

test("financial configuration errors expose safe customer text and structured code only",()=>{
  const error=new InvalidCommissionConfiguration("Commission value is required");
  assert.deepEqual(publicErrorResponse(error),{statusCode:503,error:"Unable to complete booking right now"});
  const metadata=productionErrorMetadata(error);
  assert.equal(metadata.code,"financial_config_invalid");
  assert.equal(metadata.errorName,"InvalidCommissionConfiguration");
  assert.equal(JSON.stringify(metadata).includes("Commission value is required"),false);
});
