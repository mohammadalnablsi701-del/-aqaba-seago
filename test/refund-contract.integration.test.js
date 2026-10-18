import { cleanupFixtures, requireFixture, connectFixture } from "../scripts/test-safety/fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import Payment from "../src/models/Payment.js";
import Refund from "../src/models/Refund.js";
import { createMockProvider } from "../src/payments/providers/mock.js";
import {
  applyProviderRefundResult,
  ensureRefundIntent,
  executeRefundIntent,
  processRefundWebhook,
  reconcileRefund,
  refundReferenceFor
} from "../src/services/refunds.js";

requireFixture();
test.after(cleanupFixtures);

function hmac(raw, secret) {
  return crypto.createHmac("sha256", secret).update(raw).digest("hex");
}

test("provider-neutral refund contract is durable, idempotent and reconciliation-safe", {}, async t => {

  await connectFixture();
  t.after(async () => {
  });
  await Promise.all([Payment, Refund].map(model => model.init()));

  async function paymentFixture({ amount = 100, currency = "JOD", provider = "mock", marker = crypto.randomUUID() } = {}) {
    return Payment.create({
      holdId: new mongoose.Types.ObjectId(),
      customerId: new mongoose.Types.ObjectId(),
      provider,
      externalPaymentId: `${provider}_payment_${marker}`,
      status: "paid",
      amount,
      currency,
      paidAt: new Date()
    });
  }

  async function intent(payment, { amount, intentId = crypto.randomUUID(), intentType = "test_refund", bookingId = null, currency = payment.currency } = {}) {
    return ensureRefundIntent({
      paymentId: payment._id,
      bookingId,
      amount,
      currency,
      intentType,
      intentId
    });
  }

  await t.test("A/O full refund succeeds and sets Payment refunded", async () => {
    const payment = await paymentFixture({ amount: 40, marker: "full" });
    const refund = await intent(payment, { amount: 40, intentId: "full" });
    assert.equal(refund.state, "requested");
    assert.match(refund.reference, /^rf_[a-f\d]{32}$/);
    const before = await Payment.findById(payment._id).lean();
    assert.equal(before.refundedAmount, 0);
    assert.equal(before.refundReservedAmount, 40, "refund amount is reserved before provider side effect");

    const result = await executeRefundIntent({ refundReference: refund.reference });
    assert.equal(result.refund.state, "succeeded");
    const after = await Payment.findById(payment._id).lean();
    assert.equal(after.refundedAmount, 40);
    assert.equal(after.refundReservedAmount, 0);
    assert.equal(after.status, "refunded");
  });

  await t.test("B/P partial refund succeeds and sets Payment partially_refunded", async () => {
    const payment = await paymentFixture({ amount: 40, marker: "partial" });
    const refund = await intent(payment, { amount: 15, intentId: "partial" });
    await executeRefundIntent({ refundReference: refund.reference });
    const after = await Payment.findById(payment._id).lean();
    assert.equal(after.refundedAmount, 15);
    assert.equal(after.status, "partially_refunded");
  });

  await t.test("C/G same refund intent keeps one deterministic identity across retries", async () => {
    const payment = await paymentFixture({ amount: 30, marker: "retry" });
    const args = {
      paymentId: payment._id,
      amount: 10,
      currency: "JOD",
      intentType: "test_refund",
      intentId: "same-intent"
    };
    const first = await ensureRefundIntent(args);
    const second = await ensureRefundIntent(args);
    assert.equal(second.reference, first.reference);
    assert.equal(second.idempotencyKey, first.idempotencyKey);
    assert.equal(await Refund.countDocuments({ paymentId: payment._id }), 1);
    assert.equal((await Payment.findById(payment._id).lean()).refundReservedAmount, 10);

    await executeRefundIntent({ refundReference: first.reference });
    await executeRefundIntent({ refundReference: first.reference });
    const after = await Payment.findById(payment._id).lean();
    assert.equal(after.refundedAmount, 10, "retry cannot move money twice");
    assert.equal(after.refundReservedAmount, 0);
  });

  await t.test("D concurrent duplicate intent produces one financial transition", async () => {
    const payment = await paymentFixture({ amount: 25, marker: "concurrent-duplicate" });
    const args = {
      paymentId: payment._id,
      amount: 10,
      currency: "JOD",
      intentType: "test_refund",
      intentId: "concurrent-same"
    };
    const [a, b] = await Promise.all([ensureRefundIntent(args), ensureRefundIntent(args)]);
    assert.equal(a.reference, b.reference);
    assert.equal(await Refund.countDocuments({ reference: a.reference }), 1);
    await Promise.all([
      executeRefundIntent({ refundReference: a.reference }),
      executeRefundIntent({ refundReference: a.reference })
    ]);
    const after = await Payment.findById(payment._id).lean();
    assert.equal(after.refundedAmount, 10);
    assert.equal(after.refundReservedAmount, 0);
  });

  await t.test("E/F crash after provider success is recovered by the same SeaGo reference", async () => {
    const payment = await paymentFixture({ amount: 35, marker: "crash" });
    const refund = await intent(payment, { amount: 20, intentId: "crash-window" });
    const provider = createMockProvider();
    const providerResult = await provider.refundPayment({
      refundReference: refund.reference,
      providerIdempotencyKey: refund.idempotencyKey,
      externalPaymentId: payment.externalPaymentId,
      amount: refund.amount,
      currency: refund.currency
    });
    assert.equal(providerResult.status, "succeeded", "provider side effect completed");

    const crashedState = await Refund.findById(refund._id).lean();
    const crashedPayment = await Payment.findById(payment._id).lean();
    assert.equal(crashedState.state, "requested", "SeaGo persistence after the provider call is intentionally absent in the crash window");
    assert.equal(crashedPayment.refundedAmount, 0);
    assert.equal(crashedPayment.refundReservedAmount, 20);

    const recovered = await reconcileRefund({ refundReference: refund.reference, providerOverride: provider });
    assert.equal(recovered.refund.state, "succeeded");
    const after = await Payment.findById(payment._id).lean();
    assert.equal(after.refundedAmount, 20);
    assert.equal(after.refundReservedAmount, 0);
    assert.equal((await Refund.findById(refund._id).lean()).providerRefundId, providerResult.providerRefundId);
  });

  await t.test("G ambiguous timeout never causes a blind second provider refund", async () => {
    const payment = await paymentFixture({ amount: 30, marker: "ambiguous" });
    const refund = await intent(payment, { amount: 10, intentId: "ambiguous-timeout" });
    let refundCalls = 0;
    const timeoutProvider = {
      async findRefundByReference() { return null; },
      async refundPayment() {
        refundCalls += 1;
        throw new Error("simulated timeout");
      }
    };
    const first = await executeRefundIntent({ refundReference: refund.reference, providerOverride: timeoutProvider });
    assert.equal(first.refund.state, "pending");
    assert.equal(first.ambiguous, true);
    await executeRefundIntent({ refundReference: refund.reference, providerOverride: timeoutProvider });
    assert.equal(refundCalls, 1, "pending ambiguous refund must reconcile only, never resend blindly");
    const after = await Payment.findById(payment._id).lean();
    assert.equal(after.refundedAmount, 0);
    assert.equal(after.refundReservedAmount, 10);
  });

  await t.test("G timeout after provider success is recovered by lookup without duplicate movement", async () => {
    const payment = await paymentFixture({ amount: 30, marker: "timeout-success" });
    const refund = await intent(payment, { amount: 12, intentId: "timeout-after-success" });
    const base = createMockProvider();
    let calls = 0;
    const responseLostProvider = {
      findRefundByReference: args => base.findRefundByReference(args),
      async refundPayment(args) {
        calls += 1;
        await base.refundPayment(args);
        throw new Error("response lost after provider success");
      }
    };
    const result = await executeRefundIntent({ refundReference: refund.reference, providerOverride: responseLostProvider });
    assert.equal(result.refund.state, "succeeded");
    assert.equal(calls, 1);
    await executeRefundIntent({ refundReference: refund.reference, providerOverride: responseLostProvider });
    assert.equal(calls, 1);
    assert.equal((await Payment.findById(payment._id).lean()).refundedAmount, 12);
  });

  await t.test("H wrong refund reference causes no financial mutation", async () => {
    const payment = await paymentFixture({ amount: 20, marker: "wrong-ref" });
    const refund = await intent(payment, { amount: 5, intentId: "correct-ref" });
    await assert.rejects(
      applyProviderRefundResult({
        refundReference: "rf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        providerName: "mock",
        result: { status: "succeeded", amount: 5, currency: "JOD", providerRefundId: "wrong_ref_provider" }
      }),
      /Refund not found/
    );
    const after = await Payment.findById(payment._id).lean();
    assert.equal(after.refundedAmount, 0);
    assert.equal(after.refundReservedAmount, 5);
    assert.equal((await Refund.findById(refund._id).lean()).state, "requested");
  });

  await t.test("I correct reference with wrong amount becomes needs_review without money movement", async () => {
    const payment = await paymentFixture({ amount: 20, marker: "wrong-amount" });
    const refund = await intent(payment, { amount: 5, intentId: "wrong-amount" });
    const result = await applyProviderRefundResult({
      refundReference: refund.reference,
      providerName: "mock",
      result: { refundReference: refund.reference, status: "succeeded", amount: 6, currency: "JOD", providerRefundId: "wrong_amount_provider" }
    });
    assert.equal(result.refund.state, "needs_review");
    const after = await Payment.findById(payment._id).lean();
    assert.equal(after.status, "needs_review");
    assert.equal(after.refundedAmount, 0);
  });

  await t.test("J correct reference with wrong currency becomes needs_review", async () => {
    const payment = await paymentFixture({ amount: 20, marker: "wrong-currency" });
    const refund = await intent(payment, { amount: 5, intentId: "wrong-currency" });
    const result = await applyProviderRefundResult({
      refundReference: refund.reference,
      providerName: "mock",
      result: { refundReference: refund.reference, status: "succeeded", amount: 5, currency: "USD", providerRefundId: "wrong_currency_provider" }
    });
    assert.equal(result.refund.state, "needs_review");
    assert.equal((await Payment.findById(payment._id).lean()).refundedAmount, 0);
  });

  await t.test("K conflicting providerRefundId becomes needs_review", async () => {
    const payment = await paymentFixture({ amount: 20, marker: "provider-id-conflict" });
    const refund = await intent(payment, { amount: 5, intentId: "provider-id-conflict" });
    await applyProviderRefundResult({
      refundReference: refund.reference,
      providerName: "mock",
      result: { refundReference: refund.reference, status: "pending", amount: 5, currency: "JOD", providerRefundId: "provider_refund_original" }
    });
    const conflict = await applyProviderRefundResult({
      refundReference: refund.reference,
      providerName: "mock",
      result: { refundReference: refund.reference, status: "succeeded", amount: 5, currency: "JOD", providerRefundId: "provider_refund_conflict" }
    });
    assert.equal(conflict.refund.state, "needs_review");
    assert.equal((await Payment.findById(payment._id).lean()).refundedAmount, 0);
  });

  await t.test("L over-refund is blocked before provider movement", async () => {
    const payment = await paymentFixture({ amount: 10, marker: "over-refund" });
    const first = await intent(payment, { amount: 8, intentId: "over-one" });
    const second = await intent(payment, { amount: 3, intentId: "over-two" });
    assert.equal(first.state, "requested");
    assert.equal(second.state, "needs_review");
    assert.equal(second.reviewReason, "over_refund");
    const after = await Payment.findById(payment._id).lean();
    assert.equal(after.refundReservedAmount, 8);
    assert.equal(after.refundedAmount, 0);
    assert.equal(after.status, "needs_review");
  });

  await t.test("M concurrent partial refund intents cannot reserve more than paid amount", async () => {
    const payment = await paymentFixture({ amount: 10, marker: "concurrent-over" });
    const [a, b] = await Promise.all([
      intent(payment, { amount: 6, intentId: "concurrent-a" }),
      intent(payment, { amount: 6, intentId: "concurrent-b" })
    ]);
    const states = [a.state, b.state].sort();
    assert.deepEqual(states, ["needs_review", "requested"]);
    const after = await Payment.findById(payment._id).lean();
    assert.equal(after.refundReservedAmount, 6);
    assert.equal(after.refundedAmount, 0);
    assert.equal(await Refund.countDocuments({ paymentId: payment._id }), 2);
  });

  await t.test("N duplicate concurrent refund webhook cannot double-increment refundedAmount", async () => {
    const previousSecret = process.env.MOCK_PAYMENT_WEBHOOK_SECRET;
    process.env.MOCK_PAYMENT_WEBHOOK_SECRET = "refund-webhook-test-secret";
    t.after(() => {
      if (previousSecret === undefined) delete process.env.MOCK_PAYMENT_WEBHOOK_SECRET;
      else process.env.MOCK_PAYMENT_WEBHOOK_SECRET = previousSecret;
    });
    const payment = await paymentFixture({ amount: 30, marker: "duplicate-webhook" });
    const refund = await intent(payment, { amount: 10, intentId: "duplicate-webhook" });
    const rawBody = Buffer.from(JSON.stringify({
      kind: "refund",
      eventId: "refund_duplicate_event",
      refundReference: refund.reference,
      providerRefundId: "provider_duplicate_webhook",
      status: "succeeded",
      amount: 10,
      currency: "JOD"
    }));
    const signature = hmac(rawBody, process.env.MOCK_PAYMENT_WEBHOOK_SECRET);
    const results = await Promise.all([
      processRefundWebhook({ providerName: "mock", rawBody, signature }),
      processRefundWebhook({ providerName: "mock", rawBody, signature })
    ]);
    assert.ok(results.some(value => value.duplicate === true));
    const after = await Payment.findById(payment._id).lean();
    assert.equal(after.refundedAmount, 10);
    assert.equal(after.refundReservedAmount, 0);
    assert.equal((await Refund.findById(refund._id).lean()).state, "succeeded");
  });

  await t.test("multiple partial refunds accumulate exactly and reach full refund", async () => {
    const payment = await paymentFixture({ amount: 15, marker: "accumulate" });
    const first = await intent(payment, { amount: 10, intentId: "accumulate-10" });
    await executeRefundIntent({ refundReference: first.reference });
    assert.equal((await Payment.findById(payment._id).lean()).refundedAmount, 10);
    const second = await intent(await Payment.findById(payment._id), { amount: 5, intentId: "accumulate-5" });
    await executeRefundIntent({ refundReference: second.reference });
    const after = await Payment.findById(payment._id).lean();
    assert.equal(after.refundedAmount, 15);
    assert.equal(after.status, "refunded");
  });

  await t.test("amount precision follows existing two-decimal money rules", async () => {
    const payment = await paymentFixture({ amount: 0.3, marker: "precision" });
    const first = await intent(payment, { amount: 0.1, intentId: "precision-a" });
    await executeRefundIntent({ refundReference: first.reference });
    const current = await Payment.findById(payment._id);
    const second = await intent(current, { amount: 0.2, intentId: "precision-b" });
    await executeRefundIntent({ refundReference: second.reference });
    const after = await Payment.findById(payment._id).lean();
    assert.equal(after.refundedAmount, 0.3);
    assert.equal(after.refundReservedAmount, 0);
    assert.equal(after.status, "refunded");
  });

  await t.test("R unsupported future provider remains safely needs_review without claiming success", async () => {
    const payment = await paymentFixture({ amount: 20, provider: "future_gateway", marker: "future-provider" });
    const refund = await intent(payment, { amount: 10, intentId: "future-provider" });
    const result = await executeRefundIntent({ refundReference: refund.reference });
    assert.equal(result.refund.state, "needs_review");
    assert.equal(result.refund.reviewReason, "provider_unavailable");
    const after = await Payment.findById(payment._id).lean();
    assert.equal(after.refundedAmount, 0);
    assert.equal(after.refundReservedAmount, 10);
    assert.equal(after.status, "needs_review");
  });

  await t.test("SeaGo refund reference is deterministic, internal and independent of provider refund ID", async () => {
    const payment = await paymentFixture({ amount: 20, marker: "reference" });
    const calculated = refundReferenceFor({ paymentId: payment._id, intentType: "test_refund", intentId: "stable" });
    const refund = await intent(payment, { amount: 5, intentId: "stable" });
    assert.equal(refund.reference, calculated);
    assert.equal(refund.idempotencyKey, `refund:${calculated}`);
    assert.equal(refund.providerRefundId, undefined);
    await executeRefundIntent({ refundReference: refund.reference });
    const completed = await Refund.findById(refund._id).lean();
    assert.equal(completed.reference, calculated);
    assert.ok(completed.providerRefundId);
    assert.notEqual(completed.reference, completed.providerRefundId);
  });
});
