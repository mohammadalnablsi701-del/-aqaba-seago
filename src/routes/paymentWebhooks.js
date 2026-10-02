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
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

export default router;
