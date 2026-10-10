import express from "express";
import Payment from "../models/Payment.js";
import NotificationLog from "../models/NotificationLog.js";
import SupportRequest from "../models/SupportRequest.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

router.get("/", async (_req, res, next) => {
  try {
    const notificationWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const openSupportFilter = { status: { $in: ["open", "in_progress"] } };

    const [
      needsReviewCount,
      needsReview,
      notificationFailureCount,
      notificationFailures,
      openSupportCount,
      openSupport
    ] = await Promise.all([
      Payment.countDocuments({ status: "needs_review" }),
      Payment.find({ status: "needs_review" })
        .select("bookingId customerId provider externalPaymentId amount currency status createdAt updatedAt")
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean(),
      NotificationLog.countDocuments({
        status: "failed",
        createdAt: { $gte: notificationWindowStart }
      }),
      NotificationLog.find({
        status: "failed",
        createdAt: { $gte: notificationWindowStart }
      })
        .select("type provider status error createdAt bookingId")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      SupportRequest.countDocuments(openSupportFilter),
      SupportRequest.find(openSupportFilter)
        .select("customerId bookingId bookingReference subject status createdAt updatedAt")
        .populate("customerId", "name")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean()
    ]);

    res.json({
      generatedAt: new Date(),
      healthy: needsReviewCount === 0 && notificationFailureCount === 0,
      alerts: {
        paymentNeedsReview: needsReviewCount,
        notificationFailures24h: notificationFailureCount,
        openSupport: openSupportCount
      },
      queues: {
        paymentNeedsReview: needsReview,
        notificationFailures: notificationFailures.map(item => ({
          ...item,
          error: item.error ? String(item.error).slice(0, 240) : ""
        })),
        openSupport
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
