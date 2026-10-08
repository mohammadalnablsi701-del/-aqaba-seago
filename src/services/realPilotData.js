import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";

const SEA_BREEZE_PROVIDER_RE=/(sea\s*breeze|aqua\s*marina|aquamarina)/i;
const FUN_N_SUN_PROVIDER_RE=/fun\s*(?:n|&|and)\s*sun/i;
const AYLA_RE=/(ayla|أيلة)/i;
const SUNSET_RE=/(sunset|غروب)/i;
const TARGET_VESSEL="بريز الخشبي";
export const FUN_N_SUN_VESSEL="White Prince";

export const SEA_BREEZE_PROVIDER_DEFAULTS={
  defaultCapacity:10,
  defaultDepartureTime:"17:00",
  departureLocation:{
    name:"Ayla Marina",
    address:"Aqaba, Jordan",
    googleMapsUrl:"https://maps.app.goo.gl/oDBcHhKdzih9Y2RU8?g_st=ic"
  }
};

export const SEA_BREEZE_PILOT_TRIP={
  titleAr:"رحلة غروب الشمس",
  titleEn:"Sunset Cruise",
  vesselName:TARGET_VESSEL,
  category:"sunset",
  durationMinutes:120,
  pricing:{
    currency:"JOD",
    pricePerPerson:15,
    adultPrice:15,
    childPrice:10,
    buffetEnabled:true,
    buffetAdultPrice:17,
    buffetChildPrice:12,
    commissionType:"fixed_per_person",
    commissionValue:3,
    adultCommission:3,
    childCommission:2,
    buffetAdultCommission:3,
    buffetChildCommission:2
  },
  departureLocation:{...SEA_BREEZE_PROVIDER_DEFAULTS.departureLocation},
  active:true
};

export function resolveSeaBreezeDefaultDepartureTime(current){
  const value=String(current||"").trim();
  return !value||value==="09:00"?SEA_BREEZE_PROVIDER_DEFAULTS.defaultDepartureTime:value;
}

export function isSeaBreezeSunsetCandidate({providerName="",trip={}}={}){
  return SEA_BREEZE_PROVIDER_RE.test(String(providerName))
    && String(trip.category||"")==="sunset"
    && Number(trip.durationMinutes)===120
    && AYLA_RE.test(String(trip.departureLocation?.name||""))
    && (SUNSET_RE.test(String(trip.titleEn||""))||SUNSET_RE.test(String(trip.titleAr||"")));
}

async function ensureSeaBreezeProviderDefaults(provider){
  if(!provider)return {updated:false};
  const current=provider.settings||{};
  const departure=current.departureLocation||{};
  const defaultDepartureTime=resolveSeaBreezeDefaultDepartureTime(current.defaultDepartureTime);
  const desiredLocation=SEA_BREEZE_PROVIDER_DEFAULTS.departureLocation;
  const changed=current.configured!==true
    || Number(current.defaultCapacity)!==SEA_BREEZE_PROVIDER_DEFAULTS.defaultCapacity
    || String(current.defaultDepartureTime||"")!==defaultDepartureTime
    || String(departure.name||"")!==desiredLocation.name
    || String(departure.address||"")!==desiredLocation.address
    || String(departure.googleMapsUrl||"")!==desiredLocation.googleMapsUrl;

  if(!changed)return {updated:false,defaultDepartureTime};

  provider.settings={
    configured:true,
    defaultCapacity:SEA_BREEZE_PROVIDER_DEFAULTS.defaultCapacity,
    defaultDepartureTime,
    departureLocation:{...desiredLocation}
  };
  await provider.save();
  console.log(`Real Pilot Data: updated Sea Breeze provider defaults capacity=${SEA_BREEZE_PROVIDER_DEFAULTS.defaultCapacity} defaultDepartureTime=${defaultDepartureTime}`);
  return {updated:true,defaultDepartureTime};
}

function safeTripDiagnostic(trip,providerName){
  return {
    id:String(trip._id),
    providerName:String(providerName||""),
    titleEn:String(trip.titleEn||""),
    titleAr:String(trip.titleAr||""),
    category:String(trip.category||""),
    durationMinutes:Number(trip.durationMinutes||0),
    departureName:String(trip.departureLocation?.name||""),
    vesselName:String(trip.vesselName||"")
  };
}

async function applySeaBreezePilot(){
  const providers=await Provider.find({businessName:SEA_BREEZE_PROVIDER_RE});
  if(!providers.length){
    console.warn("Real Pilot Data: no Sea Breeze / Aquamarina provider found; no changes applied");
    return {applied:false,reason:"provider_not_found"};
  }

  if(providers.length!==1){
    console.warn(`Real Pilot Data: found ${providers.length} Sea Breeze / Aquamarina providers; refusing to choose a provider automatically`);
    console.warn(`Real Pilot Data providers: ${JSON.stringify(providers.map(p=>({id:String(p._id),businessName:String(p.businessName||"")})))}`);
    return {applied:false,reason:"ambiguous_provider",providerCount:providers.length};
  }

  const provider=providers[0];
  const settingsResult=await ensureSeaBreezeProviderDefaults(provider);
  const providerTrips=await Trip.find({providerId:provider._id});

  if(providerTrips.length===0){
    const created=await Trip.create({...SEA_BREEZE_PILOT_TRIP,providerId:provider._id});
    console.log(`Real Pilot Data: created Sea Breeze Sunset Cruise ${created._id} with vesselName=${JSON.stringify(TARGET_VESSEL)}`);
    return {applied:true,action:"created_trip",providerSettingsUpdated:settingsResult.updated,tripId:String(created._id),vesselName:TARGET_VESSEL};
  }

  const candidates=providerTrips.filter(trip=>isSeaBreezeSunsetCandidate({providerName:provider.businessName,trip}));

  if(candidates.length!==1){
    const diagnostic=providerTrips.map(trip=>safeTripDiagnostic(trip,provider.businessName));
    console.warn(`Real Pilot Data: expected exactly one Sea Breeze sunset candidate, found ${candidates.length}; no trip changes applied`);
    console.warn(`Real Pilot Data diagnostic: ${JSON.stringify(diagnostic)}`);
    return {applied:settingsResult.updated,reason:"ambiguous_candidate",providerSettingsUpdated:settingsResult.updated,candidateCount:candidates.length};
  }

  const trip=candidates[0];
  const current=String(trip.vesselName||"").trim();
  if(current&&current!==TARGET_VESSEL){
    console.warn(`Real Pilot Data: target trip already has vesselName=${JSON.stringify(current)}; refusing to overwrite`);
    return {applied:settingsResult.updated,reason:"existing_value_conflict",providerSettingsUpdated:settingsResult.updated,tripId:String(trip._id)};
  }
  if(current===TARGET_VESSEL){
    console.log(`Real Pilot Data: Sea Breeze vessel already set on trip ${trip._id}`);
    return {applied:settingsResult.updated,reason:settingsResult.updated?"updated_provider_defaults":"already_applied",providerSettingsUpdated:settingsResult.updated,tripId:String(trip._id)};
  }

  trip.vesselName=TARGET_VESSEL;
  await trip.save();
  console.log(`Real Pilot Data: set vesselName=${JSON.stringify(TARGET_VESSEL)} on Sea Breeze trip ${trip._id}`);
  return {applied:true,action:"updated_vessel",providerSettingsUpdated:settingsResult.updated,tripId:String(trip._id),vesselName:TARGET_VESSEL};
}

async function applyFunNSunVesselBackfill(){
  const providers=await Provider.find({businessName:FUN_N_SUN_PROVIDER_RE});
  if(providers.length!==1){
    console.warn(`Real Pilot Data: expected exactly one Fun N Sun provider, found ${providers.length}; no Fun N Sun vessel changes applied`);
    return {applied:false,reason:providers.length?"ambiguous_provider":"provider_not_found",providerCount:providers.length};
  }

  const provider=providers[0];
  const trips=await Trip.find({providerId:provider._id}).sort({createdAt:1});
  if(trips.length!==3){
    console.warn(`Real Pilot Data: expected exactly three Fun N Sun pilot trips, found ${trips.length}; no Fun N Sun vessel changes applied`);
    console.warn(`Real Pilot Data Fun N Sun diagnostic: ${JSON.stringify(trips.map(t=>safeTripDiagnostic(t,provider.businessName)))}`);
    return {applied:false,reason:"unexpected_trip_count",tripCount:trips.length};
  }

  const conflicts=trips.filter(t=>{
    const current=String(t.vesselName||"").trim();
    return current&&current!==FUN_N_SUN_VESSEL;
  });
  if(conflicts.length){
    console.warn(`Real Pilot Data: ${conflicts.length} Fun N Sun trip(s) already have a different vesselName; refusing to overwrite any trip`);
    console.warn(`Real Pilot Data Fun N Sun conflicts: ${JSON.stringify(conflicts.map(t=>safeTripDiagnostic(t,provider.businessName)))}`);
    return {applied:false,reason:"existing_value_conflict",conflictCount:conflicts.length};
  }

  let updated=0;
  for(const trip of trips){
    if(String(trip.vesselName||"").trim()===FUN_N_SUN_VESSEL)continue;
    trip.vesselName=FUN_N_SUN_VESSEL;
    await trip.save();
    updated+=1;
  }
  console.log(`Real Pilot Data: Fun N Sun vesselName=${JSON.stringify(FUN_N_SUN_VESSEL)} confirmed across ${trips.length} pilot trips; updated ${updated}`);
  return {applied:updated>0,reason:updated?"updated_vessels":"already_applied",tripCount:trips.length,updatedCount:updated,vesselName:FUN_N_SUN_VESSEL};
}

export async function applyRealPilotData(){
  if(process.env.APPLY_REAL_PILOT_DATA!=="true")return {skipped:true,reason:"disabled"};
  const seaBreeze=await applySeaBreezePilot();
  const funNSun=await applyFunNSunVesselBackfill();
  return {applied:Boolean(seaBreeze?.applied||funNSun?.applied),seaBreeze,funNSun};
}
