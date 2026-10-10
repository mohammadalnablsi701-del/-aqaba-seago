import express from "express";
import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import PaymentEvent from "../models/PaymentEvent.js";
import Booking from "../models/Booking.js";
import CheckoutHold from "../models/CheckoutHold.js";
import User from "../models/User.js";
import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

export const PAYMENT_STATUSES = [
  "created",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
  "needs_review",
  "partially_refunded",
  "refunded"
];

const STATUS_SET = new Set(PAYMENT_STATUSES);
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const MAX_PAGE = 10000;
const MAX_QUERY_LENGTH = 120;
const BOOKING_REFERENCE = /^SG-([A-F0-9]{8})$/i;
const SUCCESSFUL_PAYMENT_STATUSES = new Set(["paid", "partially_refunded", "refunded"]);

router.use(requireAuth, requireRole("admin"));

function bookingReference(id) {
  return id ? `SG-${String(id).slice(-8).toUpperCase()}` : null;
}

function safeMoney(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function sameMoney(a, b) {
  return Math.abs(safeMoney(a) - safeMoney(b)) <= 0.005;
}

function parsePositiveInteger(value, fallback, { min = 1, max }) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function parseBooleanFilter(value) {
  if (value === undefined || value === null || value === "" || value === "any") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function bookingIdsForReference(query) {
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
    { $limit: 10 },
    { $project: { _id: 1 } }
  ]).option({ maxTimeMS: 1500 });
  return rows.map(row => row._id);
}

async function exactSearchCondition(query) {
  if (!query) return null;
  if (mongoose.isValidObjectId(query) && String(new mongoose.Types.ObjectId(query)) === query.toLowerCase()) {
    return { _id: new mongoose.Types.ObjectId(query) };
  }
  if (BOOKING_REFERENCE.test(query)) {
    const bookingIds = await bookingIdsForReference(query);
    return bookingIds.length ? { bookingId: { $in: bookingIds } } : { _id: null };
  }
  return { externalPaymentId: query };
}

function buildWarnings(payment, booking, hold) {
  const warnings = [];
  const push = (code, message, severity = "warning") => warnings.push({ code, message, severity });

  if (payment.status === "needs_review") {
    push("needs_review", "Payment is marked needs_review by backend payment processing.", "critical");
  }
  if (payment.status === "paid" && !booking) {
    push("paid_without_booking", "Paid payment is not linked to a booking.", "critical");
  }
  if (booking?.status === "confirmed" && !SUCCESSFUL_PAYMENT_STATUSES.has(payment.status)) {
    push("confirmed_booking_non_success_payment", "Booking is confirmed while payment is not in a successful payment state.", "critical");
  }
  if (booking && !sameMoney(payment.amount, booking.pricing?.grossAmount)) {
    push("amount_mismatch", "Payment amount does not match the booking pricing snapshot.", "critical");
  }
  if (booking && String(payment.currency || "JOD").toUpperCase() !== String(booking.pricing?.currency || "JOD").toUpperCase()) {
    push("currency_mismatch", "Payment currency does not match the booking pricing snapshot.", "critical");
  }
  if ((payment.status === "refunded" || safeMoney(payment.refundedAmount) >= safeMoney(payment.amount)) && booking?.status === "confirmed") {
    push("refunded_payment_active_booking", "Refunded payment is linked to a still-confirmed booking.", "critical");
  }
  if (payment.status === "partially_refunded") {
    push("partially_refunded", "Payment is partially refunded and should be reviewed in its booking context.");
  }
  if (!hold) {
    push("missing_checkout_hold", "Payment no longer has a readable CheckoutHold relation.", "critical");
  }
  return warnings;
}

function reviewSummary(payment, warnings) {
  if (payment.status !== "needs_review") return null;
  const diagnostics = warnings.filter(item => item.code !== "needs_review").map(item => item.message);
  return diagnostics.length
    ? diagnostics.join(" ")
    : "Backend payment processing marked this payment for manual review; no more specific safe reason is persisted.";
}

function refundState(payment) {
  if (payment.status === "refunded") return "refunded";
  if (payment.status === "partially_refunded") return "partially_refunded";
  if (safeMoney(payment.refundedAmount) > 0) return "recorded";
  return "none";
}

function parseListQuery(query) {
  const page = parsePositiveInteger(query.page, 1, { max: MAX_PAGE });
  const limit = parsePositiveInteger(query.limit, DEFAULT_LIMIT, { max: MAX_LIMIT });
  if (page === null) return { error: `page must be between 1 and ${MAX_PAGE}` };
  if (limit === null) return { error: `limit must be between 1 and ${MAX_LIMIT}` };

  const status = query.status === undefined || query.status === "" || query.status === "all" ? null : String(query.status);
  if (status && !STATUS_SET.has(status)) return { error: "Invalid payment status" };

  const gateway = query.provider === undefined ? null : String(query.provider).trim();
  if (gateway && gateway.length > 80) return { error: "provider filter is too long" };

  const booking = query.booking === undefined || query.booking === "" ? "any" : String(query.booking);
  if (!["any", "linked", "missing"].includes(booking)) return { error: "booking must be any, linked, or missing" };

  const needsReview = parseBooleanFilter(query.needsReview);
  if (needsReview === undefined) return { error: "needsReview must be true, false, or any" };

  const refund = query.refund === undefined || query.refund === "" ? "any" : String(query.refund);
  if (!["any", "any_refund", "partially_refunded", "refunded"].includes(refund)) {
    return { error: "Invalid refund filter" };
  }

  const from = parseDate(query.from, false);
  const to = parseDate(query.to, true);
  if (from === undefined || to === undefined) return { error: "Dates must use YYYY-MM-DD" };
  if (from && to && from > to) return { error: "from must be before or equal to to" };

  const q = query.q === undefined ? "" : String(query.q).trim();
  if (q.length > MAX_QUERY_LENGTH) return { error: "Search query is too long" };

  return { page, limit, status, gateway, booking, needsReview, refund, from, to, q };
}

async function buildPaymentFilter(parsed) {
  const conditions = [];
  if (parsed.status) conditions.push({ status: parsed.status });
  if (parsed.gateway) conditions.push({ provider: parsed.gateway });
  if (parsed.booking === "linked") conditions.push({ bookingId: { $ne: null } });
  if (parsed.booking === "missing") conditions.push({ bookingId: null });
  if (parsed.needsReview === true) conditions.push({ status: "needs_review" });
  if (parsed.needsReview === false) conditions.push({ status: { $ne: "needs_review" } });
  if (parsed.refund === "refunded") conditions.push({ status: "refunded" });
  if (parsed.refund === "partially_refunded") conditions.push({ status: "partially_refunded" });
  if (parsed.refund === "any_refund") {
    conditions.push({ $or: [{ status: { $in: ["partially_refunded", "refunded"] } }, { refundedAmount: { $gt: 0 } }] });
  }
  if (parsed.from || parsed.to) {
    const createdAt = {};
    if (parsed.from) createdAt.$gte = parsed.from;
    if (parsed.to) createdAt.$lte = parsed.to;
    conditions.push({ createdAt });
  }
  const search = await exactSearchCondition(parsed.q);
  if (search) conditions.push(search);
  if (!conditions.length) return {};
  return conditions.length === 1 ? conditions[0] : { $and: conditions };
}

async function listRelations(payments) {
  const paymentIds = payments.map(payment => payment._id);
  const bookingIds = payments.map(payment => payment.bookingId).filter(Boolean);
  const holdIds = payments.map(payment => payment.holdId).filter(Boolean);
  const customerIds = payments.map(payment => payment.customerId).filter(Boolean);

  const [bookings, holds, customers, eventTimes] = await Promise.all([
    bookingIds.length ? Booking.find({ _id: { $in: bookingIds } })
      .select("status pricing providerId customerSnapshot")
      .lean() : [],
    holdIds.length ? CheckoutHold.find({ _id: { $in: holdIds } })
      .select("status expiresAt providerId pricing")
      .lean() : [],
    customerIds.length ? User.find({ _id: { $in: customerIds } })
      .select("name")
      .lean() : [],
    paymentIds.length ? PaymentEvent.aggregate([
      { $match: { paymentId: { $in: paymentIds } } },
      { $group: { _id: "$paymentId", lastEventAt: { $max: "$processedAt" } } }
    ]).option({ maxTimeMS: 1500 }) : []
  ]);

  const bookingById = new Map(bookings.map(value => [String(value._id), value]));
  const holdById = new Map(holds.map(value => [String(value._id), value]));
  const customerById = new Map(customers.map(value => [String(value._id), value]));
  const eventByPayment = new Map(eventTimes.map(value => [String(value._id), value.lastEventAt]));
  const providerIds = new Set();
  for (const payment of payments) {
    const booking = bookingById.get(String(payment.bookingId || ""));
    const hold = holdById.get(String(payment.holdId || ""));
    const providerId = booking?.providerId || hold?.providerId;
    if (providerId) providerIds.add(String(providerId));
  }
  const providerRows = providerIds.size
    ? await Provider.find({ _id: { $in: [...providerIds] } }).select("businessName").lean()
    : [];
  const providerById = new Map(providerRows.map(value => [String(value._id), value]));

  return { bookingById, holdById, customerById, eventByPayment, providerById };
}

function listDto(payment, relations) {
  const booking = relations.bookingById.get(String(payment.bookingId || "")) || null;
  const hold = relations.holdById.get(String(payment.holdId || "")) || null;
  const customer = relations.customerById.get(String(payment.customerId || "")) || null;
  const businessProviderId = booking?.providerId || hold?.providerId || null;
  const businessProvider = businessProviderId ? relations.providerById.get(String(businessProviderId)) : null;
  const warnings = buildWarnings(payment, booking, hold);
  return {
    id: payment._id,
    gateway: payment.provider,
    externalPaymentId: payment.externalPaymentId || null,
    booking: booking ? {
      id: booking._id,
      reference: bookingReference(booking._id),
      status: booking.status
    } : null,
    customer: {
      name: booking?.customerSnapshot?.name || customer?.name || "Customer"
    },
    businessProvider: businessProvider ? {
      id: businessProvider._id,
      businessName: businessProvider.businessName || "Unknown provider"
    } : null,
    amount: safeMoney(payment.amount),
    currency: payment.currency || "JOD",
    status: payment.status,
    refundedAmount: safeMoney(payment.refundedAmount),
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    lastEventAt: relations.eventByPayment.get(String(payment._id)) || null,
    needsReview: payment.status === "needs_review",
    reviewSummary: reviewSummary(payment, warnings),
    warnings
  };
}

router.get("/", async (req, res, next) => {
  try {
    const parsed = parseListQuery(req.query);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const filter = await buildPaymentFilter(parsed);
    const skip = (parsed.page - 1) * parsed.limit;

    const [payments, total, gateways] = await Promise.all([
      Payment.find(filter)
        .select("_id bookingId holdId customerId provider externalPaymentId status amount currency refundedAmount createdAt updatedAt")
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(parsed.limit)
        .lean(),
      Payment.countDocuments(filter),
      Payment.distinct("provider")
    ]);
    const relations = await listRelations(payments);
    const totalPages = Math.max(1, Math.ceil(total / parsed.limit));

    res.json({
      items: payments.map(payment => listDto(payment, relations)),
      pagination: {
        page: parsed.page,
        limit: parsed.limit,
        total,
        totalPages,
        hasPrevious: parsed.page > 1,
        hasNext: parsed.page < totalPages
      },
      filters: {
        statuses: PAYMENT_STATUSES,
        gateways: gateways.filter(value => typeof value === "string" && value).sort().slice(0, 20)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:paymentId", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.paymentId)) {
      return res.status(400).json({ error: "Invalid paymentId" });
    }
    const payment = await Payment.findById(req.params.paymentId)
      .select("_id bookingId holdId customerId provider externalPaymentId status amount currency paidAt failedAt refundedAmount refundedAt refundReference createdAt updatedAt")
      .lean();
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    const [booking, hold, customer, events] = await Promise.all([
      payment.bookingId ? Booking.findById(payment.bookingId)
        .select("customerSnapshot providerId tripId departureId status pricing createdAt updatedAt")
        .lean() : null,
      payment.holdId ? CheckoutHold.findById(payment.holdId)
        .select("providerId tripId departureId status expiresAt pricing")
        .lean() : null,
      User.findById(payment.customerId).select("name email phone phoneNormalized").lean(),
      PaymentEvent.find({ paymentId: payment._id })
        .select("provider eventId externalPaymentId eventStatus amount currency processedAt createdAt")
        .sort({ processedAt: -1, _id: -1 })
        .limit(50)
        .lean()
    ]);

    const providerId = booking?.providerId || hold?.providerId || null;
    const tripId = booking?.tripId || hold?.tripId || null;
    const departureId = booking?.departureId || hold?.departureId || null;
    const [businessProvider, trip, departure] = await Promise.all([
      providerId ? Provider.findById(providerId).select("businessName status").lean() : null,
      tripId ? Trip.findById(tripId).select("titleAr titleEn vesselName").lean() : null,
      departureId ? Departure.findById(departureId).select("startsAt status").lean() : null
    ]);

    const warnings = buildWarnings(payment, booking, hold);
    const bookingCurrency = booking?.pricing?.currency || "JOD";
    const lastEvent = events[0] || null;
    const customerName = booking?.customerSnapshot?.name || customer?.name || "Customer";
    const customerPhone = booking?.customerSnapshot?.phone || customer?.phoneNormalized || customer?.phone || null;

    res.json({
      payment: {
        id: payment._id,
        gateway: payment.provider,
        externalPaymentId: payment.externalPaymentId || null,
        status: payment.status,
        amount: safeMoney(payment.amount),
        currency: payment.currency || "JOD",
        refundedAmount: safeMoney(payment.refundedAmount),
        paidAt: payment.paidAt || null,
        failedAt: payment.failedAt || null,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        lastEventAt: lastEvent?.processedAt || lastEvent?.createdAt || null
      },
      booking: booking ? {
        id: booking._id,
        reference: bookingReference(booking._id),
        status: booking.status,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        customer: {
          name: customerName,
          email: customer?.email || null,
          phone: customerPhone
        },
        businessProvider: businessProvider ? {
          id: businessProvider._id,
          businessName: businessProvider.businessName || "Unknown provider",
          status: businessProvider.status || "unknown"
        } : null,
        trip: trip ? {
          id: trip._id,
          title: trip.titleEn || trip.titleAr || "Unknown trip",
          vesselName: trip.vesselName || null
        } : null,
        departure: departure ? {
          id: departure._id,
          startsAt: departure.startsAt || null,
          status: departure.status || "unknown"
        } : null,
        pricingSnapshot: {
          grossAmount: safeMoney(booking.pricing?.grossAmount),
          currency: bookingCurrency
        }
      } : null,
      checkoutHold: hold ? {
        id: hold._id,
        status: hold.status,
        expiresAt: hold.expiresAt || null
      } : null,
      review: {
        needsReview: payment.status === "needs_review",
        summary: reviewSummary(payment, warnings),
        warnings
      },
      refund: {
        state: refundState(payment),
        amount: safeMoney(payment.refundedAmount),
        reference: payment.refundReference || null,
        refundedAt: payment.refundedAt || null
      },
      events: events.map(event => ({
        eventId: event.eventId,
        gateway: event.provider,
        status: event.eventStatus || null,
        amount: Number.isFinite(Number(event.amount)) ? Number(event.amount) : null,
        currency: event.currency || null,
        receivedAt: event.createdAt || null,
        processedAt: event.processedAt || null
      })),
      eventVisibility: {
        rawPayloadExposed: false,
        duplicateReplayPersisted: false,
        note: "Duplicate/replayed events are rejected idempotently but no safe duplicate flag is persisted in PaymentEvent."
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
