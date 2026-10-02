import express from "express";
import Trip from "../models/Trip.js";
import Provider from "../models/Provider.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

function serverPricing(input = {}, existing = null) {
  const defaultCommission = Number(process.env.DEFAULT_COMMISSION_PER_PERSON || 4);
  return {
    currency: input.currency || existing?.currency || "JOD",
    pricePerPerson: Number(input.pricePerPerson ?? existing?.pricePerPerson ?? 0),
    commissionType: existing?.commissionType || "fixed_per_person",
    commissionValue: Number(existing?.commissionValue ?? defaultCommission)
  };
}

router.post("/", requireAuth, requireRole("provider"), async (req, res, next) => {
  try {
    const p = await Provider.findOne({ ownerUserId: req.user._id, status: "approved" });
    if (!p) return res.status(403).json({ error: "Approved provider profile required" });

    const trip = await Trip.create({
      titleAr: req.body.titleAr,
      titleEn: req.body.titleEn,
      category: req.body.category,
      durationMinutes: req.body.durationMinutes,
      departureLocation: req.body.departureLocation,
      active: req.body.active !== false,
      pricing: serverPricing(req.body.pricing),
      providerId: p._id
    });

    res.status(201).json(trip);
  } catch (e) { next(e); }
});

router.patch("/:tripId", requireAuth, requireRole("provider"), async (req, res, next) => {
  try {
    const p = await Provider.findOne({ ownerUserId: req.user._id, status: "approved" });
    if (!p) return res.status(403).json({ error: "Approved provider profile required" });

    const trip = await Trip.findOne({ _id: req.params.tripId, providerId: p._id });
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    for (const key of ["titleAr","titleEn","category","durationMinutes","departureLocation","active"]) {
      if (req.body[key] !== undefined) trip[key] = req.body[key];
    }

    if (req.body.pricing) {
      trip.pricing = serverPricing(req.body.pricing, trip.pricing);
    }

    await trip.save();
    res.json(trip);
  } catch (e) { next(e); }
});

router.get("/", async (_req, res, next) => {
  try {
    res.json(await Trip.find({ active: true }).populate("providerId", "businessName"));
  } catch (e) { next(e); }
});

export default router;
