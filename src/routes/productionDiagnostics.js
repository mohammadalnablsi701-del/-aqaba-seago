import crypto from 'node:crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';

// TEMPORARY release guard: deployment must never run startup migrations/cleanup.
// Remove together with this diagnostic module after the audit is acknowledged.
export const diagnosticReleaseReadOnlyStartup = true;
const USER = ['_id','name','email','role','isActive','authVersion'];
const LOCATION = ['name','address','googleMapsUrl','lat','lng'];
const PROVIDER = ['_id','businessName','status','ownerUserId','createdAt','updatedAt',
  'settings.configured','settings.defaultCapacity','settings.defaultDepartureTime',
  ...LOCATION.map(k=>'settings.departureLocation.'+k)];
const PRICING = ['currency','pricePerPerson','adultPrice','childPrice','buffetEnabled',
  'buffetAdultPrice','buffetChildPrice','commissionType','commissionValue',
  'adultCommission','childCommission','buffetAdultCommission','buffetChildCommission'];
const TRIP = ['_id','providerId','titleEn','titleAr','vesselName','category','durationMinutes',
  'active','createdAt','updatedAt',...LOCATION.map(k=>'departureLocation.'+k),...PRICING.map(k=>'pricing.'+k)];
const DEPARTURE = ['_id','tripId','startsAt','capacity','reservedSeats','salesClosed','status'];
const NAME = /(?:sea\s*breeze|aqua\s*marina)/i;
const EMAIL = /^seabreeze@aqabaseago\.com$/i;
const MAX_ROWS = 10000;
const STATUS = ['pending_payment','confirmed','cancelled','expired','refunded'];

// Whitelist twice: Mongo projection and response construction. Never spread DB documents.
function project(fields) { return Object.fromEntries(fields.map(k=>[k,1])); }
function safeFields(row,fields) {
  const result={};
  for(const path of fields){
    const parts=path.split('.');
    let value=row;
    for(const part of parts)value=value?.[part];
    if(value===undefined)continue;
    if(value instanceof Date)value=value.toISOString();
    else if(value instanceof mongoose.Types.ObjectId)value=value.toHexString();
    else if(value!==null&&!['string','number','boolean'].includes(typeof value))continue;
    let target=result;
    for(const part of parts.slice(0,-1))target=target[part]??={};
    target[parts.at(-1)]=value;
  }
  return result;
}
async function read(db,name,filter,fields){
  const rows=await db.collection(name).find(filter,{projection:project(fields),maxTimeMS:10000})
    .limit(MAX_ROWS+1).toArray();
  if(rows.length>MAX_ROWS)throw new Error('Diagnostic row limit exceeded');
  return rows;
}
async function count(db,name,filter){
  return db.collection(name).countDocuments(filter,{maxTimeMS:10000});
}
export async function collectProductionDiagnostics(db){
  const admins=await read(db,'users',{role:'admin'},USER);
  const providers=await read(db,'providers',{businessName:NAME},PROVIDER);
  const emailUsers=await read(db,'users',{email:EMAIL},USER);
  const relatedUsers=await read(db,'users',{$or:[{email:EMAIL},{name:NAME},{email:/aquamarina|sea[._-]?breeze/i}],role:'provider'},USER);
  const results=[];
  for(const provider of providers){
    const owners=provider.ownerUserId?await read(db,'users',{_id:provider.ownerUserId},USER):[];
    const trips=await read(db,'trips',{providerId:provider._id},TRIP);
    const tripResults=[];
    for(const trip of trips){
      const departures=await read(db,'departures',{tripId:trip._id},DEPARTURE);
      const bookingsCount=await count(db,'bookings',{tripId:trip._id});
      const bookingsByStatus={};
      for(const status of STATUS)bookingsByStatus[status]=await count(db,'bookings',{tripId:trip._id,status});
      const checkedInBookingsCount=await count(db,'bookings',{tripId:trip._id,checkedInAt:{$type:'date'}});
      tripResults.push({trip:safeFields(trip,TRIP),departures:departures.map(d=>safeFields(d,DEPARTURE)),
        bookingsCount,bookingsByStatus,checkedInBookingsCount,ticketsCount:null,
        ticketEligibleBookingsCount:bookingsByStatus.confirmed+bookingsByStatus.cancelled+bookingsByStatus.refunded,
        ticketCountBasis:'No Ticket model: ticket payloads are generated from confirmed/cancelled/refunded bookings; actual issued ticket count is not persisted.'});
    }
    results.push({provider:safeFields(provider,PROVIDER),owners:owners.map(u=>safeFields(u,USER)),trips:tripResults});
  }
  return {readOnly:true,generatedAt:new Date().toISOString(),consistentSnapshot:false,
    admins:admins.map(u=>safeFields(u,USER)),providerCount:providers.length,
    approvedEmailUserCount:emailUsers.length,approvedEmailUsers:emailUsers.map(u=>safeFields(u,USER)),
    relatedUsers:relatedUsers.map(u=>safeFields(u,USER)),providers:results};
}
export function createProductionDiagnosticsRouter({env=process.env,getDb=()=>mongoose.connection.db,now=Date.now}={}){
  const router=express.Router();
  let consumed=false;
  const limit=rateLimit({windowMs:60000,limit:5,standardHeaders:false,legacyHeaders:false,
    keyGenerator:()=> 'diagnostic-global',handler:(_req,res)=>res.status(404).json({error:'Not found'})});
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store');res.set('Pragma','no-cache');next();});
  router.get('/sea-breeze',limit,async(req,res)=>{
    const secret=env.PRODUCTION_DIAGNOSTIC_TOKEN||'';
    const expires=Date.parse(env.PRODUCTION_DIAGNOSTIC_EXPIRES_AT||'');
    const remaining=expires-now();
    const supplied=req.get('authorization')||'';
    const enabled=env.PRODUCTION_DIAGNOSTIC_ENABLED==='true'&&/^[a-f0-9]{64}$/.test(secret)
      &&remaining>0&&remaining<=30*60*1000;
    const digest=value=>crypto.createHash('sha256').update(value).digest();
    if(req.method!=='GET'||!enabled||consumed||!crypto.timingSafeEqual(digest(supplied),digest('Bearer '+secret)))
      return res.status(404).json({error:'Not found'});
    // Consume before awaiting DB, so concurrent requests cannot both read.
    consumed=true;
    try{return res.json(await collectProductionDiagnostics(getDb()));}
    catch{return res.status(503).json({error:'Diagnostic unavailable'});}
  });
  return router;
}
