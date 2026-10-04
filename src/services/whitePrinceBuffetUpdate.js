import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";

export async function updateWhitePrinceBuffetPricingOnce(){
  if(process.env.UPDATE_WHITE_PRINCE_BUFFET!=="true") return null;

  const provider=await Provider.findOne({businessName:"Fun N Sun"});
  if(!provider) return {ok:false,skipped:"provider_not_found"};

  const trip=await Trip.findOne({providerId:provider._id,titleEn:"White Prince Swimming Cruise"});
  if(!trip) return {ok:false,skipped:"trip_not_found"};

  trip.pricing.pricePerPerson=15;
  trip.pricing.adultPrice=15;
  trip.pricing.childPrice=10;
  trip.pricing.buffetEnabled=true;
  trip.pricing.buffetAdultPrice=20;
  trip.pricing.buffetChildPrice=15;
  trip.pricing.buffetDescription="Open buffet package";
  trip.pricing.commissionType="fixed_per_person";
  trip.pricing.commissionValue=3;
  trip.pricing.adultCommission=3;
  trip.pricing.childCommission=2;
  trip.pricing.buffetAdultCommission=5;
  trip.pricing.buffetChildCommission=3;

  await trip.save();

  return {
    ok:true,
    tripId:trip._id,
    titleEn:trip.titleEn,
    pricing:{
      adultPrice:trip.pricing.adultPrice,
      childPrice:trip.pricing.childPrice,
      buffetEnabled:trip.pricing.buffetEnabled,
      buffetAdultPrice:trip.pricing.buffetAdultPrice,
      buffetChildPrice:trip.pricing.buffetChildPrice,
      adultCommission:trip.pricing.adultCommission,
      childCommission:trip.pricing.childCommission,
      buffetAdultCommission:trip.pricing.buffetAdultCommission,
      buffetChildCommission:trip.pricing.buffetChildCommission
    }
  };
}
