import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import User from "../models/User.js";

const PROVIDER_RE=/(sea\s*breeze|aqua\s*marina|aquamarina)/i;
const SUNSET_RE=/(sunset|غروب)/i;
const AYLA_RE=/(ayla|أيلة)/i;
const OFFICIAL_EMAIL="info@aquamarina-aqaba.com";
const CURRENT_OWNER_EMAIL="seabreeze@aqabaseago.com";
const LEGACY_TEST_EMAIL="seabreeze@providers.seago.test";

export const SEA_BREEZE_FIXED_PRICING={
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
};

function isTargetTrip(trip){
  return String(trip.category||"")==="sunset"&&Number(trip.durationMinutes)===120&&
    AYLA_RE.test(String(trip.departureLocation?.name||""))&&
    (SUNSET_RE.test(String(trip.titleEn||""))||SUNSET_RE.test(String(trip.titleAr||"")));
}

async function correctProviderAccess(provider){
  const currentOwner=provider.ownerUserId?await User.findById(provider.ownerUserId):null;
  let official=await User.findOne({email:OFFICIAL_EMAIL});

  if(official){
    const otherProvider=await Provider.findOne({_id:{$ne:provider._id},ownerUserId:official._id}).select("_id businessName");
    if(otherProvider)return {updated:false,reason:"official_user_owned_by_other_provider"};
    official.name="Sea Breeze / Aquamarina";
    official.role="provider";
    official.isActive=true;
    await official.save();
    if(String(provider.ownerUserId||"")!==String(official._id)){
      provider.ownerUserId=official._id;
      await provider.save();
    }
    if(currentOwner&&String(currentOwner._id)!==String(official._id)&&String(currentOwner.email||"").toLowerCase()===CURRENT_OWNER_EMAIL){
      currentOwner.isActive=false;
      currentOwner.authVersion=Number(currentOwner.authVersion||0)+1;
      await currentOwner.save();
    }
  }else{
    if(!currentOwner||String(currentOwner.email||"").toLowerCase()!==CURRENT_OWNER_EMAIL){
      return {updated:false,reason:"unexpected_current_owner"};
    }
    currentOwner.name="Sea Breeze / Aquamarina";
    currentOwner.email=OFFICIAL_EMAIL;
    currentOwner.role="provider";
    currentOwner.isActive=true;
    currentOwner.authVersion=Number(currentOwner.authVersion||0)+1;
    await currentOwner.save();
    official=currentOwner;
  }

  const legacy=await User.findOne({email:LEGACY_TEST_EMAIL});
  if(legacy&&String(legacy._id)!==String(official._id)&&legacy.isActive!==false){
    legacy.isActive=false;
    legacy.authVersion=Number(legacy.authVersion||0)+1;
    await legacy.save();
  }
  return {updated:true,ownerUserId:String(official._id),email:OFFICIAL_EMAIL};
}

async function correctTripPricing(provider){
  const trips=await Trip.find({providerId:provider._id});
  const candidates=trips.filter(isTargetTrip);
  if(candidates.length!==1)return {updated:false,reason:"ambiguous_sunset_trip",candidateCount:candidates.length};
  const trip=candidates[0];
  for(const [key,value] of Object.entries(SEA_BREEZE_FIXED_PRICING))trip.set(`pricing.${key}`,value);
  await trip.save();
  return {updated:true,tripId:String(trip._id)};
}

export async function applySeaBreezeCorrection(){
  if(process.env.APPLY_REAL_PILOT_DATA!=="true")return {skipped:true,reason:"disabled"};
  const providers=await Provider.find({businessName:PROVIDER_RE});
  if(providers.length!==1)return {applied:false,reason:providers.length?"ambiguous_provider":"provider_not_found",providerCount:providers.length};
  const provider=providers[0];
  const access=await correctProviderAccess(provider);
  const pricing=await correctTripPricing(provider);
  const applied=Boolean(access.updated||pricing.updated);
  console.log(`Sea Breeze correction: access=${access.reason||"ok"}, pricing=${pricing.reason||"ok"}`);
  return {applied,access,pricing};
}
