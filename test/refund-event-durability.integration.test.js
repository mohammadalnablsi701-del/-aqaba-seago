import { cleanupFixtures, requireFixture, connectFixture } from "../scripts/test-safety/fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";

import Payment from "../src/models/Payment.js";
import PaymentEvent from "../src/models/PaymentEvent.js";
import Refund from "../src/models/Refund.js";
import { ensureRefundIntent, processRefundWebhook } from "../src/services/refunds.js";

requireFixture();
test.after(cleanupFixtures);

function sign(rawBody, secret) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

test("refund provider events share the durable PaymentEvent transaction boundary", {}, async t => {

  const previousSecret = process.env.MOCK_PAYMENT_WEBHOOK_SECRET;
  process.env.MOCK_PAYMENT_WEBHOOK_SECRET = "refund-event-durability-secret";

  await connectFixture();
  t.after(async () => {
    if (previousSecret === undefined) delete process.env.MOCK_PAYMENT_WEBHOOK_SECRET;
    else process.env.MOCK_PAYMENT_WEBHOOK_SECRET = previousSecret;
  });
  await Promise.all([Payment, PaymentEvent, Refund].map(model => model.init()));

  async function fixture({ amount = 30, refundAmount = 10 } = {}) {
    const payment = await Payment.create({
      holdId: new mongoose.Types.ObjectId(),
      customerId: new mongoose.Types.ObjectId(),
      provider: "mock",
      externalPaymentId: `mock_payment_${crypto.randomUUID()}`,
      status: "paid",
      amount,
      currency: "JOD",
      paidAt: new Date()
    });
    const refund = await ensureRefundIntent({
      paymentId: payment._id,
      amount: refundAmount,
      currency: "JOD",
      intentType: "task6_refund_event",
      intentId: crypto.randomUUID()
    });
    return { payment, refund };
  }

  async function send(f, {
    eventId = crypto.randomUUID(),
    status = "succeeded",
    amount = f.refund.amount,
    currency = f.refund.currency,
    providerRefundId = `provider_refund_${crypto.randomUUID()}`
  } = {}) {
    const rawBody = Buffer.from(JSON.stringify({
      kind: "refund",
      eventId,
      refundReference: f.refund.reference,
      providerRefundId,
      status,
      amount,
      currency
    }));
    return processRefundWebhook({
      providerName: "mock",
      rawBody,
      signature: sign(rawBody, process.env.MOCK_PAYMENT_WEBHOOK_SECRET)
    });
  }

  async function state(f, eventId) {
    const [payment, refund, event] = await Promise.all([
      Payment.findById(f.payment._id).lean(),
      Refund.findById(f.refund._id).lean(),
      PaymentEvent.findOne({ provider: "mock", eventId }).lean()
    ]);
    return { payment, refund, event };
  }

  await t.test("R1 success commits provider event evidence with Refund and Payment", async () => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    const result = await send(f, { eventId, providerRefundId: "provider_r1" });
    const s = await state(f, eventId);
    assert.equal(result.duplicate, false);
    assert.ok(s.event);
    assert.equal(s.event.eventType, "refund");
    assert.equal(String(s.event.refundId), String(f.refund._id));
    assert.equal(String(s.event.paymentId), String(f.payment._id));
    assert.equal(s.event.eventStatus, "refund_succeeded");
    assert.equal(s.refund.state, "succeeded");
    assert.equal(s.payment.refundedAmount, 10);
    assert.equal(s.payment.refundReservedAmount, 0);
    assert.equal(s.payment.status, "partially_refunded");
  });

  await t.test("R2 PaymentEvent insert failure aborts Refund and Payment transition, then retry succeeds", async sub => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    const stub = sub.mock.method(PaymentEvent, "create", async () => { throw new Error("Injected refund event insert failure"); });
    await assert.rejects(send(f, { eventId, providerRefundId: "provider_r2" }), /Injected refund event insert failure/);
    stub.mock.restore();
    let s = await state(f, eventId);
    assert.equal(s.event, null);
    assert.equal(s.refund.state, "requested");
    assert.equal(s.payment.refundedAmount, 0);
    assert.equal(s.payment.refundReservedAmount, 10);

    await send(f, { eventId, providerRefundId: "provider_r2" });
    s = await state(f, eventId);
    assert.ok(s.event);
    assert.equal(s.refund.state, "succeeded");
    assert.equal(s.payment.refundedAmount, 10);
  });

  await t.test("R3 Refund mutation failure rolls PaymentEvent evidence back", async sub => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    const original = Refund.prototype.save;
    const stub = sub.mock.method(Refund.prototype, "save", function(...args) {
      if (String(this._id) === String(f.refund._id) && this.state === "succeeded") {
        throw new Error("Injected refund update failure");
      }
      return original.apply(this, args);
    });
    await assert.rejects(send(f, { eventId, providerRefundId: "provider_r3" }), /Injected refund update failure/);
    stub.mock.restore();
    const s = await state(f, eventId);
    assert.equal(s.event, null);
    assert.equal(s.refund.state, "requested");
    assert.equal(s.payment.refundedAmount, 0);
    assert.equal(s.payment.refundReservedAmount, 10);
  });

  await t.test("R4 duplicate refund webhook is a safe acknowledgement with one event/effect", async () => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    const args = { eventId, providerRefundId: "provider_r4" };
    const first = await send(f, args);
    const second = await send(f, args);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(await PaymentEvent.countDocuments({ provider: "mock", eventId }), 1);
    const s = await state(f, eventId);
    assert.equal(s.payment.refundedAmount, 10);
    assert.equal(s.refund.state, "succeeded");
  });

  await t.test("R5 concurrent duplicate refund webhook has one durable event and one financial effect", async () => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    const args = { eventId, providerRefundId: "provider_r5" };
    const results = await Promise.all([send(f, args), send(f, args)]);
    assert.ok(results.some(result => result.duplicate === true));
    assert.equal(await PaymentEvent.countDocuments({ provider: "mock", eventId }), 1);
    const s = await state(f, eventId);
    assert.equal(s.payment.refundedAmount, 10);
    assert.equal(s.refund.state, "succeeded");
  });

  await t.test("R6 wrong refund amount commits needs_review with durable event and no refund accumulation", async () => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    await send(f, { eventId, amount: 11, providerRefundId: "provider_r6" });
    const s = await state(f, eventId);
    assert.ok(s.event);
    assert.equal(s.event.eventType, "refund");
    assert.equal(s.refund.state, "needs_review");
    assert.equal(s.payment.status, "needs_review");
    assert.equal(s.payment.refundedAmount, 0);
  });

  await t.test("R7 invalid refund eventId is rejected before durable financial evidence", async () => {
    const f = await fixture();
    const rawBody = Buffer.from(JSON.stringify({
      kind: "refund",
      eventId: { injected: true },
      refundReference: f.refund.reference,
      providerRefundId: "provider_r7",
      status: "succeeded",
      amount: 10,
      currency: "JOD"
    }));
    await assert.rejects(
      processRefundWebhook({ providerName: "mock", rawBody, signature: sign(rawBody, process.env.MOCK_PAYMENT_WEBHOOK_SECRET) }),
      { statusCode: 400 }
    );
    assert.equal(await PaymentEvent.countDocuments({ paymentId: f.payment._id }), 0);
    assert.equal((await Refund.findById(f.refund._id).lean()).state, "requested");
  });

  await t.test("R8 missing parent Payment aborts webhook with neither event nor Refund mutation", async () => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    await Payment.deleteOne({ _id: f.payment._id });
    await assert.rejects(
      send(f, { eventId, providerRefundId: "provider_r8" }),
      { statusCode: 409 }
    );
    assert.equal(await PaymentEvent.countDocuments({ provider: "mock", eventId }), 0);
    const refund = await Refund.findById(f.refund._id).lean();
    assert.equal(refund.state, "requested");
    assert.equal(refund.reviewReason, undefined);
  });
});