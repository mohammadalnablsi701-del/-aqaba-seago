import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";

// Sea Breeze / Aquamarina has an explicitly agreed fixed per-person commission
// and is corrected separately. Keep this legacy 20% migration scoped to the
// pilot providers that still use percentage commission.
const PILOT_PROVIDER_RE=/(fun\s*(?:n|&|and)\s*sun|aladdin|alaa\s*aldeen|علاء\s*الدين)/i;

export async function applyCommission20Migration(){
  if(process.env.APPLY_COMMISSION_20_MIGRATION!=="true")return {skipped:true,reason:"disabled"};

  const providers=await Provider.find({businessName:PILOT_PROVIDER_RE}).select("_id businessName");
  const providerIds=providers.map(p=>p._id);
  if(!providerIds.length)return {applied:false,reason:"pilot_providers_not_found",updated:0};

  const trips=await Trip.find({providerId:{$in:providerIds}});
  let updated=0;
  for(const trip of trips){
    trip.set("pricing.commissionType","percentage");
    trip.set("pricing.commissionValue",20);
    trip.set("pricing.adultCommission",undefined);
    trip.set("pricing.childCommission",undefined);
    trip.set("pricing.buffetAdultCommission",undefined);
    trip.set("pricing.buffetChildCommission",undefined);
    await trip.save();
    updated+=1;
  }

  console.log(`Commission migration: set ${updated} percentage-based pilot trip(s) to 20% of booking gross`);
  return {applied:true,updated,providerCount:providers.length};
}
