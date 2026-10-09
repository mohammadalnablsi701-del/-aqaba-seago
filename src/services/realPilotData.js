import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";

const SEA_BREEZE_PROVIDER_RE=/(sea\s*breeze|aqua\s*marina|aquamarina)/i;
const FUN_N_SUN_PROVIDER_RE=/fun\s*(?:n|&|and)\s*sun/i;
const AYLA_RE=/(ayla|أيلة)/i;
const SUNSET_RE=/(sunset|غروب)/i;
const TARGET_VESSEL="Breeze Wooden Boat";
const LEGACY_SEA_BREEZE_VESSEL="بريز الخشبي";
export const FUN_N_SUN_VESSEL="White Prince";

export const SEA_BREEZE_PROVIDER_DEFAULTS={defaultCapacity:10,defaultDepartureTime:"17:00",departureLocation:{name:"Ayla Marina",address:"Aqaba, Jordan",googleMapsUrl:"https://maps.app.goo.gl/oDBcHhKdzih9Y2RU8?g_st=ic"}};
export const SEA_BREEZE_PILOT_TRIP={titleAr:"رحلة غروب الشمس",titleEn:"Sunset Cruise",vesselName:TARGET_VESSEL,category:"sunset",durationMinutes:120,pricing:{currency:"JOD",pricePerPerson:15,adultPrice:15,childPrice:10,buffetEnabled:true,buffetAdultPrice:17,buffetChildPrice:12,commissionType:"fixed_per_person",commissionValue:3,adultCommission:3,childCommission:2,buffetAdultCommission:3,buffetChildCommission:2},departureLocation:{...SEA_BREEZE_PROVIDER_DEFAULTS.departureLocation},active:true};

export function getAladdinActivationGate(){
 return {allowed:false,reason:"operator_confirmation_required"};
}

export function resolveSeaBreezeDefaultDepartureTime(current){const value=String(current||"").trim();return !value||value==="09:00"?SEA_BREEZE_PROVIDER_DEFAULTS.defaultDepartureTime:value;}
export function isSeaBreezeSunsetCandidate({providerName="",trip={}}={}){return SEA_BREEZE_PROVIDER_RE.test(String(providerName))&&String(trip.category||"")==="sunset"&&Number(trip.durationMinutes)===120&&AYLA_RE.test(String(trip.departureLocation?.name||""))&&(SUNSET_RE.test(String(trip.titleEn||""))||SUNSET_RE.test(String(trip.titleAr||"")));}

async function ensureSeaBreezeProviderDefaults(provider){
 if(!provider)return {updated:false};const current=provider.settings||{};const departure=current.departureLocation||{};const defaultDepartureTime=resolveSeaBreezeDefaultDepartureTime(current.defaultDepartureTime);const desiredLocation=SEA_BREEZE_PROVIDER_DEFAULTS.departureLocation;
 const settingsChanged=current.configured!==true||Number(current.defaultCapacity)!==10||String(current.defaultDepartureTime||"")!==defaultDepartureTime||String(departure.name||"")!==desiredLocation.name||String(departure.address||"")!==desiredLocation.address||String(departure.googleMapsUrl||"")!==desiredLocation.googleMapsUrl;const statusChanged=provider.status!=="approved";
 if(!settingsChanged&&!statusChanged)return {updated:false,defaultDepartureTime,statusUpdated:false};if(settingsChanged)provider.settings={configured:true,defaultCapacity:10,defaultDepartureTime,departureLocation:{...desiredLocation}};if(statusChanged)provider.status="approved";await provider.save();console.log(`Real Pilot Data: Sea Breeze provider customer visibility approved=${provider.status==="approved"}`);return {updated:true,defaultDepartureTime,statusUpdated:statusChanged};
}
function safeTripDiagnostic(trip,providerName){return {id:String(trip._id),providerName:String(providerName||""),titleEn:String(trip.titleEn||""),titleAr:String(trip.titleAr||""),category:String(trip.category||""),durationMinutes:Number(trip.durationMinutes||0),departureName:String(trip.departureLocation?.name||""),vesselName:String(trip.vesselName||""),active:Boolean(trip.active)};}
async function applySeaBreezePilot(){
 const providers=await Provider.find({businessName:SEA_BREEZE_PROVIDER_RE});if(providers.length!==1){console.warn(`Real Pilot Data: expected exactly one Sea Breeze / Aquamarina provider, found ${providers.length}; no changes applied`);return {applied:false,reason:providers.length?"ambiguous_provider":"provider_not_found",providerCount:providers.length};}
 const provider=providers[0];const settingsResult=await ensureSeaBreezeProviderDefaults(provider);const providerTrips=await Trip.find({providerId:provider._id});if(providerTrips.length===0){const created=await Trip.create({...SEA_BREEZE_PILOT_TRIP,providerId:provider._id});console.log(`Real Pilot Data: created active Sea Breeze Sunset Cruise ${created._id}`);return {applied:true,action:"created_trip",tripId:String(created._id)};}
 const candidates=providerTrips.filter(trip=>isSeaBreezeSunsetCandidate({providerName:provider.businessName,trip}));if(candidates.length!==1){console.warn(`Real Pilot Data: expected exactly one Sea Breeze sunset candidate, found ${candidates.length}`);console.warn(`Real Pilot Data diagnostic: ${JSON.stringify(providerTrips.map(t=>safeTripDiagnostic(t,provider.businessName)))}`);return {applied:settingsResult.updated,reason:"ambiguous_candidate",candidateCount:candidates.length};}
 const trip=candidates[0];const current=String(trip.vesselName||"").trim();const allowed=new Set(["",TARGET_VESSEL,LEGACY_SEA_BREEZE_VESSEL]);if(!allowed.has(current))return {applied:settingsResult.updated,reason:"existing_value_conflict",tripId:String(trip._id)};let tripUpdated=false;if(current!==TARGET_VESSEL){trip.vesselName=TARGET_VESSEL;tripUpdated=true;}if(trip.active!==true){trip.active=true;tripUpdated=true;}if(tripUpdated)await trip.save();return {applied:settingsResult.updated||tripUpdated,reason:tripUpdated?"updated_visibility":"already_visible",tripId:String(trip._id)};
}
async function applyFunNSunVesselBackfill(){const providers=await Provider.find({businessName:FUN_N_SUN_PROVIDER_RE});if(providers.length!==1)return {applied:false,reason:providers.length?"ambiguous_provider":"provider_not_found",providerCount:providers.length};const provider=providers[0];const trips=await Trip.find({providerId:provider._id}).sort({createdAt:1});if(trips.length!==3)return {applied:false,reason:"unexpected_trip_count",tripCount:trips.length};const conflicts=trips.filter(t=>{const current=String(t.vesselName||"").trim();return current&&current!==FUN_N_SUN_VESSEL;});if(conflicts.length)return {applied:false,reason:"existing_value_conflict",conflictCount:conflicts.length};let updated=0;for(const trip of trips){if(String(trip.vesselName||"").trim()===FUN_N_SUN_VESSEL)continue;trip.vesselName=FUN_N_SUN_VESSEL;await trip.save();updated+=1;}return {applied:updated>0,reason:updated?"updated_vessels":"already_applied",tripCount:trips.length,updatedCount:updated};}

async function applyAladdinPilot(){
 const gate=getAladdinActivationGate();
 console.warn(`Real Pilot Data: Aladdin activation blocked: ${gate.reason}`);
 return {applied:false,skipped:true,reason:gate.reason};
}

export async function applyRealPilotData(){if(process.env.APPLY_REAL_PILOT_DATA!=="true")return {skipped:true,reason:"disabled"};const seaBreeze=await applySeaBreezePilot();const funNSun=await applyFunNSunVesselBackfill();const aladdin=await applyAladdinPilot();return {applied:Boolean(seaBreeze?.applied||funNSun?.applied||aladdin?.applied),seaBreeze,funNSun,aladdin};}