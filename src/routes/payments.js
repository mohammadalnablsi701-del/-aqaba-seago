import { reserveCheckout } from "../services/checkout.js";
import express from "express";
import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateAllowedFields, isIntegerInRange, isOneOf } from "../middleware/validation.js";
import { createCheckoutForHold } from "../services/payments.js";

const router = express.Router();
const CHECKOUT_FIELDS = new Set(["departureId", "adults", "children", "seats", "mealPlan"]);
const MEAL_PLANS = ["without_buffet", "with_buffet"];

router.post("/checkout", requireAuth, requireRole("customer"), async (req, res, next) => {
  try {
    const fieldError = validateAllowedFields(req.body, CHECKOUT_FIELDS);
    if (fieldError) return res.status(400).json({ error: fieldError });

    const key = String(req.headers["idempotency-key"] || "").trim();
    if (!key) return res.status(400).json({ error: "Idempotency-Key header required" });
    if (key.length > 128) return res.status(400).json({ error: "Idempotency-Key is too long" });

    const departureId = req.body.departureId;
    if (typeof departureId !== "string" || !mongoose.isValidObjectId(departureId)) {
      return res.status(400).json({ error: "Invalid departureId" });
    }

    if (req.body.adults !== undefined && req.body.seats !== undefined) {
      return res.status(400).json({ error: "Use adults or seats, not both" });
    }

    const adults = req.body.adults ?? req.body.seats ?? 0;
    const children = req.body.children ?? 0;
    const mealPlan = req.body.mealPlan ?? "without_buffet";

    if (!isIntegerInRange(adults, { min: 0, max: 500 })) {
      return res.status(400).json({ error: "Invalid adults" });
    }
    if (!isIntegerInRange(children, { min: 0, max: 500 })) {
      return res.status(400).json({ error: "Invalid children" });
    }
    if (!isOneOf(mealPlan, MEAL_PLANS)) {
      return res.status(400).json({ error: "Invalid mealPlan" });
    }

    const seats = adults + children;
    if (seats < 1 || seats > 500) {
      return res.status(400).json({ error: "Guest count must be between 1 and 500" });
    }

    const hold = await reserveCheckout({ customerId: req.user._id, key, departureId, adults, children, mealPlan });

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
    if (!mongoose.isValidObjectId(req.params.paymentId)) {
      return res.status(400).json({ error: "Invalid paymentId" });
    }
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
