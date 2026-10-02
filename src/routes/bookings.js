import express from "express";
import Booking from "../models/Booking.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, requireRole("customer"), async (req, res, next) => {
  try {
    const rows = await Booking.find({ customerId: req.user._id, status: "confirmed" })
      .populate({ path: "tripId", select: "titleAr titleEn category durationMinutes" })
      .populate({ path: "providerId", select: "businessName" })
      .populate({ path: "departureId", select: "startsAt status" })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, requireRole("customer"), async (_req, res) => {
  res.status(410).json({ error: "Bookings are created only after successful payment" });
});

export default router;
