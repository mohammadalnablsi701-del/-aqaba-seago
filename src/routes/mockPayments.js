import express from "express";
import crypto from "node:crypto";
import Payment from "../models/Payment.js";
import { processPaymentWebhook } from "../services/payments.js";

const router = express.Router();

router.post("/:paymentId/complete", async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }

    const payment = await Payment.findById(req.params.paymentId);
    if (!payment || payment.provider !== "mock") {
      return res.status(404).json({ error: "Mock payment not found" });
    }

    const payload = Buffer.from(JSON.stringify({
      eventId: `evt_${Date.now()}_${payment._id}`,
      externalPaymentId: payment.externalPaymentId,
      status: req.body.status || "paid",
      amount: payment.amount,
      currency: payment.currency
    }));

    const signature = crypto
      .createHmac("sha256", process.env.MOCK_PAYMENT_WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");

    const result = await processPaymentWebhook({
      providerName: "mock",
      rawBody: payload,
      signature
    });

    res.json({
      ok: true,
      paymentStatus: result.payment.status,
      bookingId: result.payment.bookingId
    });
  } catch (err) {
    next(err);
  }
});

export default router;
