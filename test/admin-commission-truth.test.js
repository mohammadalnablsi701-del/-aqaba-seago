import test from "node:test";
import assert from "node:assert/strict";
import Trip from "../src/models/Trip.js";
import Provider from "../src/models/Provider.js";
import ProviderAuditLog from "../src/models/ProviderAuditLog.js";
import tripRoutes from "../src/routes/trips.js";
import { buildCommissionUpdate } from "../src/routes/adminCommission.js";
import { FUN_N_SUN_COMMISSION_PLAN } from "../src/services/pilotCommissionRules.js";
import { SEA_BREEZE_FIXED_PRICING } from "../src/services/seaBreezeCorrection.js";
import { commissionDisplay, parseCommissionPercentageInput } from "../admin-app/src/commissionDisplay.js";

const userId="aaaaaaaaaaaaaaaaaaaaaaaa";
const providerId="bbbbbbbbbbbbbbbbbbbbbbbb";
const tripId="cccccccccccccccccccccccc";

function query(value){return{select(){return this;},populate(){return this;},sort(){return this;},limit(){return this;},then(resolve,reject){return Promise.resolve(value).then(resolve,reject);}};}
async function callProviderTripPatch(body){
  const route=tripRoutes.stack.find(layer=>layer.route?.path==="/:tripId"&&layer.route.methods.patch).route;
  let result,status=200,error;
  const req={body,params:{tripId},user:{_id:userId,role:"provider"},protocol:"https",get:()=>"test.invalid"};
  const res={status(code){status=code;return this;},json(value){result=value;return this;}};
  await route.stack.at(-1).handle(req,res,err=>{error=err;});
  if(error)throw error;
  return{status,result};
}

test("A) percentage displays the configured percentage",()=>{
  const view=commissionDisplay({currency:"JOD",commissionType:"percentage",commissionValue:12.5});
  assert.equal(view.status,"configured");
  assert.equal(view.summary,"12.5% of total booking");
  assert.equal(parseCommissionPercentageInput("0"),0);
});

test("B) fixed_per_booking displays the configured JOD amount per booking",()=>{
  const view=commissionDisplay({currency:"JOD",commissionType:"fixed_per_booking",commissionValue:5});
  assert.equal(view.status,"configured");
  assert.equal(view.summary,"5.00 JOD per booking");
});

test("C) basic fixed_per_person displays JOD per guest",()=>{
  const view=commissionDisplay({currency:"JOD",commissionType:"fixed_per_person",commissionValue:3});
  assert.equal(view.status,"configured");
  assert.equal(view.summary,"3.00 JOD per guest");
});

test("D) different adult and child fixed commissions display separately",()=>{
  const view=commissionDisplay({currency:"JOD",commissionType:"fixed_per_person",commissionValue:3,adultCommission:3,childCommission:2});
  assert.deepEqual(view.lines,[{label:"Adult",value:"3.00 JOD"},{label:"Child",value:"2.00 JOD"}]);
});

test("E) buffet tiers display their actual configured values",()=>{
  const view=commissionDisplay({currency:"JOD",commissionType:"fixed_per_person",commissionValue:3,adultCommission:3,childCommission:2,buffetAdultCommission:5,buffetChildCommission:3});
  assert.deepEqual(view.lines,[
    {label:"Adult",value:"3.00 JOD"},{label:"Child",value:"2.00 JOD"},
    {label:"Adult + buffet",value:"5.00 JOD"},{label:"Child + buffet",value:"3.00 JOD"}
  ]);
});

test("F) missing values never fall back to 20 percent or zero",()=>{
  for(const pricing of [
    {commissionType:"percentage"},
    {commissionType:"fixed_per_booking",commissionValue:null},
    {commissionType:"fixed_per_person",commissionValue:3,adultCommission:3},
    null,undefined,{}
  ]){
    const view=commissionDisplay(pricing);
    assert.equal(view.status,"not_configured");
    assert.equal(view.summary,"Commission not configured");
    assert.ok(!JSON.stringify(view).includes("20%"));
  }
  assert.equal(parseCommissionPercentageInput(""),null);
});

test("G) unknown commission type reports unsupported without inventing an amount",()=>{
  const view=commissionDisplay({commissionType:"legacy_magic",commissionValue:999});
  assert.equal(view.status,"unsupported");
  assert.equal(view.summary,"Unsupported commission type");
  assert.equal(view.value,null);
  assert.deepEqual(view.lines,[]);
});

test("H) percentage mutation remains blocked for a fixed commission agreement",()=>{
  assert.throws(
    ()=>buildCommissionUpdate({commissionType:"fixed_per_person",commissionValue:3,adultCommission:3,childCommission:2},{percentage:20}),
    error=>error.statusCode===409
  );
});

test("I) Provider trip update cannot mutate commission fields",async t=>{
  const trip=Trip.hydrate({_id:tripId,providerId,titleEn:"Protected commission",titleAr:"عمولة محمية",category:"yacht",durationMinutes:120,active:true,pricing:{currency:"JOD",pricePerPerson:15,adultPrice:15,childPrice:10,commissionType:"fixed_per_person",commissionValue:3,adultCommission:3,childCommission:2}});
  t.mock.method(Provider,"findOne",()=>query({_id:providerId,ownerUserId:userId,status:"approved"}));
  t.mock.method(Trip,"findOne",async()=>trip);
  t.mock.method(trip,"save",async()=>trip);
  t.mock.method(ProviderAuditLog,"create",async()=>({}));
  const response=await callProviderTripPatch({pricing:{adultPrice:17,commissionType:"percentage",commissionValue:99,adultCommission:99,childCommission:99}});
  assert.equal(response.status,200);
  assert.equal(trip.pricing.adultPrice,17);
  assert.equal(trip.pricing.commissionType,"fixed_per_person");
  assert.equal(trip.pricing.commissionValue,3);
  assert.equal(trip.pricing.adultCommission,3);
  assert.equal(trip.pricing.childCommission,2);
});

test("J) display logic does not mutate historical booking pricing snapshots",()=>{
  const currentTripPricing={currency:"JOD",commissionType:"percentage",commissionValue:20};
  const historicalBookingPricing={currency:"JOD",grossAmount:50,commissionAmount:10,providerNetAmount:40};
  const snapshot=structuredClone(historicalBookingPricing);
  commissionDisplay(currentTripPricing);
  currentTripPricing.commissionValue=25;
  assert.deepEqual(historicalBookingPricing,snapshot);
});

test("Fun N Sun fixture renders fixed per-person truth without a percentage fallback",()=>{
  const plan=FUN_N_SUN_COMMISSION_PLAN["White Prince Swimming Cruise"];
  const view=commissionDisplay({currency:"JOD",...plan});
  assert.equal(view.type,"fixed_per_person");
  assert.equal(view.lines.find(x=>x.label==="Adult")?.value,`${Number(plan.adultCommission).toFixed(2)} JOD`);
  assert.equal(view.lines.find(x=>x.label==="Child")?.value,`${Number(plan.childCommission).toFixed(2)} JOD`);
  assert.ok(!JSON.stringify(view).includes("20%"));
});

test("Sea Breeze fixture renders adult, child and buffet commission tiers from the contract",()=>{
  const view=commissionDisplay(SEA_BREEZE_FIXED_PRICING);
  assert.equal(view.type,"fixed_per_person");
  assert.equal(view.lines.find(x=>x.label==="Adult")?.value,`${Number(SEA_BREEZE_FIXED_PRICING.adultCommission).toFixed(2)} JOD`);
  assert.equal(view.lines.find(x=>x.label==="Child")?.value,`${Number(SEA_BREEZE_FIXED_PRICING.childCommission).toFixed(2)} JOD`);
  assert.equal(view.lines.find(x=>x.label==="Adult + buffet")?.value,`${Number(SEA_BREEZE_FIXED_PRICING.buffetAdultCommission).toFixed(2)} JOD`);
  assert.equal(view.lines.find(x=>x.label==="Child + buffet")?.value,`${Number(SEA_BREEZE_FIXED_PRICING.buffetChildCommission).toFixed(2)} JOD`);
});
