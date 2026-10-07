import express from "express";
import { processPaymentWebhook } from "../services/payments.js";

const router = express.Router();

router.post("/:provider", express.raw({ type: "application/json", limit: "256kb" }), async (req, res) => {
  try {
    const result = await processPaymentWebhook({
      providerName: req.params.provider,
      rawBody: req.body,
      signature: req.headers["x-seago-signature"]
    });

    res.json({ ok: true, duplicate: result.duplicate });
  } catch (err) {
    const provider = String(req.params.provider || "unknown").slice(0, 40);
    const configuredProvider = String(process.env.PAYMENT_PROVIDER || "mock");
    const shouldTrack = provider === configuredProvider && (configuredProvider !== "mock" || process.env.ENABLE_MOCK_CHECKOUT === "true");
    if (shouldTrack) {
      console.error(JSON.stringify({
        event: "payment_webhook_failure",
        provider,
        statusCode: Number(err.statusCode || 400),
        message: String(err.message || "Webhook processing failed").slice(0, 240),
        at: new Date().toISOString()
      }));
    }
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

export default router;
