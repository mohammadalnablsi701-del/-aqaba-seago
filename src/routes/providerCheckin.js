import express from "express";
import Booking from "../models/Booking.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireProviderCapability } from "../services/providerAccess.js";
import { auditProviderAction } from "../services/providerAudit.js";
import { deriveTicketLifecycle } from "../services/ticketLifecycle.js";

const router = express.Router();

function rejection(lifecycle, checkedInAt = null) {
  if (lifecycle.state === "checked_in") {
    return { error: "Booking already checked in", code: "already_checked_in", checkedInAt };
  }
  if (lifecycle.state === "departure_cancelled") {
    return { error: "Departure is not open for check-in", code: "departure_cancelled" };
  }
  if (lifecycle.state === "departure_expired") {
    return { error: "Departure is no longer open for check-in", code: "departure_expired" };
  }
  return { error: "Booking is not valid for check-in", code: "ticket_not_boardable" };
}

router.post(
  "/me/bookings/:bookingId/check-in",
  requireAuth,
  requireRole("provider"),
  async (req, res, next) => {
    try {
      const access = await requireProviderCapability(req.user, "checkin");
      const provider = access?.provider;
      if (!provider) return res.status(403).json({ error: "Approved provider access required" });

      const booking = await Booking.findOne({ _id: req.params.bookingId, providerId: provider._id })
        .populate("tripId", "durationMinutes")
        .populate("departureId", "status startsAt");
      if (!booking) return res.status(404).json({ error: "Booking not found" });

      const checkedAt = new Date();
      const lifecycle = deriveTicketLifecycle(booking, { now: checkedAt });
      if (!lifecycle.usable) {
        return res.status(409).json(rejection(lifecycle, booking.checkedInAt || null));
      }

      const claimed = await Booking.findOneAndUpdate(
        { _id: booking._id, providerId: provider._id, status: "confirmed", checkedInAt: null },
        { $set: { checkedInAt: checkedAt, checkedInBy: req.user._id }, $inc: { checkInCount: 1 } },
        { new: true }
      );
      if (!claimed) {
        return res.status(409).json({ error: "Booking already checked in", code: "already_checked_in" });
      }

      await auditProviderAction({
        access,
        user: req.user,
        action: "booking.checkin",
        targetType: "booking",
        targetId: claimed._id,
        summary: "Checked in booking SG-" + String(claimed._id).slice(-8).toUpperCase(),
        metadata: { guests: claimed.seats, method: "manual" }
      });

      res.json({ ok: true, bookingId: claimed._id, checkedInAt: claimed.checkedInAt, guests: claimed.seats });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
