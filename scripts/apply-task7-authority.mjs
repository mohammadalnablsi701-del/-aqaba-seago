import fs from "node:fs";

function read(path){return fs.readFileSync(path,"utf8")}
function write(path,content){fs.mkdirSync(path.split("/").slice(0,-1).join("/"),{recursive:true});fs.writeFileSync(path,content)}
function replaceOnce(path,from,to){
  const input=read(path);
  const first=input.indexOf(from);
  if(first<0)throw new Error(`Missing replacement anchor in ${path}: ${from.slice(0,120)}`);
  if(input.indexOf(from,first+from.length)>=0)throw new Error(`Non-unique replacement anchor in ${path}: ${from.slice(0,120)}`);
  write(path,input.slice(0,first)+to+input.slice(first+from.length));
}
function replaceRegexOnce(path,re,to,label){
  const input=read(path);const matches=[...input.matchAll(new RegExp(re.source,re.flags.includes("g")?re.flags:re.flags+"g"))];
  if(matches.length!==1)throw new Error(`Expected one ${label} match in ${path}, found ${matches.length}`);
  write(path,input.replace(re,to));
}

// Minimal data model: provider owns active; platform/admin owns platformStatus.
replaceOnce(
  "src/models/Trip.js",
  'active:{type:Boolean,default:true}',
  'active:{type:Boolean,default:true},platformStatus:{type:String,enum:["allowed","paused"],default:"allowed",index:true}'
);

write("src/services/tripSales.js",`export const PLATFORM_STATUS = Object.freeze({ ALLOWED: "allowed", PAUSED: "paused" });

export function tripPlatformStatus(trip) {
  return trip?.platformStatus === PLATFORM_STATUS.PAUSED ? PLATFORM_STATUS.PAUSED : PLATFORM_STATUS.ALLOWED;
}

export function platformAllowsSales(trip) {
  return tripPlatformStatus(trip) === PLATFORM_STATUS.ALLOWED;
}

export function isTripSellable({ trip, provider }) {
  return Boolean(trip?.active === true && platformAllowsSales(trip) && provider?.status === "approved");
}

// $ne intentionally matches legacy documents where platformStatus is missing.
// That preserves pre-Task-7 commercial behavior without a production migration.
export function sellableTripFilter(extra = {}) {
  return { ...extra, active: true, platformStatus: { $ne: PLATFORM_STATUS.PAUSED } };
}
`);

// Provider trip routes: explicit duplicate provenance, no provider write path to platformStatus.
replaceOnce("src/routes/trips.js",'import express from "express";','import express from "express";\nimport mongoose from "mongoose";');
replaceOnce(
  "src/routes/trips.js",
  'import { tripForAudience } from "../services/pricingVisibility.js";',
  'import { tripForAudience } from "../services/pricingVisibility.js";\nimport { PLATFORM_STATUS, sellableTripFilter, tripPlatformStatus } from "../services/tripSales.js";'
);
replaceOnce(
  "src/routes/trips.js",
  '    const p=access?.provider;\n    if(!p)return res.status(403).json({error:"Trip management permission required"});\n\n    const configuredCommission=Number(process.env.DEFAULT_COMMISSION_PERCENTAGE);',
  '    const p=access?.provider;\n    if(!p)return res.status(403).json({error:"Trip management permission required"});\n\n    let platformStatus=PLATFORM_STATUS.ALLOWED;\n    if(req.body.duplicateFromTripId!==undefined){\n      const sourceId=String(req.body.duplicateFromTripId||"").trim();\n      if(!mongoose.isValidObjectId(sourceId))return res.status(400).json({error:"Invalid duplicate source"});\n      const source=await Trip.findOne({_id:sourceId,providerId:p._id}).select("platformStatus");\n      if(!source)return res.status(404).json({error:"Duplicate source trip not found"});\n      // A deliberate duplicate of an Admin-held listing remains held. Normal new trips stay allowed.\n      platformStatus=tripPlatformStatus(source);\n    }\n\n    const configuredCommission=Number(process.env.DEFAULT_COMMISSION_PERCENTAGE);'
);
replaceOnce(
  "src/routes/trips.js",
  '      active: req.body.active !== false,\n      pricing: {',
  '      active: req.body.active !== false,\n      platformStatus,\n      pricing: {'
);
replaceOnce(
  "src/routes/trips.js",
  '    const trips = await Trip.find({ active: true, providerId: { $in: providerIds } })',
  '    const trips = await Trip.find(sellableTripFilter({ providerId: { $in: providerIds } }))'
);

// Public departure discovery and quote must respect the platform hold.
replaceOnce(
  "src/routes/departures.js",
  'import { salePricing } from "../services/pricingVisibility.js";',
  'import { salePricing } from "../services/pricingVisibility.js";\nimport { sellableTripFilter } from "../services/tripSales.js";'
);
replaceOnce(
  "src/routes/departures.js",
  '    const activeTrips=await Trip.find({active:true,providerId:{$in:approvedProviderIds}}).select("_id");',
  '    const activeTrips=await Trip.find(sellableTripFilter({providerId:{$in:approvedProviderIds}})).select("_id");'
);
replaceOnce(
  "src/routes/departures.js",
  '    const trip = await Trip.findOne({ _id: departure.tripId, active: true });',
  '    const trip = await Trip.findOne(sellableTripFilter({ _id: departure.tripId }));'
);

// Direct checkout by departure ID is server-side gated too.
replaceOnce(
  "src/services/checkout.js",
  'import { calculateTieredPricing } from "./pricing.js";',
  'import { calculateTieredPricing } from "./pricing.js";\nimport { sellableTripFilter } from "./tripSales.js";'
);
replaceOnce(
  "src/services/checkout.js",
  '      const trip=await Trip.findOne({_id:departure.tripId,active:true}).session(session);',
  '      const trip=await Trip.findOne(sellableTripFilter({_id:departure.tripId})).session(session);'
);

// Admin gets a separate authority. The old shared-active endpoint is retired, never repurposed to provider state.
write("src/routes/adminTripControl.js",`import express from "express";
import Trip from "../models/Trip.js";
import Provider from "../models/Provider.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { isTripSellable, PLATFORM_STATUS, tripPlatformStatus } from "../services/tripSales.js";

const router=express.Router();
router.use(requireAuth,requireRole("admin"));

router.patch("/trips/:tripId/platform-status",async(req,res,next)=>{
  try{
    const platformStatus=String(req.body.platformStatus||"").trim();
    if(!Object.values(PLATFORM_STATUS).includes(platformStatus)){
      return res.status(400).json({error:"platformStatus must be allowed or paused"});
    }
    const trip=await Trip.findById(req.params.tripId);
    if(!trip)return res.status(404).json({error:"Trip not found"});
    const provider=await Provider.findById(trip.providerId).select("businessName status");
    if(!provider)return res.status(409).json({error:"Trip provider not found"});

    trip.platformStatus=platformStatus;
    await trip.save();

    res.json({
      id:trip._id,
      active:trip.active,
      platformStatus:tripPlatformStatus(trip),
      provider:{id:provider._id,businessName:provider.businessName,status:provider.status},
      sellable:isTripSellable({trip,provider})
    });
  }catch(e){next(e);}
});

// Fail closed for stale Admin clients instead of allowing the old endpoint to mutate provider authority.
router.patch("/trips/:tripId/active",(_req,res)=>{
  res.status(410).json({error:"Admin trip sales control moved to platform-status"});
});

export default router;
`);

// Admin API and UI: platform-level wording/control; provider active stays visible and independent.
replaceOnce(
  "admin-app/src/api.js",
  'export const setTripActive=(token,id,active)=>req("/api/admin/trips/"+id+"/active",{token,method:"PATCH",body:JSON.stringify({active:Boolean(active)})});',
  'export const setTripPlatformStatus=(token,id,platformStatus)=>req("/api/admin/trips/"+id+"/platform-status",{token,method:"PATCH",body:JSON.stringify({platformStatus})});'
);
replaceOnce(
  "admin-app/src/App.jsx",
  'trips,setTripActive,setCommission',
  'trips,setTripPlatformStatus,setCommission'
);
replaceRegexOnce(
  "admin-app/src/App.jsx",
  /function TripRow\(\{t,token,onSaved\}\)\{.*?\}\nfunction RefundRow/s,
  `function TripRow({t,token,onSaved}){const p=t.pricing||{};const[value,setValue]=useState(p.commissionType==="percentage"?Number(p.commissionValue||20):20);const[saving,setSaving]=useState(false);const[toggling,setToggling]=useState(false);const[msg,setMsg]=useState("");async function save(){setSaving(true);setMsg("");try{await setCommission(token,t._id,Number(value));setMsg("Saved · applies to new bookings");await onSaved()}catch(e){setMsg(e.message)}finally{setSaving(false)}}const platformStatus=t.platformStatus==="paused"?"paused":"allowed";async function togglePlatform(){setToggling(true);setMsg("");try{const next=platformStatus==="paused"?"allowed":"paused";await setTripPlatformStatus(token,t._id,next);setMsg(next==="paused"?"Paused on Aqaba SeaGo":"Allowed on Aqaba SeaGo");await onSaved()}catch(e){setMsg(e.message)}finally{setToggling(false)}}const adultPrice=Number(p.adultPrice??p.pricePerPerson??0);const f=t.financials||{};const currency=f.currency||p.currency||"JOD";const providerApproved=t.providerId?.status==="approved";const platformAllowed=platformStatus==="allowed";const sellable=Boolean(t.active&&platformAllowed&&providerApproved);const stateLabel=sellable?"Sellable":!providerApproved?"Provider blocked":!t.active?"Provider paused":"Platform paused";return <div className="trip trip-financial"><div className="trip-financial-main"><div className="trip-admin-head"><h3>{t.titleEn||t.titleAr||"Untitled trip"}</h3><span className={sellable?"trip-live":"trip-off"}>{stateLabel}</span></div><p>{t.providerId?.businessName||"Provider"} · {String(t.providerId?.status||"unknown")} · {adultPrice.toFixed(2)} {currency}/adult</p><p><b>Provider state:</b> {t.active?"Active":"Paused"} · <b>Platform:</b> {platformAllowed?"Allowed":"Paused"}</p><div className="trip-financial-grid"><div><small>Bookings</small><b>{f.confirmedBookings||0}</b></div><div><small>Seats</small><b>{f.confirmedSeats||0}</b></div><div><small>Gross sales</small><b>{Number(f.grossSales||0).toFixed(2)} {currency}</b></div><div><small>SeaGo earned</small><b>{Number(f.commissionAmount||0).toFixed(2)} {currency}</b></div><div><small>Provider net</small><b>{Number(f.providerNetAmount||0).toFixed(2)} {currency}</b></div></div></div><div className="commission"><small>PLATFORM SALES CONTROL</small><button className={platformAllowed?"danger":"secondary"} onClick={togglePlatform} disabled={toggling}>{toggling?"Working...":platformAllowed?"Pause on platform":"Allow on platform"}</button><small>PROVIDER STATE: {t.active?"ACTIVE":"PAUSED"}</small><small>OF TOTAL BOOKING</small><label>SeaGo commission<input type="number" min="0" max="100" step="0.1" value={value} onChange={e=>setValue(e.target.value)}/><span>%</span></label><button onClick={save} disabled={saving}><Save size={15}/>{saving?"Saving":"Save"}</button>{msg&&<small>{msg}</small>}</div></div>}
function RefundRow`,
  "TripRow"
);

// Provider duplicate tells the backend its source so an Admin-held listing cannot be bypassed by Duplicate.
replaceOnce(
  "provider-app/src/App.jsx",
  'async function save(e){e.preventDefault();setBusy(true);setError("");const data=serializeTripForm(form);try{let created=null;',
  'async function save(e){e.preventDefault();setBusy(true);setError("");const data=serializeTripForm(form);if(duplicateFrom?._id)data.duplicateFromTripId=duplicateFrom._id;try{let created=null;'
);
replaceOnce(
  "provider-app/src/App.jsx",
  '<label className="toggle-row"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Publish this trip</label>',
  '{source?.platformStatus==="paused"&&<div className="platform-pause-note"><XCircle size={18}/><div><b>Paused by Aqaba SeaGo</b><span>Your provider Active setting is independent. New sales stay blocked until Aqaba SeaGo allows this trip again.</span></div></div>}<label className="toggle-row"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Active from provider side</label>'
);
replaceOnce(
  "provider-app/src/App.jsx",
  '<span className={"trip-state "+(t.active?"active":"inactive")}>{t.active?"ACTIVE":"PAUSED"}</span></div><div className="trip-card-body"><div className="trip-card-title">',
  '<span className={"trip-state "+(t.active?"active":"inactive")}>{t.active?"PROVIDER ACTIVE":"PROVIDER PAUSED"}</span></div><div className="trip-card-body">{t.platformStatus==="paused"&&<div className="platform-pause-note compact"><XCircle size={16}/><div><b>Paused by Aqaba SeaGo</b><span>New customer sales are blocked by the platform.</span></div></div>}<div className="trip-card-title">'
);
write("provider-app/src/platform-authority.css",`.platform-pause-note{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid rgba(185,28,28,.22);border-radius:12px;background:rgba(254,226,226,.72);color:#7f1d1d;margin:10px 0}.platform-pause-note svg{flex:0 0 auto;margin-top:2px}.platform-pause-note div{display:flex;flex-direction:column;gap:2px}.platform-pause-note b{font-size:.84rem}.platform-pause-note span{font-size:.76rem;line-height:1.35}.platform-pause-note.compact{margin:0 0 10px;padding:8px 10px}\n`);
replaceOnce(
  "provider-app/src/main.jsx",
  'import"./commission-polish.css";',
  'import"./commission-polish.css";import"./platform-authority.css";'
);

// Make the authority integration test execute against the disposable replica set in CI.
replaceOnce(
  ".github/workflows/ci.yml",
  "                'test/provider-role-permissions.integration.test.js',\n                'test/admin-operations.integration.test.js',",
  "                'test/provider-role-permissions.integration.test.js',\n                'test/provider-sales-control.integration.test.js',\n                'test/admin-operations.integration.test.js',"
);

write("test/provider-sales-control.integration.test.js",`import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import User from "../src/models/User.js";
import Provider from "../src/models/Provider.js";
import Trip from "../src/models/Trip.js";
import Departure from "../src/models/Departure.js";
import Booking from "../src/models/Booking.js";
import CheckoutHold from "../src/models/CheckoutHold.js";
import Payment from "../src/models/Payment.js";

const uri=process.env.SEAGO_TEST_MONGODB_URI;

test("provider and platform trip sales authority are independent",{skip:!uri},async t=>{
  assert.match(uri,/^mongodb:\\/\\/(127\\.0\\.0\\.1|localhost):/,"Only a local disposable replica set is allowed");
  const oldSecret=process.env.JWT_SECRET;
  const oldCommission=process.env.DEFAULT_COMMISSION_PERCENTAGE;
  const oldPaymentProvider=process.env.PAYMENT_PROVIDER;
  process.env.JWT_SECRET="provider-sales-control-test-secret-at-least-32-characters";
  process.env.DEFAULT_COMMISSION_PERCENTAGE="20";
  process.env.PAYMENT_PROVIDER="mock";

  await mongoose.connect(uri,{dbName:"seago_provider_sales_"+crypto.randomUUID().replaceAll("-","")});
  t.after(async()=>{
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
    if(oldCommission===undefined)delete process.env.DEFAULT_COMMISSION_PERCENTAGE;else process.env.DEFAULT_COMMISSION_PERCENTAGE=oldCommission;
    if(oldPaymentProvider===undefined)delete process.env.PAYMENT_PROVIDER;else process.env.PAYMENT_PROVIDER=oldPaymentProvider;
  });

  await Promise.all([User,Provider,Trip,Departure,Booking,CheckoutHold,Payment].map(m=>m.init()));

  const admin=await User.create({name:"Admin",email:"sales-admin@example.test",role:"admin"});
  const owner=await User.create({name:"Provider A",email:"provider-a@example.test",role:"provider"});
  const ownerB=await User.create({name:"Provider B",email:"provider-b@example.test",role:"provider"});
  const customer=await User.create({name:"Customer",email:"customer@example.test",role:"customer"});
  const provider=await Provider.create({ownerUserId:owner._id,businessName:"Marine Operator A",status:"approved"});
  const providerB=await Provider.create({ownerUserId:ownerB._id,businessName:"Marine Operator B",status:"approved"});

  const token=user=>jwt.sign({sub:String(user._id)},process.env.JWT_SECRET,{expiresIn:"1h"});
  const adminToken=token(admin),ownerToken=token(owner),ownerBToken=token(ownerB),customerToken=token(customer);

  const app=createApp();
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {port}=server.address();
  const base=\`http://127.0.0.1:\${port}\`;

  async function request(path,{auth,method="GET",body,headers={}}={}){
    const response=await fetch(base+path,{
      method,
      headers:{...(auth?{authorization:\`Bearer \${auth}\`}:{ }),...(body?{"content-type":"application/json"}:{}),...headers},
      body:body?JSON.stringify(body):undefined
    });
    const json=await response.json().catch(()=>null);
    return {response,json};
  }

  const tripPayload={titleAr:"رحلة بحرية",titleEn:"Authority trip",category:"yacht",durationMinutes:90,pricing:{adultPrice:25,childPrice:15,buffetEnabled:false}};
  const created=await request("/api/trips",{auth:ownerToken,method:"POST",body:tripPayload});
  assert.equal(created.response.status,201);
  assert.equal(created.json.active,true);
  assert.equal(created.json.platformStatus,"allowed");
  const tripId=created.json._id;
  const startsAt=new Date(Date.now()+2*86400000).toISOString();
  const scheduled=await request("/api/departures",{auth:ownerToken,method:"POST",body:{tripId,startsAt,capacity:12}});
  assert.equal(scheduled.response.status,201);
  const departureId=scheduled.json._id;

  async function providerPatch(body){return request(\`/api/trips/\${tripId}\`,{auth:ownerToken,method:"PATCH",body})}
  async function adminPlatform(platformStatus){return request(\`/api/admin/trips/\${tripId}/platform-status\`,{auth:adminToken,method:"PATCH",body:{platformStatus}})}
  async function tripDoc(){return Trip.findById(tripId).lean()}
  async function publicTripVisible(){const r=await request("/api/trips");return r.json.some(x=>String(x._id||x.id)===String(tripId))}
  async function publicDepartureVisible(){const r=await request(\`/api/departures?tripId=\${tripId}\`);return r.json.some(x=>String(x.id||x._id)===String(departureId))}

  await t.test("A: provider active + platform allowed is sellable subject to departure gates",async()=>{
    assert.equal(await publicTripVisible(),true);
    assert.equal(await publicDepartureVisible(),true);
    const quote=await request(\`/api/departures/\${departureId}/quote?adults=1&children=0\`);
    assert.equal(quote.response.status,200);
  });

  await t.test("B: provider paused + platform allowed is not sellable",async()=>{
    const r=await providerPatch({active:false});assert.equal(r.response.status,200);
    const doc=await tripDoc();assert.equal(doc.active,false);assert.notEqual(doc.platformStatus,"paused");
    assert.equal(await publicTripVisible(),false);assert.equal(await publicDepartureVisible(),false);
  });

  await t.test("E/F: Admin pause/allow never changes provider active",async()=>{
    await providerPatch({active:true});
    const paused=await adminPlatform("paused");assert.equal(paused.response.status,200);assert.equal(paused.json.active,true);assert.equal(paused.json.platformStatus,"paused");
    assert.equal((await tripDoc()).active,true);
    const allowed=await adminPlatform("allowed");assert.equal(allowed.response.status,200);assert.equal(allowed.json.active,true);assert.equal(allowed.json.platformStatus,"allowed");
    assert.equal((await tripDoc()).active,true);
  });

  await t.test("C: provider active + platform paused is not sellable",async()=>{
    await providerPatch({active:true});await adminPlatform("paused");
    assert.equal(await publicTripVisible(),false);assert.equal(await publicDepartureVisible(),false);
    const quote=await request(\`/api/departures/\${departureId}/quote?adults=1&children=0\`);assert.equal(quote.response.status,404);
  });

  await t.test("D: provider paused + platform paused is not sellable",async()=>{
    await providerPatch({active:false});
    const doc=await tripDoc();assert.equal(doc.active,false);assert.equal(doc.platformStatus,"paused");
    assert.equal(await publicTripVisible(),false);assert.equal(await publicDepartureVisible(),false);
  });

  await t.test("G/H: provider toggles only active and cannot override platform state",async()=>{
    await adminPlatform("paused");
    const attempted=await providerPatch({active:true,platformStatus:"allowed"});assert.equal(attempted.response.status,200);
    const doc=await tripDoc();assert.equal(doc.active,true);assert.equal(doc.platformStatus,"paused");
    const pausedByProvider=await providerPatch({active:false});assert.equal(pausedByProvider.response.status,200);
    const doc2=await tripDoc();assert.equal(doc2.active,false);assert.equal(doc2.platformStatus,"paused");
  });

  await t.test("provider A cannot edit provider B trip",async()=>{
    const other=await Trip.create({providerId:providerB._id,titleAr:"رحلة ب",titleEn:"Provider B trip",category:"yacht",durationMinutes:60,pricing:{pricePerPerson:20,adultPrice:20,childPrice:10,commissionValue:20},active:true});
    const denied=await request(\`/api/trips/\${other._id}\`,{auth:ownerToken,method:"PATCH",body:{active:false}});assert.equal(denied.response.status,404);
    const unchanged=await Trip.findById(other._id).lean();assert.equal(unchanged.active,true);
    const own=await request(\`/api/trips/\${other._id}\`,{auth:ownerBToken,method:"PATCH",body:{active:false}});assert.equal(own.response.status,200);
  });

  await t.test("I: platform-paused trip cannot checkout directly by departure ID",async()=>{
    await providerPatch({active:true});await adminPlatform("paused");
    const before=await Departure.findById(departureId).lean();
    const checkout=await request("/api/payments/checkout",{auth:customerToken,method:"POST",headers:{"idempotency-key":"platform-paused-checkout"},body:{departureId:String(departureId),adults:1,children:0,mealPlan:"without_buffet"}});
    assert.equal(checkout.response.status,409);
    assert.match(checkout.json.error,/Trip unavailable/);
    const after=await Departure.findById(departureId).lean();assert.equal(after.reservedSeats,before.reservedSeats);
  });

  await t.test("J: confirmed bookings remain operational after platform pause",async()=>{
    const booking=await Booking.create({customerId:customer._id,customerSnapshot:{name:"Customer",phone:"+962700000000"},providerId:provider._id,tripId,departureId,seats:1,adults:1,children:0,mealPlan:"without_buffet",status:"confirmed",holdExpiresAt:new Date(Date.now()+3600000),pricing:{currency:"JOD",grossAmount:25,commissionAmount:5,providerNetAmount:20},idempotencyKey:"existing-confirmed-booking"});
    await adminPlatform("paused");
    const list=await request("/api/providers/me/bookings",{auth:ownerToken});assert.equal(list.response.status,200);
    assert.equal(list.json.some(x=>String(x._id)===String(booking._id)),true);
    const detail=await request(\`/api/providers/me/bookings/\${booking._id}\`,{auth:ownerToken});assert.equal(detail.response.status,200);
  });

  await t.test("K: public departures do not sell a platform-paused trip",async()=>{
    await providerPatch({active:true});await adminPlatform("paused");
    assert.equal(await publicDepartureVisible(),false);
  });

  await t.test("L: provider suspension blocks sales regardless of both trip states",async()=>{
    await providerPatch({active:true});await adminPlatform("allowed");
    await Provider.findByIdAndUpdate(provider._id,{$set:{status:"suspended"}});
    assert.equal(await publicTripVisible(),false);assert.equal(await publicDepartureVisible(),false);
    const checkout=await request("/api/payments/checkout",{auth:customerToken,method:"POST",headers:{"idempotency-key":"suspended-provider-checkout"},body:{departureId:String(departureId),adults:1,children:0}});assert.equal(checkout.response.status,409);
    await Provider.findByIdAndUpdate(provider._id,{$set:{status:"approved"}});
  });

  await t.test("M: Duplicate cannot bypass an Admin platform hold",async()=>{
    await providerPatch({active:true});await adminPlatform("paused");
    const duplicate=await request("/api/trips",{auth:ownerToken,method:"POST",body:{...tripPayload,titleEn:"Authority trip copy",duplicateFromTripId:String(tripId),active:true,platformStatus:"allowed"}});
    assert.equal(duplicate.response.status,201);assert.equal(duplicate.json.active,true);assert.equal(duplicate.json.platformStatus,"paused");
    const publicTrips=await request("/api/trips");assert.equal(publicTrips.json.some(x=>String(x._id)===String(duplicate.json._id)),false);
  });

  await t.test("legacy trips missing platformStatus remain allowed without migration",async()=>{
    const legacyId=new mongoose.Types.ObjectId();
    await Trip.collection.insertOne({_id:legacyId,providerId:provider._id,titleAr:"قديمة",titleEn:"Legacy trip",category:"yacht",durationMinutes:60,pricing:{currency:"JOD",pricePerPerson:18,adultPrice:18,childPrice:10,commissionType:"percentage",commissionValue:20},active:true,createdAt:new Date(),updatedAt:new Date()});
    const publicTrips=await request("/api/trips");assert.equal(publicTrips.json.some(x=>String(x._id||x.id)===String(legacyId)),true);
  });

  await t.test("legacy Admin shared-active endpoint can no longer mutate provider state",async()=>{
    await providerPatch({active:true});const before=await tripDoc();
    const old=await request(\`/api/admin/trips/\${tripId}/active\`,{auth:adminToken,method:"PATCH",body:{active:false}});assert.equal(old.response.status,410);
    const after=await tripDoc();assert.equal(after.active,before.active);assert.equal(after.platformStatus,before.platformStatus);
  });
});
`);

console.log("Task 7 authority patch applied successfully");
