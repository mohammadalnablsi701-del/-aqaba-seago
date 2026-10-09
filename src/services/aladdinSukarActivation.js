import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";

const ALADDIN_PROVIDER_RE=/(aladdin|alaa\s*aldeen|علاء\s*الدين)/i;
const SUKAR_RE=/^sukar$/i;

export async function activateAladdinSukar(){
  const providers=await Provider.find({businessName:ALADDIN_PROVIDER_RE}).select("_id businessName");
  if(providers.length!==1){
    throw new Error(`Aladdin Sukar activation expected exactly one provider, found ${providers.length}`);
  }

  const provider=providers[0];
  const trips=await Trip.find({
    providerId:provider._id,
    titleEn:SUKAR_RE,
    vesselName:SUKAR_RE
  });
  if(trips.length!==1){
    throw new Error(`Aladdin Sukar activation expected exactly one matching trip, found ${trips.length}`);
  }

  const trip=trips[0];
  const wasActive=trip.active===true;
  if(!wasActive){
    trip.active=true;
    await trip.save();
  }

  return {
    providerId:String(provider._id),
    providerName:String(provider.businessName||""),
    tripId:String(trip._id),
    tripTitle:String(trip.titleEn||""),
    active:true,
    changed:!wasActive
  };
}
