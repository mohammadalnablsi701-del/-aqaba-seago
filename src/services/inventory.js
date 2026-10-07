import mongoose from "mongoose";
import CheckoutHold from "../models/CheckoutHold.js";
import Departure from "../models/Departure.js";
import Payment from "../models/Payment.js";

// Used by expiration, checkout rejection and departure cancellation. A supplied
// session lets payment webhooks include the release in their own transaction.
export async function releaseCheckoutHold(holdId, {status="released", session, expiredBefore}={}) {
  const owned=!session;
  const tx=session||await mongoose.startSession();
  let released=false;
  async function release(){
    released=false;
    const claimed=await CheckoutHold.findOneAndUpdate(
      {_id:holdId,status:"active",...(expiredBefore?{expiresAt:{$lte:expiredBefore}}:{})},
      {$set:{status}}, {new:true,session:tx}
    );
    if(!claimed)return;
    const paid=await Payment.exists({holdId:claimed._id,status:{$in:["paid","partially_refunded","refunded"]}}).session(tx);
    if(paid)throw Object.assign(new Error("Paid checkout inventory requires reconciliation"),{statusCode:409});
    const seats=Number(claimed.seats);
    const result=await Departure.updateOne(
      {_id:claimed.departureId,reservedSeats:{$gte:seats}},
      {$inc:{reservedSeats:-seats}}, {session:tx}
    );
    if(result.modifiedCount!==1)throw Object.assign(new Error("Reserved seats require reconciliation"),{statusCode:409});
    await Payment.updateMany(
      {holdId:claimed._id,status:{$in:["created","pending"]}},
      {$set:{status:status==="expired"?"expired":"cancelled",failedAt:new Date()}}, {session:tx}
    );
    released=true;
  }
  try{
    if(owned)await tx.withTransaction(release);else await release();
    return released;
  }finally{if(owned)await tx.endSession()}
}
