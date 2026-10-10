import test from"node:test";
import assert from"node:assert/strict";
import fs from"node:fs/promises";
import{buildCommissionUpdate}from"../src/routes/adminCommission.js";
import{calculateTieredPricing}from"../src/services/pricing.js";
import{commissionDisplay}from"../admin-app/src/commissionDisplay.js";
import{
  COMMISSION_TYPE_OPTIONS,changeCommissionType,commissionConfirmationText,commissionDraftFromPricing,
  commissionPayloadPreview,validateCommissionDraft
}from"../admin-app/src/commissionEditorModel.js";

const tiers={commissionType:"fixed_per_person",commissionValue:3,adultCommission:3,childCommission:2,buffetAdultCommission:5,buffetChildCommission:3};
const cleared={adultCommission:null,childCommission:null,buffetAdultCommission:null,buffetChildCommission:null};

test("A/B: percentage loads and updates with decimal support",()=>{
  const draft=commissionDraftFromPricing({commissionType:"percentage",commissionValue:12.5});
  assert.equal(draft.commissionType,"percentage");assert.equal(draft.commissionValue,"12.5");
  assert.deepEqual(buildCommissionUpdate({commissionType:"percentage",commissionValue:20},{commissionType:"percentage",commissionValue:12.5}),{commissionType:"percentage",commissionValue:12.5,adultCommission:undefined,childCommission:undefined,buffetAdultCommission:undefined,buffetChildCommission:undefined});
  assert.deepEqual(validateCommissionDraft(draft),{ok:true,payload:{commissionType:"percentage",commissionValue:12.5}});
});

test("C: fixed per booking loads and updates",()=>{
  const draft=commissionDraftFromPricing({commissionType:"fixed_per_booking",commissionValue:5});
  assert.equal(draft.commissionType,"fixed_per_booking");assert.equal(draft.commissionValue,"5");
  assert.equal(validateCommissionDraft({...draft,commissionValue:"5.25"}).payload.commissionValue,5.25);
  assert.equal(buildCommissionUpdate({commissionType:"fixed_per_booking",commissionValue:5},{commissionType:"fixed_per_booking",commissionValue:6.5}).commissionValue,6.5);
});

test("D: basic fixed per guest remains a one-value contract and clears stale tiers",()=>{
  const draft=commissionDraftFromPricing({commissionType:"fixed_per_person",commissionValue:4});
  assert.equal(draft.guestStructure,"basic");
  const checked=validateCommissionDraft(draft);
  assert.deepEqual(checked,{ok:true,payload:{commissionType:"fixed_per_person",commissionValue:4,...cleared}});
  assert.deepEqual(buildCommissionUpdate(tiers,checked.payload),{commissionType:"fixed_per_person",commissionValue:4,adultCommission:undefined,childCommission:undefined,buffetAdultCommission:undefined,buffetChildCommission:undefined});
});

test("E/F: adult child and buffet tiers load and round-trip",()=>{
  const draft=commissionDraftFromPricing(tiers);
  assert.equal(draft.guestStructure,"tiered");assert.equal(draft.buffetTiers,true);
  assert.equal(draft.adultCommission,"3");assert.equal(draft.childCommission,"2");assert.equal(draft.buffetAdultCommission,"5");assert.equal(draft.buffetChildCommission,"3");
  assert.deepEqual(validateCommissionDraft(draft).payload,tiers);
  assert.deepEqual(buildCommissionUpdate(tiers,tiers),tiers);
});

test("buffet tiers can be disabled without stale values surviving checkout",()=>{
  const draft={...commissionDraftFromPricing(tiers),buffetTiers:false,buffetAdultCommission:"",buffetChildCommission:""};
  const payload=validateCommissionDraft(draft).payload;
  assert.equal(payload.buffetAdultCommission,null);assert.equal(payload.buffetChildCommission,null);
  const update=buildCommissionUpdate(tiers,payload);
  assert.equal(update.buffetAdultCommission,undefined);assert.equal(update.buffetChildCommission,undefined);
  assert.equal(update.adultCommission,3);assert.equal(update.childCommission,2);
});

test("G/H/I/J: every type change is explicit and stale fields are cleared",()=>{
  assert.throws(()=>buildCommissionUpdate({commissionType:"percentage",commissionValue:20},{commissionType:"fixed_per_person",commissionValue:3}),e=>e.statusCode===409);
  const toGuest=buildCommissionUpdate({commissionType:"percentage",commissionValue:20,adultCommission:99,childCommission:99},{commissionType:"fixed_per_person",commissionValue:3,confirmTypeChange:true});
  assert.deepEqual(toGuest,{commissionType:"fixed_per_person",commissionValue:3,adultCommission:undefined,childCommission:undefined,buffetAdultCommission:undefined,buffetChildCommission:undefined});
  const toPercentage=buildCommissionUpdate(tiers,{commissionType:"percentage",commissionValue:20,confirmTypeChange:true});
  assert.deepEqual(toPercentage,{commissionType:"percentage",commissionValue:20,adultCommission:undefined,childCommission:undefined,buffetAdultCommission:undefined,buffetChildCommission:undefined});
  assert.equal(buildCommissionUpdate({commissionType:"fixed_per_booking",commissionValue:5},{commissionType:"percentage",commissionValue:10,confirmTypeChange:true}).commissionType,"percentage");
  assert.throws(()=>buildCommissionUpdate({commissionType:"percentage",commissionValue:20},{commissionType:"fixed_per_person",confirmTypeChange:true}),/fallback commission/i);
});

test("editor type switching clears values instead of reusing another financial model",()=>{
  const draft=commissionDraftFromPricing({commissionType:"percentage",commissionValue:20});
  const fixed=changeCommissionType(draft,"fixed_per_booking");
  assert.equal(fixed.commissionType,"fixed_per_booking");assert.equal(fixed.commissionValue,"");
});

test("S/T: invalid values, malformed payloads, unexpected fields and partial tiers fail safely",()=>{
  for(const body of[
    {commissionType:"percentage",commissionValue:-1},
    {commissionType:"percentage",commissionValue:101},
    {commissionType:"percentage",commissionValue:"NaN"},
    {commissionType:"fixed_per_booking",commissionValue:Infinity},
    {commissionType:"fixed_per_booking",commissionValue:{}},
    {commissionType:"fixed_per_booking",commissionValue:[]},
    {commissionType:"fixed_per_booking",commissionValue:1.001},
    {commissionType:"fixed_per_booking",commissionValue:1,admin:true}
  ])assert.throws(()=>buildCommissionUpdate({commissionType:body.commissionType,commissionValue:1},body));
  assert.throws(()=>buildCommissionUpdate({commissionType:"fixed_per_person",commissionValue:3},{commissionType:"fixed_per_person",commissionValue:3,adultCommission:3}),/configured together/i);
  assert.throws(()=>buildCommissionUpdate({commissionType:"fixed_per_person",commissionValue:3},{commissionType:"fixed_per_person",commissionValue:3,buffetAdultCommission:4,buffetChildCommission:2}),/require adult and child/i);
  assert.equal(validateCommissionDraft({commissionType:"percentage",commissionValue:"1.001"}).ok,false);
  assert.equal(validateCommissionDraft({commissionType:"fixed_per_booking",commissionValue:"-1"}).ok,false);
});

test("U: Commission Truth remains exact for every supported and invalid state",()=>{
  assert.equal(commissionDisplay({commissionType:"percentage",commissionValue:20}).summary,"20% of total booking");
  assert.equal(commissionDisplay({commissionType:"fixed_per_booking",commissionValue:5}).summary,"5.00 JOD per booking");
  assert.equal(commissionDisplay({commissionType:"fixed_per_person",commissionValue:3}).summary,"3.00 JOD per guest");
  assert.equal(commissionDisplay(tiers).lines.find(x=>x.label==="Child + buffet").value,"3.00 JOD");
  assert.equal(commissionDisplay({commissionType:"percentage"}).summary,"Commission not configured");
  assert.equal(commissionDisplay({commissionType:"mystery",commissionValue:20}).summary,"Unsupported commission type");
});

test("financial math regression covers percentage, fixed booking, basic guest and tiered guest",()=>{
  const base={currency:"JOD",pricePerPerson:20,adultPrice:20,childPrice:10,buffetEnabled:true,buffetAdultPrice:25,buffetChildPrice:15};
  assert.equal(calculateTieredPricing({pricing:{...base,commissionType:"percentage",commissionValue:20},adults:2,children:1}).commissionAmount,10);
  assert.equal(calculateTieredPricing({pricing:{...base,commissionType:"fixed_per_booking",commissionValue:5},adults:2,children:1}).commissionAmount,5);
  assert.equal(calculateTieredPricing({pricing:{...base,commissionType:"fixed_per_person",commissionValue:3},adults:2,children:1}).commissionAmount,9);
  assert.equal(calculateTieredPricing({pricing:{...base,...tiers},adults:2,children:1,mealPlan:"without_buffet"}).commissionAmount,8);
  assert.equal(calculateTieredPricing({pricing:{...base,...tiers},adults:2,children:1,mealPlan:"with_buffet"}).commissionAmount,13);
});

test("confirmation wording is explicit and human-readable",()=>{
  assert.equal(commissionConfirmationText({commissionType:"percentage",commissionValue:20}),"20% of total booking");
  assert.equal(commissionPayloadPreview({currency:"JOD"},tiers),"3.00 JOD per adult / 2.00 JOD per child / 5.00 JOD per adult + buffet / 3.00 JOD per child + buffet");
  assert.deepEqual(COMMISSION_TYPE_OPTIONS.map(x=>x.label),["Percentage","Fixed per guest","Fixed per booking"]);
});

test("V/security: editor has mobile rules and no unsafe HTML rendering",async()=>{
  const[component,css]=await Promise.all([
    fs.readFile(new URL("../admin-app/src/CommissionEditor.jsx",import.meta.url),"utf8"),
    fs.readFile(new URL("../admin-app/src/commission-editor.css",import.meta.url),"utf8")
  ]);
  assert.match(component,/Edit commission/);assert.match(component,/disabled=\{saving\}/);assert.doesNotMatch(component,/dangerouslySetInnerHTML/);
  assert.match(css,/@media\(max-width:560px\)/);assert.match(css,/min-width:0/);assert.match(css,/min-height:42px/);
});
