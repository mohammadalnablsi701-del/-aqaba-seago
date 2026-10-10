import express from "express";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Departure from "../models/Departure.js";
import Trip from "../models/Trip.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { tripSalesSemantics } from "../services/tripSales.js";

const router = express.Router();
const OPERATION_TIME_ZONE = "Asia/Amman";
const MAX_DEPARTURES = 300;
const VALID_STATUSES = new Set(["scheduled", "cancelled", "completed"]);
const VALID_SALES_FILTERS = new Set(["open", "closed"]);

router.use(requireAuth, requireRole("admin"));

function ammanDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: OPERATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const part = type => parts.find(item => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateRange(value) {
  const date = String(value || ammanDate()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const start = new Date(`${date}T00:00:00.000+03:00`);
  if (Number.isNaN(start.getTime()) || ammanDate(start) !== date) return null;
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { date, start, end };
}

function positiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function departureSalesState({ departure, trip, provider, availableSeats, now }) {
  const tripSemantics = tripSalesSemantics({ trip, provider, hasSellableDeparture: false });
  let reason = "open";
  if (departure.status === "cancelled") reason = "departure_cancelled";
  else if (departure.status === "completed") reason = "departure_completed";
  else if (!tripSemantics.providerApproved) reason = "provider_blocked";
  else if (!tripSemantics.providerActive) reason = "provider_paused";
  else if (!tripSemantics.platformAllowed) reason = "platform_paused";
  else if (departure.salesClosed === true) reason = "departure_closed";
  else if (new Date(departure.startsAt) <= now) reason = "departure_started";
  else if (availableSeats <= 0) reason = "no_seats";
  return {
    open: reason === "open",
    reason,
    providerActive: tripSemantics.providerActive,
    platformAllowed: tripSemantics.platformAllowed,
    providerApproved: tripSemantics.providerApproved
  };
}

function attentionReasons({ departure, capacityInconsistent, salesState }) {
  const reasons = [];
  if (capacityInconsistent) reasons.push("capacity_inconsistent");
  if (departure.status === "cancelled") reasons.push("departure_cancelled");
  if (!salesState.providerApproved) reasons.push("provider_blocked");
  if (!salesState.providerActive) reasons.push("provider_paused");
  if (!salesState.platformAllowed) reasons.push("platform_paused");
  return [...new Set(reasons)];
}

router.get("/departures", async (req, res, next) => {
  try {
    const range = dateRange(req.query.date);
    if (!range) return res.status(400).json({ error: "Invalid date" });

    const providerId = String(req.query.providerId || "").trim();
    if (providerId && !mongoose.isValidObjectId(providerId)) {
      return res.status(400).json({ error: "Invalid provider" });
    }

    const status = String(req.query.status || "").trim();
    if (status && !VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: "Invalid departure status" });
    }

    const sales = String(req.query.sales || "").trim();
    if (sales && !VALID_SALES_FILTERS.has(sales)) {
      return res.status(400).json({ error: "Invalid sales filter" });
    }

    const departureFilter = { startsAt: { $gte: range.start, $lt: range.end } };
    if (status) departureFilter.status = status;

    if (providerId) {
      const providerTripIds = await Trip.find({ providerId }).distinct("_id");
      departureFilter.tripId = { $in: providerTripIds };
    }

    let departureRows = await Departure.find(departureFilter)
      .select("_id tripId startsAt capacity reservedSeats salesClosed status")
      .sort({ startsAt: 1, tripId: 1, _id: 1 })
      .limit(MAX_DEPARTURES + 1)
      .lean();

    const truncated = departureRows.length > MAX_DEPARTURES;
    if (truncated) departureRows = departureRows.slice(0, MAX_DEPARTURES);

    const tripIds = [...new Set(departureRows.map(row => String(row.tripId)))];
    const departureIds = departureRows.map(row => row._id);

    const [tripRows, bookingStats] = await Promise.all([
      tripIds.length
        ? Trip.find({ _id: { $in: tripIds } })
            .select("_id providerId titleAr titleEn vesselName active platformStatus")
            .populate("providerId", "businessName status")
            .lean()
        : [],
      departureIds.length
        ? Booking.aggregate([
            { $match: { departureId: { $in: departureIds }, status: "confirmed" } },
            {
              $group: {
                _id: "$departureId",
                confirmedBookings: { $sum: 1 },
                confirmedSeats: { $sum: { $ifNull: ["$seats", 0] } },
                checkedInBookings: {
                  $sum: { $cond: [{ $ne: [{ $ifNull: ["$checkedInAt", null] }, null] }, 1, 0] }
                },
                checkedInSeats: {
                  $sum: {
                    $cond: [
                      { $ne: [{ $ifNull: ["$checkedInAt", null] }, null] },
                      { $ifNull: ["$seats", 0] },
                      0
                    ]
                  }
                }
              }
            }
          ])
        : []
    ]);

    const tripsById = new Map(tripRows.map(trip => [String(trip._id), trip]));
    const bookingsByDeparture = new Map(bookingStats.map(item => [String(item._id), item]));
    const now = new Date();

    let items = departureRows.map(departure => {
      const trip = tripsById.get(String(departure.tripId)) || null;
      const provider = trip?.providerId && typeof trip.providerId === "object" ? trip.providerId : null;
      const capacity = positiveNumber(departure.capacity);
      const reservedSeats = positiveNumber(departure.reservedSeats);
      const availableSeats = Math.max(0, capacity - reservedSeats);
      const capacityInconsistent = reservedSeats > capacity;
      const stats = bookingsByDeparture.get(String(departure._id)) || {};
      const salesState = departureSalesState({ departure, trip, provider, availableSeats, now });

      return {
        departureId: departure._id,
        startsAt: departure.startsAt,
        providerId: provider?._id || null,
        providerName: provider?.businessName || "Unknown provider",
        providerStatus: provider?.status || "unknown",
        tripId: trip?._id || departure.tripId,
        tripTitle: trip?.titleEn || trip?.titleAr || "Unknown trip",
        vesselName: trip?.vesselName || null,
        tripProviderActive: salesState.providerActive,
        platformStatus: salesState.platformAllowed ? "allowed" : "paused",
        capacity,
        reservedSeats,
        availableSeats,
        capacityInconsistent,
        confirmedBookings: positiveNumber(stats.confirmedBookings),
        confirmedSeats: positiveNumber(stats.confirmedSeats),
        checkedInBookings: positiveNumber(stats.checkedInBookings),
        checkedInSeats: positiveNumber(stats.checkedInSeats),
        salesClosed: Boolean(departure.salesClosed),
        salesOpen: salesState.open,
        salesReason: salesState.reason,
        status: departure.status,
        attentionReasons: attentionReasons({ departure, capacityInconsistent, salesState })
      };
    });

    if (sales) items = items.filter(item => (sales === "open" ? item.salesOpen : !item.salesOpen));

    items.sort((a, b) =>
      new Date(a.startsAt) - new Date(b.startsAt) ||
      a.providerName.localeCompare(b.providerName, "en") ||
      a.tripTitle.localeCompare(b.tripTitle, "en") ||
      String(a.departureId).localeCompare(String(b.departureId))
    );

    res.json({
      generatedAt: new Date(),
      timezone: OPERATION_TIME_ZONE,
      date: range.date,
      limit: MAX_DEPARTURES,
      truncated,
      filters: {
        providerId: providerId || null,
        status: status || null,
        sales: sales || null
      },
      items
    });
  } catch (error) {
    next(error);
  }
});

export default router;
