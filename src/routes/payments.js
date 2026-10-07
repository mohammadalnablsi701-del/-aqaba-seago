import { reserveCheckout } from "../services/checkout.js";
import express from "express";
import Payment from "../models/Payment.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
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

    const hold=await reserveCheckout({customerId:req.user._id,key,departureId:req.body.departureId,adults,children,mealPlan});

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
