import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";

const SEA_BREEZE_PROVIDER_RE=/(sea\s*breeze|aqua\s*marina|aquamarina)/i;
const AYLA_RE=/(ayla|أيلة)/i;
const SUNSET_RE=/(sunset|غروب)/i;
const TARGET_VESSEL="بريز الخشبي";

export function isSeaBreezeSunsetCandidate({providerName="",trip={}}={}){
  return SEA_BREEZE_PROVIDER_RE.test(String(providerName))
    && String(trip.category||"")==="sunset"
    && Number(trip.durationMinutes)===120
    && AYLA_RE.test(String(trip.departureLocation?.name||""))
    && (SUNSET_RE.test(String(trip.titleEn||""))||SUNSET_RE.test(String(trip.titleAr||"")));
}

export async function applyRealPilotData(){
  if(process.env.APPLY_REAL_PILOT_DATA!=="true")return {skipped:true,reason:"disabled"};

  const providers=await Provider.find({businessName:SEA_BREEZE_PROVIDER_RE}).select("_id businessName");
  if(!providers.length){
    console.warn("Real Pilot Data: no Sea Breeze / Aquamarina provider found; no changes applied");
    return {applied:false,reason:"provider_not_found"};
  }

  const providerById=new Map(providers.map(p=>[String(p._id),p.businessName]));
  const trips=await Trip.find({
    providerId:{$in:providers.map(p=>p._id)},
    category:"sunset",
    durationMinutes:120
  });

  const candidates=trips.filter(trip=>isSeaBreezeSunsetCandidate({
    providerName:providerById.get(String(trip.providerId))||"",
    trip
  }));

  if(candidates.length!==1){
    console.warn(`Real Pilot Data: expected exactly one Sea Breeze sunset candidate, found ${candidates.length}; no changes applied`);
    return {applied:false,reason:"ambiguous_candidate",candidateCount:candidates.length};
  }

  const trip=candidates[0];
  const current=String(trip.vesselName||"").trim();
  if(current&&current!==TARGET_VESSEL){
    console.warn(`Real Pilot Data: target trip already has vesselName=${JSON.stringify(current)}; refusing to overwrite`);
    return {applied:false,reason:"existing_value_conflict",tripId:String(trip._id)};
  }
  if(current===TARGET_VESSEL){
    console.log(`Real Pilot Data: Sea Breeze vessel already set on trip ${trip._id}`);
    return {applied:false,reason:"already_applied",tripId:String(trip._id)};
  }

  trip.vesselName=TARGET_VESSEL;
  await trip.save();
  console.log(`Real Pilot Data: set vesselName=${JSON.stringify(TARGET_VESSEL)} on Sea Breeze trip ${trip._id}`);
  return {applied:true,tripId:String(trip._id),vesselName:TARGET_VESSEL};
}
