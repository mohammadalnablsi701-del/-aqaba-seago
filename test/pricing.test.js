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

test("20 percent commission is calculated from the full booking gross",()=>{
  const pricing={currency:"JOD",pricePerPerson:14,adultPrice:14,childPrice:8,buffetEnabled:true,buffetAdultPrice:17,buffetChildPrice:10,commissionType:"percentage",commissionValue:20};
  assert.deepEqual(calculateTieredPricing({pricing,adults:2,children:1,mealPlan:"with_buffet"}),{currency:"JOD",unitPrice:17,adultUnitPrice:17,childUnitPrice:10,adultSubtotal:34,childSubtotal:10,grossAmount:44,commissionAmount:8.8,providerNetAmount:35.2});
});

test("tiered pricing rejects malformed meal selections rather than choosing a different package",()=>{
  const pricing={pricePerPerson:15,commissionType:"fixed_per_person",commissionValue:3};
  for(const mealPlan of ["with-buffet","",null,true,{}]){
    assert.throws(()=>calculateTieredPricing({pricing,adults:1,children:0,mealPlan}),/Invalid mealPlan/);
  }
});

test("selected enabled buffet requires both stored buffet prices instead of substituting base rates",()=>{
  const configured={pricePerPerson:15,adultPrice:15,childPrice:10,buffetEnabled:true,buffetAdultPrice:17,buffetChildPrice:12,commissionType:"fixed_per_person",commissionValue:3};
  for(const missing of ["buffetAdultPrice","buffetChildPrice"]){
    for(const value of [undefined,null]){
      const pricing={...configured,[missing]:value};
      assert.throws(()=>calculateTieredPricing({pricing,adults:1,children:1,mealPlan:"with_buffet"}),/Buffet prices are required/);
    }
  }
});

test("selected buffet rejects negative stored prices and preserves legitimate free child pricing",()=>{
  const configured={pricePerPerson:15,adultPrice:15,childPrice:10,buffetEnabled:true,buffetAdultPrice:17,buffetChildPrice:12,commissionType:"fixed_per_person",commissionValue:3};
  assert.throws(()=>calculateTieredPricing({pricing:{...configured,buffetAdultPrice:-1},adults:1,children:1,mealPlan:"with_buffet"}),/Invalid adult price/);
  assert.throws(()=>calculateTieredPricing({pricing:{...configured,buffetChildPrice:-1},adults:1,children:1,mealPlan:"with_buffet"}),/Invalid child price/);
  const freeChild=calculateTieredPricing({pricing:{...configured,buffetChildPrice:0},adults:1,children:1,mealPlan:"with_buffet"});
  assert.equal(freeChild.childUnitPrice,0);
  assert.equal(freeChild.grossAmount,17);
});

test("non-buffet legacy price fallback remains available without buffet prices",()=>{
  const pricing={pricePerPerson:15,commissionType:"fixed_per_person",commissionValue:3};
  const result=calculateTieredPricing({pricing,adults:1,children:1});
  assert.equal(result.adultUnitPrice,15);
  assert.equal(result.childUnitPrice,15);
  assert.equal(result.grossAmount,30);
});
