import express from "express";
import Booking from "../models/Booking.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { signTicketToken } from "../services/tickets.js";

const router = express.Router();

router.get("/", requireAuth, requireRole("customer"), async (req, res, next) => {
  try {
    const rows = await Booking.find({ customerId: req.user._id, status: "confirmed" })
      .populate({ path: "tripId", select: "titleAr titleEn category durationMinutes departureLocation" })
      .populate({ path: "providerId", select: "businessName" })
      .populate({ path: "departureId", select: "startsAt status" })
      .sort({ createdAt: -1 })
      .limit(100);
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    res.json(rows.map(row => {
      const obj = row.toObject();
      const ticketToken = signTicketToken(row);
      return {
        ...obj,
        ticketToken,
        ticketValidationUrl: `${baseUrl}/api/tickets/validate?token=${encodeURIComponent(ticketToken)}`
      };
    }));
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, requireRole("customer"), async (_req, res) => {
  res.status(410).json({ error: "Bookings are created only after successful payment" });
});

export default router;
