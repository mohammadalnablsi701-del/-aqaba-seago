import express from "express";
import Departure from "../models/Departure.js";
import Trip from "../models/Trip.js";
import Provider from "../models/Provider.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { calculatePricing } from "../services/pricing.js";

const router = express.Router();

router.post("/", requireAuth, requireRole("provider"), async (req, res, next) => {
  try {
    const provider = await Provider.findOne({
      ownerUserId: req.user._id,
      status: "approved"
    });
    if (!provider) {
      return res.status(403).json({ error: "Approved provider profile required" });
    }

    const trip = await Trip.findOne({
      _id: req.body.tripId,
      providerId: provider._id
    });
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const departure = await Departure.create({
      tripId: trip._id,
      startsAt: req.body.startsAt,
      capacity: req.body.capacity
    });

    res.status(201).json(departure);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const query = {
      status: "scheduled",
      startsAt: { $gte: new Date() }
    };

    if (req.query.tripId) query.tripId = req.query.tripId;

    const departures = await Departure.find(query)
      .sort({ startsAt: 1 })
      .limit(Math.min(Number(req.query.limit || 30), 100));

    res.json(
      departures.map(d => ({
        id: d._id,
        tripId: d.tripId,
        startsAt: d.startsAt,
        capacity: d.capacity,
        reservedSeats: d.reservedSeats,
        availableSeats: Math.max(0, d.capacity - d.reservedSeats),
        status: d.status
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.get("/:departureId/quote", async (req, res, next) => {
  try {
    const seats = Number(req.query.seats);
    const departure = await Departure.findById(req.params.departureId);

    if (!departure || departure.status !== "scheduled") {
      return res.status(404).json({ error: "Departure not found" });
    }

    if (!Number.isInteger(seats) || seats < 1) {
      return res.status(400).json({ error: "Invalid seats" });
    }

    if (departure.reservedSeats + seats > departure.capacity) {
      return res.status(409).json({ error: "Not enough seats" });
    }

    const trip = await Trip.findById(departure.tripId);
    const pricing = calculatePricing({
      pricePerPerson: trip.pricing.pricePerPerson,
      seats,
      commissionType: trip.pricing.commissionType,
      commissionValue: trip.pricing.commissionValue
    });

    res.json({
      departureId: departure._id,
      seats,
      availableSeats: departure.capacity - departure.reservedSeats,
      pricing
    });
  } catch (err) {
    next(err);
  }
});

export default router;
