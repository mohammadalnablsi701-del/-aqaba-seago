import express from "express";
import CheckoutHold from "../models/CheckoutHold.js";
import Departure from "../models/Departure.js";
import Trip from "../models/Trip.js";
import Payment from "../models/Payment.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { calculateTieredPricing } from "../services/pricing.js";
import { createCheckoutForHold } from "../services/payments.js";

const router = express.Router();

router.post("/checkout", requireAuth, requireRole("customer"), async (req, res, next) => {
  try {
    const key = String(req.headers["idempotency-key"] || "").trim();
    if (!key) return res.status(400).json({ error: "Idempotency-Key header required" });
    const adults = Number(req.body.adults ?? req.body.seats ?? 0);
    const children = Number(req.body.children ?? 0);
    const mealPlan = req.body.mealPlan === "with_buffet" ? "with_buffet" : "without_buffet";
    if (!Number.isInteger(adults) || adults < 0) return res.status(400).json({ error: "Invalid adults" });
    if (!Number.isInteger(children) || children < 0) return res.status(400).json({ error: "Invalid children" });
    const seats = adults + children;
    if (seats < 1) return res.status(400).json({ error: "At least one guest is required" });

    let hold = await CheckoutHold.findOne({ customerId: req.user._id, idempotencyKey: key });
    if (hold) {
      const sameRequest =
        String(hold.departureId) === String(req.body.departureId || "") &&
        Number(hold.adults || 0) === adults &&
        Number(hold.children || 0) === children &&
        String(hold.mealPlan || "without_buffet") === mealPlan;
      if (!sameRequest) {
        return res.status(409).json({ error: "Idempotency-Key already used for a different checkout" });
      }
    }
    if (!hold) {
      const departure = await Departure.findOneAndUpdate(
        { _id: req.body.departureId, status: "scheduled", startsAt: { $gte: new Date() },
          $expr: { $lte: [{ $add: ["$reservedSeats", seats] }, "$capacity"] } },
        { $inc: { reservedSeats: seats } }, { new: true }
      );
      if (!departure) return res.status(409).json({ error: "Departure unavailable or not enough seats" });
      try {
        const trip = await Trip.findById(departure.tripId);
        if (!trip || !trip.active) throw new Error("Trip unavailable");
        const pricing = calculateTieredPricing({ pricing: trip.pricing, adults, children, mealPlan });
        const minutes = Number(process.env.BOOKING_HOLD_MINUTES || 10);
        hold = await CheckoutHold.create({
          customerId: req.user._id, providerId: trip.providerId, tripId: trip._id,
          departureId: departure._id, seats, adults, children, mealPlan, pricing, idempotencyKey: key,
          expiresAt: new Date(Date.now() + minutes * 60000)
        });
      } catch (e) {
        await Departure.updateOne({ _id: departure._id }, { $inc: { reservedSeats: -seats } });
        throw e;
      }
    }

    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const payment = await createCheckoutForHold({ hold, customerId: req.user._id, baseUrl });
    res.status(201).json({
      paymentId: payment._id, provider: payment.provider, status: payment.status,
      amount: payment.amount, currency: payment.currency, checkoutUrl: payment.checkoutUrl,
      expiresAt: hold.expiresAt
    });
  } catch (err) { next(err); }
});

router.get("/:paymentId", requireAuth, requireRole("customer"), async (req, res, next) => {
  try {
    const payment = await Payment.findOne({
      _id: req.params.paymentId,
      customerId: req.user._id
    });

    if (!payment) return res.status(404).json({ error: "Payment not found" });
    res.json(payment);
  } catch (err) {
    next(err);
  }
});

export default router;
