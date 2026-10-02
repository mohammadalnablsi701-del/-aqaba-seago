import express from "express";
import crypto from "node:crypto";
import Payment from "../models/Payment.js";
import { processPaymentWebhook } from "../services/payments.js";

const router = express.Router();

router.get("/:paymentId", async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).send("Not found");
    }

    const payment = await Payment.findById(req.params.paymentId);
    if (!payment || payment.provider !== "mock") {
      return res.status(404).send("Mock payment not found");
    }

    const amount = Number(payment.amount || 0).toFixed(2);
    res.type("html").send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Aqaba SeaGo Payment</title>
<style>
body{margin:0;font-family:Arial,sans-serif;background:#eef7fb;color:#0b3d91;display:grid;min-height:100vh;place-items:center;padding:20px}
.card{width:min(420px,100%);background:#fff;border-radius:24px;padding:24px;box-shadow:0 20px 50px rgba(0,40,80,.14)}
h1{margin:0 0 8px;font-size:28px}.muted{color:#728295}.amount{font-size:34px;font-weight:800;margin:20px 0}
button{width:100%;border:0;border-radius:14px;padding:15px;font-size:16px;font-weight:700;margin-top:10px}
.pay{background:linear-gradient(90deg,#0288D1,#00BCD4);color:white}.fail{background:#eef2f5;color:#5c6978}
.msg{margin-top:14px;font-size:14px}
</style>
</head>
<body>
<div class="card">
  <div class="muted">Aqaba SeaGo · Test Checkout</div>
  <h1>Complete payment</h1>
  <div class="amount">${amount} ${payment.currency}</div>
  <p class="muted">This is the mock gateway used for development until the live Jordan payment provider is connected.</p>
  <button class="pay" onclick="complete('paid')">Pay now</button>
  <button class="fail" onclick="complete('failed')">Simulate failure</button>
  <div class="msg" id="msg"></div>
</div>
<script>
async function complete(status){
  const msg=document.getElementById('msg');
  msg.textContent='Processing...';
  const r=await fetch(location.pathname+'/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});
  const j=await r.json();
  if(r.ok && status==='paid'){
    msg.textContent='Payment confirmed. Your booking is now confirmed. You can return to SeaGo and open Tickets.';
  } else {
    msg.textContent=j.error || 'Payment was not completed.';
  }
}
</script>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
});

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
