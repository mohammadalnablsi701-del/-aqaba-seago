import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import Departure from "../models/Departure.js";
import { sendCancellationNotice } from "./notifications.js";

export function cancellationPolicyFor(startsAt, now = new Date()) {
  const hours = (new Date(startsAt).getTime() - now.getTime()) / 3600000;
  if (hours >= 24) return { hoursBeforeDeparture: hours, refundPercentage: 100 };
  if (hours >= 12) return { hoursBeforeDeparture: hours, refundPercentage: 50 };
  return { hoursBeforeDeparture: hours, refundPercentage: 0 };
}

export function customerCancellationEligibility(booking) {
  if (!booking || booking.status !== "confirmed") return { eligible: false, reason: "not_confirmed" };
  if (booking.checkedInAt) return { eligible: false, reason: "checked_in" };
  const departure = booking.departureId;
  if (!departure) return { eligible: false, reason: "departure_unavailable" };
  if (departure.status !== "scheduled") return { eligible: false, reason: "departure_not_scheduled" };
  return { eligible: true, reason: null };
}

function customerCancellationError(reason) {
  if (reason === "checked_in") return "Checked-in bookings cannot be cancelled";
  return "This booking can no longer be cancelled";
}

async function applyMockRefund(payment, refundAmount, session) {
  const total = Number(payment?.amount || 0);
  const remaining=Math.max(0,total-Number(payment?.refundedAmount||0));
  const amount = Math.max(0, Math.min(Number(refundAmount || 0), remaining));
  if (!payment || amount <= 0) return { status: "none", amount: 0, reference: null };
  if (payment.provider !== "mock") {
    // A real gateway refund remains a pending operational task. Never call an
    // external provider from a transaction callback that MongoDB can retry.
    payment.status = "needs_review";
    await payment.save({session});
    return { status: "pending", amount, reference: null };
  }
  payment.refundedAmount = Number((Number(payment.refundedAmount || 0) + amount).toFixed(2));
  payment.refundedAt = new Date();
  payment.refundReference = `mock_refund_${payment._id}_${Date.now()}`;
  payment.status = payment.refundedAmount >= total ? "refunded" : "partially_refunded";
  await payment.save({session});
  return { status: "processed", amount, reference: payment.refundReference };
}

function cancellationResult(booking, reference=null) {
  const c=booking.cancellation;
  return {booking,policy:{hoursBeforeDeparture:c.hoursBeforeDeparture,refundPercentage:c.refundPercentage},
    refund:{status:c.refundStatus,amount:c.refundAmount,reference}};
}

export async function cancelBooking({ bookingId, source, reason = "", customerId = null, providerId = null, forceFullRefund = false }) {
  const session=await mongoose.startSession();
  let result;
  try{
    await session.withTransaction(async()=>{
      const booking=await Booking.findOne({_id:bookingId,
        ...(customerId?{customerId}:{}),...(providerId?{providerId}:{})
      }).session(session).populate("departureId","startsAt status");
      if(!booking)throw Object.assign(new Error("Booking not found"),{statusCode:404});
      if(booking.status==="cancelled"&&booking.cancellation?.cancelledAt){
        result=cancellationResult(booking);
        return;
      }
      const dep=booking.departureId;
      if(source==="customer"){
        const eligibility=customerCancellationEligibility(booking);
        if(!eligibility.eligible){
          throw Object.assign(new Error(customerCancellationError(eligibility.reason)),{statusCode:409});
        }
      }else{
        if(booking.status!=="confirmed")throw Object.assign(new Error("Booking requires cancellation review"),{statusCode:409});
        if(!dep)throw Object.assign(new Error("Departure requires reconciliation"),{statusCode:409});
      }
      const policy=forceFullRefund
        ? {hoursBeforeDeparture:(new Date(dep.startsAt).getTime()-Date.now())/3600000,refundPercentage:100}
        : cancellationPolicyFor(dep.startsAt);
      const refundAmount=Number((Number(booking.pricing?.grossAmount||0)*policy.refundPercentage/100).toFixed(2));
      const payment=await Payment.findOne({bookingId:booking._id}).session(session);
      if(refundAmount>0&&!payment)throw Object.assign(new Error("Payment requires reconciliation before cancellation"),{statusCode:409});
      const refund=await applyMockRefund(payment,refundAmount,session);
      booking.status="cancelled";
      booking.cancellation={source,reason:String(reason||"").trim().slice(0,500),cancelledAt:new Date(),
        hoursBeforeDeparture:Number(policy.hoursBeforeDeparture.toFixed(2)),refundPercentage:policy.refundPercentage,
        refundAmount:refund.amount,refundStatus:refund.status};
      await booking.save({session});
      const inventory=await Departure.updateOne(
        {_id:dep._id,reservedSeats:{$gte:booking.seats}},
        {$inc:{reservedSeats:-Number(booking.seats)}},{session}
      );
      if(inventory.modifiedCount!==1)throw Object.assign(new Error("Reserved seats require reconciliation"),{statusCode:409});
      result=cancellationResult(booking,refund.reference);
    });
  }finally{await session.endSession()}
  // Safe to retry after commit: notification keys use the persisted cancelledAt.
  // Delivery failure must not change a successfully committed cancellation.
  try{await sendCancellationNotice(result.booking._id)}
  catch(err){console.error("Cancellation notification failed",err)}
  return result;
}

export async function cancelDepartureBookings({ departureId, providerId, reason = "Departure cancelled by provider" }) {
  const bookings = await Booking.find({ departureId, providerId, status: "confirmed" }).select("_id");
  const results = [];
  for (const b of bookings) {
    // Do not hide reconciliation errors as success. The departure stays closed;
    // repeating its cancellation resumes the remaining confirmed bookings.
    results.push(await cancelBooking({bookingId:b._id,providerId,source:"provider",reason,forceFullRefund:true}));
  }
  return results;
}
