import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import Payment from "../src/models/Payment.js";
import Refund from "../src/models/Refund.js";
import {
  applyProviderRefundResult,
  ensureRefundIntent,
  executeRefundIntent
} from "../src/services/refunds.js";

const uri = process.env.SEAGO_TEST_MONGODB_URI;

test("refund retry semantics distinguish definite failure, pending and review states", { skip: !uri }, async t => {
  assert.match(uri, /^mongodb:\/\/(127\.0\.0\.1|localhost):/, "Only a local disposable replica set is allowed");
  await mongoose.connect(uri, { dbName: "seago_refund_retry_" + crypto.randomUUID().replaceAll("-", "") });
  t.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  await Promise.all([Payment, Refund].map(model => model.init()));

  async function payment(marker, amount = 20) {
    return Payment.create({
      holdId: new mongoose.Types.ObjectId(),
      customerId: new mongoose.Types.ObjectId(),
      provider: "mock",
      externalPaymentId: `mock_retry_${marker}`,
      status: "paid",
      amount,
      currency: "JOD",
      paidAt: new Date()
    });
  }

  async function refundIntent(paymentDoc, marker, amount) {
    return ensureRefundIntent({
      paymentId: paymentDoc._id,
      amount,
      currency: "JOD",
      intentType: "retry_test",
      intentId: marker
    });
  }

  await t.test("definite provider failure releases reservation and does not claim a refund", async () => {
    const p = await payment("definite");
    const refund = await refundIntent(p, "definite", 8);
    let calls = 0;
    const provider = {
      async findRefundByReference() { return null; },
      async refundPayment() {
        calls += 1;
        throw Object.assign(new Error("definite decline"), { definite: true });
      }
    };
    const result = await executeRefundIntent({ refundReference: refund.reference, providerOverride: provider });
    assert.equal(result.refund.state, "failed");
    assert.equal(calls, 1);
    const after = await Payment.findById(p._id).lean();
    assert.equal(after.refundedAmount, 0);
    assert.equal(after.refundReservedAmount, 0);
    assert.equal(after.status, "paid");
  });

  await t.test("provider pending result reserves money until later reconciliation succeeds", async () => {
    const p = await payment("pending");
    const refund = await refundIntent(p, "pending", 8);
    const provider = {
      async findRefundByReference() { return null; },
      async refundPayment(request) {
        return {
          refundReference: request.refundReference,
          providerRefundId: "pending_provider_refund",
          status: "pending",
          amount: request.amount,
          currency: request.currency
        };
      }
    };
    const pending = await executeRefundIntent({ refundReference: refund.reference, providerOverride: provider });
    assert.equal(pending.refund.state, "pending");
    let after = await Payment.findById(p._id).lean();
    assert.equal(after.refundedAmount, 0);
    assert.equal(after.refundReservedAmount, 8);
    assert.equal(after.status, "paid");

    const completed = await applyProviderRefundResult({
      refundReference: refund.reference,
      providerName: "mock",
      result: {
        refundReference: refund.reference,
        providerRefundId: "pending_provider_refund",
        status: "succeeded",
        amount: 8,
        currency: "JOD"
      }
    });
    assert.equal(completed.refund.state, "succeeded");
    after = await Payment.findById(p._id).lean();
    assert.equal(after.refundedAmount, 8);
    assert.equal(after.refundReservedAmount, 0);
    assert.equal(after.status, "partially_refunded");
  });

  await t.test("a valid refund cannot erase needs_review raised by a conflicting concurrent intent", async () => {
    const p = await payment("review-preserved", 10);
    const valid = await refundIntent(p, "valid-six", 6);
    const blocked = await refundIntent(await Payment.findById(p._id), "blocked-six", 6);
    assert.equal(blocked.state, "needs_review");
    assert.equal(blocked.reviewReason, "over_refund");

    const provider = {
      async findRefundByReference() { return null; },
      async refundPayment(request) {
        return {
          refundReference: request.refundReference,
          providerRefundId: "review_preservation_valid_refund",
          status: "succeeded",
          amount: request.amount,
          currency: request.currency
        };
      }
    };
    await executeRefundIntent({ refundReference: valid.reference, providerOverride: provider });
    const after = await Payment.findById(p._id).lean();
    assert.equal(after.refundedAmount, 6);
    assert.equal(after.refundReservedAmount, 0);
    assert.equal(after.status, "needs_review");
  });

  await t.test("provider refund ID collision across distinct refunds fails closed", async () => {
    const firstPayment = await payment("provider-id-one");
    const secondPayment = await payment("provider-id-two");
    const first = await refundIntent(firstPayment, "provider-id-one", 5);
    const second = await refundIntent(secondPayment, "provider-id-two", 5);
    const sharedProviderId = "provider_refund_collision";

    await applyProviderRefundResult({
      refundReference: first.reference,
      providerName: "mock",
      result: {
        refundReference: first.reference,
        providerRefundId: sharedProviderId,
        status: "pending",
        amount: 5,
        currency: "JOD"
      }
    });
    const collision = await applyProviderRefundResult({
      refundReference: second.reference,
      providerName: "mock",
      result: {
        refundReference: second.reference,
        providerRefundId: sharedProviderId,
        status: "succeeded",
        amount: 5,
        currency: "JOD"
      }
    });
    assert.equal(collision.refund.state, "needs_review");
    const secondAfter = await Payment.findById(secondPayment._id).lean();
    assert.equal(secondAfter.refundedAmount, 0);
    assert.equal(secondAfter.status, "needs_review");
  });
});
