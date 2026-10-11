import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import Refund from "../models/Refund.js";
import Departure from "../models/Departure.js";
import { sendCancellationNotice } from "./notifications.js";
import {
  createRefundIntentInSession,
  customerRefundStatusForState,
  executeRefundIntent,
  refundReferenceFor
} from "./refunds.js";

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

function cancellationResult(booking, reference = null) {
  const c = booking.cancellation;
  return {
    booking,
    policy: { hoursBeforeDeparture: c.hoursBeforeDeparture, refundPercentage: c.refundPercentage },
    refund: { status: c.refundStatus, amount: c.refundAmount, reference }
  };
}

async function existingCancellationRefundReference({ booking, session }) {
  if (Number(booking.cancellation?.refundAmount || 0) <= 0) return null;
  const payment = await Payment.findOne({ bookingId: booking._id }).session(session).select("_id");
  if (!payment) return null;
  const reference = refundReferenceFor({
    paymentId: payment._id,
    intentType: "booking_cancellation",
    intentId: booking._id
  });
  const exists = await Refund.exists({ reference }).session(session);
  return exists ? reference : null;
}

export async function cancelBooking({ bookingId, source, reason = "", customerId = null, providerId = null, forceFullRefund = false }) {
  const session = await mongoose.startSession();
  let result;
  let refundReference = null;
  try {
    await session.withTransaction(async () => {
      const booking = await Booking.findOne({
        _id: bookingId,
        ...(customerId ? { customerId } : {}),
        ...(providerId ? { providerId } : {})
      }).session(session).populate("departureId", "startsAt status");
      if (!booking) throw Object.assign(new Error("Booking not found"), { statusCode: 404 });

      if (booking.status === "cancelled" && booking.cancellation?.cancelledAt) {
        refundReference = await existingCancellationRefundReference({ booking, session });
        result = cancellationResult(booking, refundReference);
        return;
      }

      const dep = booking.departureId;
      if (source === "customer") {
        const eligibility = customerCancellationEligibility(booking);
        if (!eligibility.eligible) {
          throw Object.assign(new Error(customerCancellationError(eligibility.reason)), { statusCode: 409 });
        }
      } else {
        if (booking.status !== "confirmed") throw Object.assign(new Error("Booking requires cancellation review"), { statusCode: 409 });
        if (!dep) throw Object.assign(new Error("Departure requires reconciliation"), { statusCode: 409 });
      }

      const policy = forceFullRefund
        ? { hoursBeforeDeparture: (new Date(dep.startsAt).getTime() - Date.now()) / 3600000, refundPercentage: 100 }
        : cancellationPolicyFor(dep.startsAt);
      const refundAmount = Number((Number(booking.pricing?.grossAmount || 0) * policy.refundPercentage / 100).toFixed(2));
      const payment = await Payment.findOne({ bookingId: booking._id }).session(session);
      if (refundAmount > 0 && !payment) {
        throw Object.assign(new Error("Payment requires reconciliation before cancellation"), { statusCode: 409 });
      }

      let refund = null;
      if (refundAmount > 0) {
        refund = await createRefundIntentInSession({
          payment,
          bookingId: booking._id,
          amount: refundAmount,
          currency: booking.pricing?.currency || payment.currency || "JOD",
          intentType: "booking_cancellation",
          intentId: booking._id,
          session
        });
        refundReference = refund.reference;
      }

      booking.status = "cancelled";
      booking.cancellation = {
        source,
        reason: String(reason || "").trim().slice(0, 500),
        cancelledAt: new Date(),
        hoursBeforeDeparture: Number(policy.hoursBeforeDeparture.toFixed(2)),
        refundPercentage: policy.refundPercentage,
        refundAmount,
        refundStatus: refund ? customerRefundStatusForState(refund.state) : "none"
      };
      await booking.save({ session });

      const inventory = await Departure.updateOne(
        { _id: dep._id, reservedSeats: { $gte: booking.seats } },
        { $inc: { reservedSeats: -Number(booking.seats) } },
        { session }
      );
      if (inventory.modifiedCount !== 1) {
        throw Object.assign(new Error("Reserved seats require reconciliation"), { statusCode: 409 });
      }
      result = cancellationResult(booking, refundReference);
    });
  } finally {
    await session.endSession();
  }

  // Provider money movement is intentionally outside MongoDB's retryable
  // transaction callback. The Refund identity and reservation are already durable.
  if (refundReference) {
    try {
      await executeRefundIntent({ refundReference });
    } catch (error) {
      console.error(JSON.stringify({
        event: "refund_execution_deferred",
        refundReference,
        message: String(error?.message || "Refund execution deferred").slice(0, 160),
        at: new Date().toISOString()
      }));
    }
    const refreshed = await Booking.findById(result.booking._id).populate("departureId", "startsAt status");
    if (refreshed) result = cancellationResult(refreshed, refundReference);
  }

  try { await sendCancellationNotice(result.booking._id); }
  catch (err) { console.error("Cancellation notification failed", err); }
  return result;
}

export async function cancelDepartureBookings({ departureId, providerId, reason = "Departure cancelled by provider" }) {
  const bookings = await Booking.find({ departureId, providerId, status: "confirmed" }).select("_id");
  const results = [];
  for (const b of bookings) {
    // Do not hide reconciliation errors as success. The departure stays closed;
    // repeating its cancellation resumes the remaining confirmed bookings.
    results.push(await cancelBooking({ bookingId: b._id, providerId, source: "provider", reason, forceFullRefund: true }));
  }
  return results;
}
