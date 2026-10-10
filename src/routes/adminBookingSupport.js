import express from "express";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import User from "../models/User.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { normalizeJordanPhone, phoneCandidates } from "../services/phoneOtp.js";

const router = express.Router();
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 25;
const MAX_QUERY_LENGTH = 120;
const MAX_CUSTOMER_MATCHES = 20;
const BOOKING_REFERENCE = /^SG-([A-F0-9]{8})$/i;

router.use(requireAuth, requireRole("admin"));

function bookingReference(id) {
  return `SG-${String(id).slice(-8).toUpperCase()}`;
}

function safeMoney(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function paymentDiagnostic(payment) {
  if (!payment) return null;
  if (payment.status === "needs_review") return "Payment requires operations review.";
  if (payment.status === "failed") return "Payment failed at the gateway.";
  if (payment.status === "pending" || payment.status === "created") return "Payment is not completed yet.";
  if (payment.status === "refunded" || payment.status === "partially_refunded") return "Payment includes a recorded refund.";
  return null;
}

function ticketTruth(booking) {
  const signingConfigured = Boolean(process.env.TICKET_SIGNING_SECRET || process.env.JWT_SECRET);
  const eligible = ["confirmed", "cancelled", "refunded"].includes(booking.status);
  const available = eligible && signingConfigured;
  const checkedIn = Boolean(booking.checkedInAt);
  const departureStatus = booking.departureId?.status || null;

  let status = "unavailable";
  if (available) {
    if (booking.status === "cancelled") status = "cancelled";
    else if (booking.status === "refunded") status = "refunded";
    else if (checkedIn) status = "used";
    else if (departureStatus !== "scheduled") status = "invalid";
    else status = "valid";
  }

  return {
    source: "booking_derived",
    persistedRecord: false,
    available,
    status,
    used: checkedIn,
    checkedInAt: booking.checkedInAt || null,
    checkedInBy: booking.checkedInBy ? {
      id: booking.checkedInBy._id || booking.checkedInBy,
      name: booking.checkedInBy.name || null,
      role: booking.checkedInBy.role || null
    } : null
  };
}

function operationalWarnings({ booking, payment, ticket }) {
  const warnings = [];
  const push = (code, message, severity = "warning") => warnings.push({ code, message, severity });
  const bookingGross = safeMoney(booking.pricing?.grossAmount);
  const bookingCurrency = booking.pricing?.currency || "JOD";

  if (booking.status === "confirmed" && !payment) {
    push("confirmed_missing_payment", "Confirmed booking has no payment record.");
  }
  if (payment?.status === "paid" && !["confirmed", "cancelled", "refunded"].includes(booking.status)) {
    push("paid_booking_not_confirmed", "Payment is paid but the booking is not confirmed.");
  }
  if (booking.status === "confirmed" && !ticket.available) {
    push("confirmed_missing_ticket", "Confirmed booking does not currently have an available ticket.");
  }
  if ((payment?.status === "refunded" || safeMoney(payment?.refundedAmount) > 0) && booking.status === "confirmed") {
    push("refunded_payment_confirmed_booking", "Payment is refunded but the booking is still confirmed.");
  }
  if (booking.status === "cancelled" && ticket.status === "valid") {
    push("cancelled_booking_active_ticket", "Cancelled booking still has an active ticket.");
  }
  if (booking.checkedInAt && ["cancelled", "refunded"].includes(booking.status)) {
    push("cancelled_booking_checked_in", "Booking is cancelled/refunded but has a recorded check-in.");
  }
  if (payment?.status === "needs_review") {
    push("payment_needs_review", "Payment is marked needs_review.");
  }
  if (payment) {
    if (Math.abs(safeMoney(payment.amount) - bookingGross) > 0.005) {
      push("payment_amount_mismatch", "Payment amount does not match the booking pricing snapshot.");
    }
    if (String(payment.currency || "JOD").toUpperCase() !== String(bookingCurrency).toUpperCase()) {
      push("payment_currency_mismatch", "Payment currency does not match the booking pricing snapshot.");
    }
  }
  return warnings;
}

async function bookingIdsForReference(query, limit) {
  const match = BOOKING_REFERENCE.exec(query);
  if (!match) return [];
  const suffix = match[1].toLowerCase();
  const rows = await Booking.aggregate([
    {
      $match: {
        $expr: {
          $eq: [
            { $substrBytes: [{ $toString: "$_id" }, 16, 8] },
            suffix
          ]
        }
      }
    },
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: limit + 1 },
    { $project: { _id: 1 } }
  ]).option({ maxTimeMS: 1500 });
  return rows.map(row => row._id);
}

async function customerIdsForQuery(query) {
  if (query.includes("@")) {
    const user = await User.findOne({ email: query.toLowerCase() }).select("_id").lean();
    return user ? [user._id] : [];
  }

  const normalized = normalizeJordanPhone(query);
  if (!normalized) return [];
  const candidates = phoneCandidates(normalized);
  const users = await User.find({
    $or: [
      { phoneNormalized: normalized },
      { phone: { $in: candidates } }
    ]
  }).select("_id").limit(MAX_CUSTOMER_MATCHES).lean();
  return users.map(user => user._id);
}

async function paymentBookingIds(query, limit) {
  const payments = await Payment.find({ externalPaymentId: query, bookingId: { $ne: null } })
    .select("bookingId")
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();
  return payments.map(payment => payment.bookingId).filter(Boolean);
}

function searchItem(booking, payment) {
  const customer = booking.customerId && typeof booking.customerId === "object" ? booking.customerId : null;
  const provider = booking.providerId && typeof booking.providerId === "object" ? booking.providerId : null;
  const trip = booking.tripId && typeof booking.tripId === "object" ? booking.tripId : null;
  const departure = booking.departureId && typeof booking.departureId === "object" ? booking.departureId : null;
  return {
    bookingId: booking._id,
    bookingReference: bookingReference(booking._id),
    customerName: booking.customerSnapshot?.name || customer?.name || "Customer",
    providerName: provider?.businessName || "Unknown provider",
    tripTitle: trip?.titleEn || trip?.titleAr || "Unknown trip",
    departureAt: departure?.startsAt || null,
    bookingStatus: booking.status,
    paymentStatus: payment?.status || null,
    total: safeMoney(booking.pricing?.grossAmount),
    currency: booking.pricing?.currency || "JOD"
  };
}

router.get("/search", async (req, res, next) => {
  try {
    if (typeof req.query.q !== "string") return res.status(400).json({ error: "Search query must be a string" });
    const query = req.query.q.trim();
    if (!query) return res.status(400).json({ error: "Search query is required" });
    if (query.length > MAX_QUERY_LENGTH) return res.status(400).json({ error: "Search query is too long" });

    const rawLimit = req.query.limit === undefined ? DEFAULT_LIMIT : Number(req.query.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_LIMIT) {
      return res.status(400).json({ error: `limit must be between 1 and ${MAX_LIMIT}` });
    }

    const ids = new Map();
    const addIds = values => values.forEach(value => value && ids.set(String(value), value));

    if (BOOKING_REFERENCE.test(query)) {
      addIds(await bookingIdsForReference(query, rawLimit));
    } else {
      const customerIds = await customerIdsForQuery(query);
      if (customerIds.length) {
        const rows = await Booking.find({ customerId: { $in: customerIds } })
          .select("_id")
          .sort({ createdAt: -1, _id: -1 })
          .limit(rawLimit + 1)
          .lean();
        addIds(rows.map(row => row._id));
      }
      addIds(await paymentBookingIds(query, rawLimit));
    }

    let bookingIds = [...ids.values()];
    let truncated = bookingIds.length > rawLimit;
    bookingIds = bookingIds.slice(0, rawLimit);

    if (!bookingIds.length) {
      return res.json({ query, limit: rawLimit, truncated: false, items: [] });
    }

    const bookings = await Booking.find({ _id: { $in: bookingIds } })
      .select("customerId customerSnapshot providerId tripId departureId status pricing createdAt")
      .populate({ path: "customerId", select: "name" })
      .populate({ path: "providerId", select: "businessName" })
      .populate({ path: "tripId", select: "titleAr titleEn" })
      .populate({ path: "departureId", select: "startsAt" })
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    const payments = await Payment.find({ bookingId: { $in: bookings.map(row => row._id) } })
      .select("bookingId status")
      .lean();
    const paymentByBooking = new Map(payments.map(payment => [String(payment.bookingId), payment]));

    if (bookings.length >= rawLimit) truncated = truncated || ids.size > rawLimit;
    res.json({
      query,
      limit: rawLimit,
      truncated,
      items: bookings.map(booking => searchItem(booking, paymentByBooking.get(String(booking._id))))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:bookingId", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.bookingId)) {
      return res.status(400).json({ error: "Invalid bookingId" });
    }

    const booking = await Booking.findById(req.params.bookingId)
      .select("customerId customerSnapshot providerId tripId departureId seats adults children mealPlan status pricing checkedInAt checkedInBy checkInCount cancellation createdAt updatedAt")
      .populate({ path: "customerId", select: "name email phone phoneNormalized" })
      .populate({ path: "providerId", select: "businessName status settings.departureLocation" })
      .populate({ path: "tripId", select: "titleAr titleEn vesselName active platformStatus departureLocation providerId" })
      .populate({ path: "departureId", select: "startsAt capacity reservedSeats salesClosed status" })
      .populate({ path: "checkedInBy", select: "name role" });

    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const payment = await Payment.findOne({ bookingId: booking._id })
      .select("provider externalPaymentId status amount currency paidAt failedAt refundedAmount refundedAt refundReference createdAt updatedAt")
      .lean();

    const customer = booking.customerId && typeof booking.customerId === "object" ? booking.customerId : null;
    const provider = booking.providerId && typeof booking.providerId === "object" ? booking.providerId : null;
    const trip = booking.tripId && typeof booking.tripId === "object" ? booking.tripId : null;
    const departure = booking.departureId && typeof booking.departureId === "object" ? booking.departureId : null;
    const ticket = ticketTruth(booking);
    const grossAmount = safeMoney(booking.pricing?.grossAmount);
    const cancellationRefund = safeMoney(booking.cancellation?.refundAmount);
    const departurePoint = trip?.departureLocation?.name || trip?.departureLocation?.address
      ? trip.departureLocation
      : provider?.settings?.departureLocation || null;

    const dto = {
      booking: {
        id: booking._id,
        reference: bookingReference(booking._id),
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        status: booking.status,
        adults: booking.adults || 0,
        children: booking.children || 0,
        seats: booking.seats,
        mealPlan: booking.mealPlan || null,
        pricingSnapshot: {
          currency: booking.pricing?.currency || "JOD",
          unitPrice: booking.pricing?.unitPrice ?? null,
          adultUnitPrice: booking.pricing?.adultUnitPrice ?? null,
          childUnitPrice: booking.pricing?.childUnitPrice ?? null,
          adultSubtotal: booking.pricing?.adultSubtotal ?? null,
          childSubtotal: booking.pricing?.childSubtotal ?? null,
          grossAmount,
          commissionAmount: booking.pricing?.commissionAmount ?? null,
          providerNetAmount: booking.pricing?.providerNetAmount ?? null
        }
      },
      customer: {
        id: customer?._id || booking.customerId || null,
        name: booking.customerSnapshot?.name || customer?.name || "Customer",
        email: customer?.email || null,
        phone: booking.customerSnapshot?.phone || customer?.phoneNormalized || customer?.phone || null
      },
      provider: {
        id: provider?._id || booking.providerId || null,
        businessName: provider?.businessName || "Unknown provider",
        status: provider?.status || "unknown"
      },
      trip: {
        id: trip?._id || booking.tripId || null,
        title: trip?.titleEn || trip?.titleAr || "Unknown trip",
        titleEn: trip?.titleEn || null,
        titleAr: trip?.titleAr || null,
        vesselName: trip?.vesselName || null,
        providerActive: trip?.active === true,
        platformStatus: trip?.platformStatus || "unknown"
      },
      departure: {
        id: departure?._id || booking.departureId || null,
        startsAt: departure?.startsAt || null,
        capacity: departure?.capacity ?? null,
        reservedSeats: departure?.reservedSeats ?? null,
        salesClosed: departure?.salesClosed ?? null,
        status: departure?.status || "unknown",
        point: departurePoint ? {
          name: departurePoint.name || null,
          address: departurePoint.address || null,
          googleMapsUrl: departurePoint.googleMapsUrl || null,
          lat: departurePoint.lat ?? null,
          lng: departurePoint.lng ?? null
        } : null
      },
      payment: payment ? {
        gateway: payment.provider,
        status: payment.status,
        amount: safeMoney(payment.amount),
        currency: payment.currency || "JOD",
        externalPaymentId: payment.externalPaymentId || null,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        paidAt: payment.paidAt || null,
        failedAt: payment.failedAt || null,
        refundedAmount: safeMoney(payment.refundedAmount),
        refundedAt: payment.refundedAt || null,
        refundStatus: payment.status === "refunded" ? "refunded" : payment.status === "partially_refunded" ? "partially_refunded" : "none",
        refundReference: payment.refundReference || null,
        needsReview: payment.status === "needs_review",
        diagnosticSummary: paymentDiagnostic(payment)
      } : null,
      ticket,
      checkIn: {
        level: "booking",
        checkedIn: Boolean(booking.checkedInAt),
        checkedInAt: booking.checkedInAt || null,
        checkedInBy: ticket.checkedInBy
      },
      cancellation: booking.cancellation?.cancelledAt || booking.status === "cancelled" || booking.status === "refunded" ? {
        source: booking.cancellation?.source || null,
        reason: booking.cancellation?.reason || null,
        cancelledAt: booking.cancellation?.cancelledAt || null,
        hoursBeforeDeparture: booking.cancellation?.hoursBeforeDeparture ?? null,
        refundPercentage: booking.cancellation?.refundPercentage ?? null,
        refundAmount: cancellationRefund,
        refundStatus: booking.cancellation?.refundStatus || "none",
        retainedAmount: Math.max(0, Number((grossAmount - cancellationRefund).toFixed(2)))
      } : null
    };

    dto.warnings = operationalWarnings({ booking, payment, ticket });
    res.json(dto);
  } catch (error) {
    next(error);
  }
});

export { bookingReference, operationalWarnings, ticketTruth };
export default router;
