import crypto from "node:crypto";
import express from "express";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";

const USER_FIELDS=["_id","name","email","phone","role","isActive","authVersion","createdAt","updatedAt"];
const PROVIDER_FIELDS=["_id","businessName","status","ownerUserId","createdAt","updatedAt","settings.configured","settings.defaultCapacity","settings.defaultDepartureTime","settings.departureLocation.name","settings.departureLocation.address","settings.departureLocation.googleMapsUrl"];
const PRICING_FIELDS=["currency","pricePerPerson","adultPrice","childPrice","buffetEnabled","buffetAdultPrice","buffetChildPrice","buffetDescription","commissionType","commissionValue","adultCommission","childCommission","buffetAdultCommission","buffetChildCommission"];
const TRIP_FIELDS=["_id","providerId","titleEn","titleAr","vesselName","category","durationMinutes","active","createdAt","updatedAt","departureLocation.name","departureLocation.address","departureLocation.googleMapsUrl",...PRICING_FIELDS.map(k=>`pricing.${k}`)];
const DEPARTURE_FIELDS=["_id","tripId","startsAt","capacity","reservedSeats","salesClosed","status","createdAt","updatedAt"];
const MAX_ROWS=10000;
const TARGET_PROVIDER=/fun\s*n\s*sun|sea\s*breeze|aqua\s*marina|aladdin|alaa\s*aldeen/i;

function projection(fields){return Object.fromEntries(fields.map(k=>[k,1]));}
function scalar(value){
  if(value instanceof Date)return value.toISOString();
  if(value instanceof mongoose.Types.ObjectId)return value.toHexString();
  if(value===null||["string","number","boolean"].includes(typeof value))return value;
  return undefined;
}
function safeFields(row,fields){
  const result={};
  for(const path of fields){
    const parts=path.split(".");
    let value=row;
    for(const part of parts)value=value?.[part];
    value=scalar(value);
    if(value===undefined)continue;
    let target=result;
    for(const part of parts.slice(0,-1))target=target[part]??={};
    target[parts.at(-1)]=value;
  }
  return result;
}
async function read(db,collection,filter,fields,sort=undefined){
  let cursor=db.collection(collection).find(filter,{projection:projection(fields),maxTimeMS:10000}).limit(MAX_ROWS+1);
  if(sort)cursor=cursor.sort(sort);
  const rows=await cursor.toArray();
  if(rows.length>MAX_ROWS)throw new Error(`Diagnostic row limit exceeded for ${collection}`);
  return rows;
}
async function count(db,collection,filter){return db.collection(collection).countDocuments(filter,{maxTimeMS:10000});}
function normalize(value){return String(value||"").trim().replace(/\s+/g," ").toLowerCase();}
function duplicateGroups(rows,keyFn,shapeFn){
  const grouped=new Map();
  for(const row of rows){
    const key=keyFn(row);
    if(!key)continue;
    const bucket=grouped.get(key)||[];
    bucket.push(shapeFn(row));
    grouped.set(key,bucket);
  }
  return [...grouped.entries()].filter(([,items])=>items.length>1).map(([key,items])=>({key,count:items.length,items}));
}
function envBool(env,key){return env[key]==="true";}

export async function collectProductionDiagnostics(db,{env=process.env}={}){
  const [admins,allProviders,allTrips,allUsers,collections]=await Promise.all([
    read(db,"users",{role:"admin"},USER_FIELDS,{email:1}),
    read(db,"providers",{},PROVIDER_FIELDS,{businessName:1}),
    read(db,"trips",{},TRIP_FIELDS,{createdAt:1}),
    read(db,"users",{},["_id","name","email","role","isActive","authVersion"],{email:1}),
    db.listCollections({}, {nameOnly:true}).toArray()
  ]);

  const targetProviders=allProviders.filter(p=>TARGET_PROVIDER.test(String(p.businessName||"")));
  const providerResults=[];
  for(const provider of targetProviders){
    const owner=provider.ownerUserId?await read(db,"users",{_id:provider.ownerUserId},USER_FIELDS):[];
    const trips=allTrips.filter(t=>String(t.providerId)===String(provider._id));
    const tripResults=[];
    for(const trip of trips){
      const [departures,bookingCount,confirmedCount,cancelledCount,refundedCount,checkedInCount,paymentCount]=await Promise.all([
        read(db,"departures",{tripId:trip._id},DEPARTURE_FIELDS,{startsAt:1}),
        count(db,"bookings",{tripId:trip._id}),
        count(db,"bookings",{tripId:trip._id,status:"confirmed"}),
        count(db,"bookings",{tripId:trip._id,status:"cancelled"}),
        count(db,"bookings",{tripId:trip._id,status:"refunded"}),
        count(db,"bookings",{tripId:trip._id,checkedInAt:{$type:"date"}}),
        count(db,"payments",{bookingId:{$in:(await read(db,"bookings",{tripId:trip._id},["_id"])).map(x=>x._id)}})
      ]);
      tripResults.push({
        trip:safeFields(trip,TRIP_FIELDS),
        departures:departures.map(d=>safeFields(d,DEPARTURE_FIELDS)),
        counts:{bookings:bookingCount,confirmed:confirmedCount,cancelled:cancelledCount,refunded:refundedCount,checkedIn:checkedInCount,payments:paymentCount}
      });
    }
    providerResults.push({provider:safeFields(provider,PROVIDER_FIELDS),ownerUsers:owner.map(u=>safeFields(u,USER_FIELDS)),trips:tripResults});
  }

  const approvedIds=new Set(allProviders.filter(p=>p.status==="approved").map(p=>String(p._id)));
  const publicTripCount=allTrips.filter(t=>t.active===true&&approvedIds.has(String(t.providerId))).length;
  const paymentStatuses=["created","pending","paid","failed","cancelled","expired","needs_review","partially_refunded","refunded"];
  const bookingStatuses=["pending_payment","confirmed","cancelled","expired","refunded"];
  const paymentCounts=Object.fromEntries(await Promise.all(paymentStatuses.map(async s=>[s,await count(db,"payments",{status:s})])));
  const bookingCounts=Object.fromEntries(await Promise.all(bookingStatuses.map(async s=>[s,await count(db,"bookings",{status:s})])));

  const providerDuplicates=duplicateGroups(allProviders,p=>normalize(p.businessName),p=>({id:String(p._id),businessName:p.businessName,status:p.status}));
  const emailDuplicates=duplicateGroups(allUsers,u=>normalize(u.email),u=>({id:String(u._id),name:u.name,email:u.email,role:u.role,isActive:u.isActive}));
  const tripDuplicates=duplicateGroups(allTrips,t=>`${String(t.providerId)}|${normalize(t.titleEn)}|${normalize(t.titleAr)}`,t=>({id:String(t._id),providerId:String(t.providerId),titleEn:t.titleEn,titleAr:t.titleAr,vesselName:t.vesselName,active:t.active}));

  const ticketCollectionExists=collections.some(c=>c.name==="tickets");
  const ticketDocuments=ticketCollectionExists?await count(db,"tickets",{}):0;
  const seaBreezeEmailUsers=allUsers.filter(u=>normalize(u.email)==="info@aquamarina-aqaba.com");

  return {
    readOnly:true,
    generatedAt:new Date().toISOString(),
    databaseReady:mongoose.connection.readyState===1,
    configuration:{
      nodeEnv:String(env.NODE_ENV||""),
      publicLaunch:envBool(env,"PUBLIC_LAUNCH"),
      paymentProvider:String(env.PAYMENT_PROVIDER||"mock"),
      mockCheckoutEnabled:envBool(env,"ENABLE_MOCK_CHECKOUT"),
      seedDemoData:envBool(env,"SEED_DEMO_DATA"),
      cleanupDemoOnStart:envBool(env,"CLEANUP_DEMO_ON_START"),
      runPilotE2EOnStart:envBool(env,"RUN_PILOT_E2E_ON_START"),
      emailTestRecipientConfigured:Boolean(String(env.EMAIL_TEST_RECIPIENT||"").trim()),
      defaultCommissionPercentage:String(env.DEFAULT_COMMISSION_PERCENTAGE||""),
      allowedOrigins:String(env.ALLOWED_ORIGINS||"").split(",").map(v=>v.trim()).filter(Boolean)
    },
    totals:{providers:allProviders.length,trips:allTrips.length,publicTrips:publicTripCount,users:allUsers.length,bookings:await count(db,"bookings",{}),payments:await count(db,"payments",{}),departures:await count(db,"departures",{}),ticketCollectionExists,ticketDocuments},
    admins:admins.map(u=>safeFields(u,USER_FIELDS)),
    seaBreezeOfficialEmailUsers:seaBreezeEmailUsers.map(u=>safeFields(u,["_id","name","email","role","isActive","authVersion"])),
    targetProviders:providerResults,
    statusCounts:{bookings:bookingCounts,payments:paymentCounts},
    duplicates:{providers:providerDuplicates,usersByEmail:emailDuplicates,trips:tripDuplicates}
  };
}

export function createProductionDiagnosticsRouter({env=process.env,getDb=()=>mongoose.connection.db,now=Date.now}={}){
  const router=express.Router();
  let consumed=false;
  const limiter=rateLimit({windowMs:60000,limit:5,standardHeaders:false,legacyHeaders:false,keyGenerator:()=>"diagnostic-global",handler:(_req,res)=>res.status(404).json({error:"Not found"})});
  router.use((_req,res,next)=>{res.set("Cache-Control","no-store");res.set("Pragma","no-cache");next();});
  router.get("/real-pilot",limiter,async(req,res)=>{
    const secret=String(env.PRODUCTION_DIAGNOSTIC_TOKEN||"");
    const expires=Date.parse(env.PRODUCTION_DIAGNOSTIC_EXPIRES_AT||"");
    const remaining=expires-now();
    const supplied=String(req.get("authorization")||"");
    const enabled=env.PRODUCTION_DIAGNOSTIC_ENABLED==="true"&&/^[a-f0-9]{64}$/.test(secret)&&remaining>0&&remaining<=30*60*1000;
    const digest=v=>crypto.createHash("sha256").update(v).digest();
    if(!enabled||consumed||!crypto.timingSafeEqual(digest(supplied),digest(`Bearer ${secret}`)))return res.status(404).json({error:"Not found"});
    consumed=true;
    try{return res.json(await collectProductionDiagnostics(getDb(),{env}));}
    catch(error){console.error("Production diagnostic read failed",error);return res.status(503).json({error:"Diagnostic unavailable"});}
  });
  return router;
}
