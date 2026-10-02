import express from "express";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { createCheckoutForBooking } from "../services/payments.js";

const router = express.Router();

router.post("/checkout", requireAuth, requireRole("customer"), async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.body.bookingId);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const payment = await createCheckoutForBooking({
      booking,
      customerId: req.user._id,
      baseUrl
    });

    res.status(201).json({
      paymentId: payment._id,
      bookingId: payment.bookingId,
      provider: payment.provider,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      checkoutUrl: payment.checkoutUrl
    });
  } catch (err) {
    next(err);
  }
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
