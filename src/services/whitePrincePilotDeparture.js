import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";

export async function createWhitePrincePilotDepartureOnce(){
  if(process.env.CREATE_WHITE_PRINCE_PILOT!=="true") return null;

  const provider=await Provider.findOne({businessName:"Fun N Sun"});
  if(!provider) return {ok:false,skipped:"provider_not_found"};

  const trip=await Trip.findOne({providerId:provider._id,titleEn:"White Prince Swimming Cruise"});
  if(!trip) return {ok:false,skipped:"trip_not_found"};

  // 2026-10-05 14:00 in Jordan (UTC+3)
  const startsAt=new Date("2026-10-05T11:00:00.000Z");

  const existing=await Departure.findOne({tripId:trip._id,startsAt});
  if(existing){
    return {
      ok:true,
      created:false,
      departureId:existing._id,
      tripId:trip._id,
      startsAt:existing.startsAt,
      capacity:existing.capacity,
      reservedSeats:existing.reservedSeats,
      salesClosed:Boolean(existing.salesClosed),
      status:existing.status
    };
  }

  const departure=await Departure.create({
    tripId:trip._id,
    startsAt,
    capacity:1,
    reservedSeats:0,
    salesClosed:false,
    status:"scheduled"
  });

  return {
    ok:true,
    created:true,
    departureId:departure._id,
    tripId:trip._id,
    startsAt:departure.startsAt,
    capacity:departure.capacity,
    reservedSeats:departure.reservedSeats,
    salesClosed:Boolean(departure.salesClosed),
    status:departure.status
  };
}
