import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import Departure from "../models/Departure.js";

export function cancellationPolicyFor(startsAt, now = new Date()) {
  const hours = (new Date(startsAt).getTime() - now.getTime()) / 3600000;
  if (hours >= 24) return { hoursBeforeDeparture: hours, refundPercentage: 100 };
  if (hours >= 12) return { hoursBeforeDeparture: hours, refundPercentage: 50 };
  return { hoursBeforeDeparture: hours, refundPercentage: 0 };
}

async function applyMockRefund(payment, refundAmount) {
  const total = Number(payment?.amount || 0);
  const amount = Math.max(0, Math.min(Number(refundAmount || 0), total));
  if (!payment || amount <= 0) return { status: "none", amount: 0, reference: null };

  if (payment.provider !== "mock") {
    payment.status = "needs_review";
    await payment.save();
    return { status: "pending", amount, reference: null };
  }

  payment.refundedAmount = Number((Number(payment.refundedAmount || 0) + amount).toFixed(2));
  payment.refundedAt = new Date();
  payment.refundReference = `mock_refund_${payment._id}_${Date.now()}`;
  payment.status = payment.refundedAmount >= total ? "refunded" : "partially_refunded";
  await payment.save();

  return { status: "processed", amount, reference: payment.refundReference };
}

export async function cancelBooking({ bookingId, source, reason = "", customerId = null, providerId = null, forceFullRefund = false }) {
  const booking = await Booking.findOneAndUpdate(
    {
      _id: bookingId,
      status: "confirmed",
      ...(customerId ? { customerId } : {}),
      ...(providerId ? { providerId } : {})
    },
    { $set: { status: "cancelled" } },
    { new: true }
  ).populate("departureId", "startsAt status");

  if (!booking) {
    const existing = await Booking.findById(bookingId);
    if (!existing) throw Object.assign(new Error("Booking not found"), { statusCode: 404 });
    if (existing.status !== "confirmed") {
      throw Object.assign(new Error("Booking is no longer cancellable"), { statusCode: 409 });
    }
    throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  }

  const dep = booking.departureId;
  const policy = forceFullRefund
    ? { hoursBeforeDeparture: dep?.startsAt ? (new Date(dep.startsAt).getTime() - Date.now()) / 3600000 : 0, refundPercentage: 100 }
    : cancellationPolicyFor(dep?.startsAt || new Date());

  const gross = Number(booking.pricing?.grossAmount || 0);
  const refundAmount = Number((gross * policy.refundPercentage / 100).toFixed(2));

  const payment = await Payment.findOne({ bookingId: booking._id });
  const refund = await applyMockRefund(payment, refundAmount);

  booking.cancellation = {
    source,
    reason: String(reason || "").trim().slice(0,500),
    cancelledAt: new Date(),
    hoursBeforeDeparture: Number(policy.hoursBeforeDeparture.toFixed(2)),
    refundPercentage: policy.refundPercentage,
    refundAmount,
    refundStatus: refund.status
  };
  await booking.save();

  await Departure.updateOne(
    { _id: booking.departureId?._id || booking.departureId, reservedSeats: { $gte: booking.seats } },
    { $inc: { reservedSeats: -Number(booking.seats || 0) } }
  );

  return {
    booking,
    policy: {
      hoursBeforeDeparture: Number(policy.hoursBeforeDeparture.toFixed(2)),
      refundPercentage: policy.refundPercentage
    },
    refund
  };
}

export async function cancelDepartureBookings({ departureId, providerId, reason = "Departure cancelled by provider" }) {
  const bookings = await Booking.find({ departureId, providerId, status: "confirmed" }).select("_id");
  const results = [];
  for (const b of bookings) {
    try {
      results.push(await cancelBooking({
        bookingId: b._id,
        providerId,
        source: "provider",
        reason,
        forceFullRefund: true
      }));
    } catch (e) {
      if (e.statusCode !== 409) throw e;
    }
  }
  return results;
}
