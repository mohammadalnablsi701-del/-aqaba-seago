import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";

const SEA_BREEZE_PROVIDER_RE=/(sea\s*breeze|aqua\s*marina|aquamarina)/i;
const AYLA_RE=/(ayla|أيلة)/i;
const SUNSET_RE=/(sunset|غروب)/i;
const TARGET_VESSEL="بريز الخشبي";

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
  departureLocation:{
    name:"Ayla Marina",
    address:"Aqaba, Jordan",
    googleMapsUrl:"https://maps.app.goo.gl/oDBcHhKdzih9Y2RU8?g_st=ic"
  },
  active:true
};

export function isSeaBreezeSunsetCandidate({providerName="",trip={}}={}){
  return SEA_BREEZE_PROVIDER_RE.test(String(providerName))
    && String(trip.category||"")==="sunset"
    && Number(trip.durationMinutes)===120
    && AYLA_RE.test(String(trip.departureLocation?.name||""))
    && (SUNSET_RE.test(String(trip.titleEn||""))||SUNSET_RE.test(String(trip.titleAr||"")));
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

export async function applyRealPilotData(){
  if(process.env.APPLY_REAL_PILOT_DATA!=="true")return {skipped:true,reason:"disabled"};

  const providers=await Provider.find({businessName:SEA_BREEZE_PROVIDER_RE}).select("_id businessName");
  if(!providers.length){
    console.warn("Real Pilot Data: no Sea Breeze / Aquamarina provider found; no changes applied");
    return {applied:false,reason:"provider_not_found"};
  }

  const providerById=new Map(providers.map(p=>[String(p._id),p.businessName]));
  const providerTrips=await Trip.find({providerId:{$in:providers.map(p=>p._id)}});

  if(providerTrips.length===0){
    if(providers.length!==1){
      console.warn(`Real Pilot Data: found ${providers.length} Sea Breeze / Aquamarina providers and no trips; refusing to choose a provider automatically`);
      console.warn(`Real Pilot Data providers: ${JSON.stringify(providers.map(p=>({id:String(p._id),businessName:String(p.businessName||"")})))}`);
      return {applied:false,reason:"ambiguous_provider",providerCount:providers.length};
    }
    const created=await Trip.create({...SEA_BREEZE_PILOT_TRIP,providerId:providers[0]._id});
    console.log(`Real Pilot Data: created Sea Breeze Sunset Cruise ${created._id} with vesselName=${JSON.stringify(TARGET_VESSEL)}`);
    return {applied:true,action:"created_trip",tripId:String(created._id),vesselName:TARGET_VESSEL};
  }

  const candidates=providerTrips.filter(trip=>isSeaBreezeSunsetCandidate({
    providerName:providerById.get(String(trip.providerId))||"",
    trip
  }));

  if(candidates.length!==1){
    const diagnostic=providerTrips.map(trip=>safeTripDiagnostic(trip,providerById.get(String(trip.providerId))));
    console.warn(`Real Pilot Data: expected exactly one Sea Breeze sunset candidate, found ${candidates.length}; no changes applied`);
    console.warn(`Real Pilot Data diagnostic: ${JSON.stringify(diagnostic)}`);
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
  return {applied:true,action:"updated_vessel",tripId:String(trip._id),vesselName:TARGET_VESSEL};
}
