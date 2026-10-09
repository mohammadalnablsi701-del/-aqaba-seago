import mongoose from "mongoose";
import CheckoutHold from "../models/CheckoutHold.js";
import Departure from "../models/Departure.js";
import Trip from "../models/Trip.js";
import Provider from "../models/Provider.js";
import Payment from "../models/Payment.js";
import { calculateTieredPricing } from "./pricing.js";
import { isProviderPilotSalesAllowed } from "./pilotGuard.js";

function verifyRequest(hold,{departureId,adults,children,mealPlan}) {
  if(String(hold.departureId)!==String(departureId)||hold.adults!==adults||hold.children!==children||hold.mealPlan!==mealPlan)
    throw Object.assign(new Error("Idempotency-Key already used for a different checkout"),{statusCode:409});
  return hold;
}

export async function reserveCheckout({customerId,key,departureId,adults,children,mealPlan}) {
  const request={departureId,adults,children,mealPlan};
  const session=await mongoose.startSession();
  let hold;
  try {
    await session.withTransaction(async()=>{
      hold=await CheckoutHold.findOne({customerId,idempotencyKey:key}).session(session);
      if(hold){verifyRequest(hold,request);return;}
      const seats=adults+children;
      const departure=await Departure.findOneAndUpdate({
        _id:departureId,status:"scheduled",salesClosed:{$ne:true},startsAt:{$gt:new Date()},
        $expr:{$lte:[{$add:["$reservedSeats",seats]},"$capacity"]}
      },{$inc:{reservedSeats:seats}},{new:true,session});
      if(!departure)throw Object.assign(new Error("Departure unavailable or not enough seats"),{statusCode:409});
      const trip=await Trip.findOne({_id:departure.tripId,active:true}).session(session);
      const provider=trip&&await Provider.findOne({_id:trip.providerId,status:"approved"}).select("businessName").session(session);
      if(!provider||!isProviderPilotSalesAllowed(provider.businessName))throw Object.assign(new Error("Trip unavailable"),{statusCode:409});
      const pricing=calculateTieredPricing({pricing:trip.pricing,adults,children,mealPlan});
      const minutes=Number(process.env.BOOKING_HOLD_MINUTES||5);
      [hold]=await CheckoutHold.create([{
        customerId,providerId:trip.providerId,tripId:trip._id,departureId:departure._id,
        seats,adults,children,mealPlan,pricing,idempotencyKey:key,
        expiresAt:new Date(Date.now()+minutes*60000)
      }],{session});
      // Persist the payment identity with inventory; gateway calls stay outside
      // the callback because a transaction may be retried by MongoDB.
      const paymentId=new mongoose.Types.ObjectId();
      await Payment.create([{
        _id:paymentId,externalPaymentId:`pending_${paymentId}`,
        holdId:hold._id,customerId,provider:process.env.PAYMENT_PROVIDER||"mock",
        amount:pricing.grossAmount,currency:pricing.currency||"JOD"
      }],{session});
    });
    return hold;
  }catch(error){
    // Concurrent requests on different departures can hit the customer/key
    // unique index. The losing transaction has already rolled back its seats.
    if(error?.code===11000){
      const existing=await CheckoutHold.findOne({customerId,idempotencyKey:key});
      if(existing)return verifyRequest(existing,request);
    }
    throw error;
  }finally{await session.endSession()}
}
