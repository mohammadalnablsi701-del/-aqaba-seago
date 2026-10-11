import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import User from "../src/models/User.js";
import Payment from "../src/models/Payment.js";
import Refund from "../src/models/Refund.js";

const uri = process.env.SEAGO_TEST_MONGODB_URI;

test("admin payment detail exposes safe refund reconciliation metadata only", { skip: !uri }, async t => {
  assert.match(uri, /^mongodb:\/\/(127\.0\.0\.1|localhost):/, "Only a local disposable replica set is allowed");
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "refund-admin-visibility-secret-at-least-32-characters";
  await mongoose.connect(uri, { dbName: "seago_refund_admin_" + crypto.randomUUID().replaceAll("-", "") });
  t.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });
  await Promise.all([User, Payment, Refund].map(model => model.init()));

  const admin = await User.create({ name: "Refund Admin", email: "refund-admin@example.test", role: "admin" });
  const customer = await User.create({ name: "Refund Customer", email: "refund-customer@example.test", role: "customer" });
  const payment = await Payment.create({
    holdId: new mongoose.Types.ObjectId(),
    customerId: customer._id,
    provider: "mock",
    externalPaymentId: "mock_refund_admin_visibility",
    status: "paid",
    amount: 25,
    currency: "JOD",
    paidAt: new Date(),
    refundReservedAmount: 10
  });
  const refund = await Refund.create({
    paymentId: payment._id,
    provider: "mock",
    reference: "rf_44444444444444444444444444444444",
    idempotencyKey: "refund:rf_44444444444444444444444444444444",
    intentType: "test_refund",
    intentId: "admin-visible-refund",
    amount: 10,
    currency: "JOD",
    state: "pending",
    providerRefundId: "mock_safe_refund_reference",
    providerStatus: "pending",
    attemptCount: 1,
    requestedAt: new Date()
  });

  const token = jwt.sign({ sub: String(admin._id), ver: admin.authVersion || 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/payments/${payment._id}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.refund.state, "pending");
  assert.equal(body.refund.amount, 0, "aggregate refunded amount remains zero while provider refund is pending");
  assert.equal(body.refund.requestedAmount, 10);
  assert.equal(body.refund.reference, refund.reference);
  assert.equal(body.refund.providerRefundId, "mock_safe_refund_reference");
  assert.equal(body.refund.requests.length, 1);
  assert.equal(body.refund.requests[0].state, "pending");

  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /idempotencyKey|attemptCount|providerStatus|lastReconciledAt|rawLastEvent|checkoutUrl/i);
  assert.doesNotMatch(serialized, /refund:rf_44444444444444444444444444444444/);

  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/admin/payments/${payment._id}/refund`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` }
  })).status, 404, "Task 2 adds no admin refund mutation endpoint");
});
