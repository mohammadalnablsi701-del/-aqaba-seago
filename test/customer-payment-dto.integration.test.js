import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

import { createApp } from "../src/app.js";
import User from "../src/models/User.js";
import Provider from "../src/models/Provider.js";
import Trip from "../src/models/Trip.js";
import Departure from "../src/models/Departure.js";
import CheckoutHold from "../src/models/CheckoutHold.js";
import Payment from "../src/models/Payment.js";
import PaymentEvent from "../src/models/PaymentEvent.js";
import Booking from "../src/models/Booking.js";
import InAppNotification from "../src/models/InAppNotification.js";

const uri = process.env.SEAGO_TEST_MONGODB_URI;
const ALLOWED_STATUS_KEYS = ["bookingId", "status"];
const FORBIDDEN_STATUS_KEYS = [
  "_id",
  "id",
  "__v",
  "holdId",
  "customerId",
  "provider",
  "externalPaymentId",
  "settlementRevision",
  "amount",
  "currency",
  "checkoutUrl",
  "paidAt",
  "failedAt",
  "refundedAmount",
  "refundedAt",
  "refundReference",
  "lastEventId",
  "rawLastEvent",
  "createdAt",
  "updatedAt",
  "commissionAmount",
  "providerNetAmount",
  "pricing",
  "metadata"
];

function assertCustomerStatusDto(body, { status, bookingId = null }) {
  assert.deepEqual(Object.keys(body).sort(), ALLOWED_STATUS_KEYS);
  assert.equal(body.status, status);
  assert.equal(body.bookingId, bookingId === null ? null : String(bookingId));
  for (const key of FORBIDDEN_STATUS_KEYS) assert.equal(Object.hasOwn(body, key), false, `${key} must not be customer-visible`);
}

test("customer payment API exposes only the minimal status DTO and preserves checkout/return flow", { skip: !uri }, async t => {
  assert.match(uri, /^mongodb:\/\/(127\.0\.0\.1|localhost):/, "Only a local disposable replica set is allowed");

  const saved = {
    jwt: process.env.JWT_SECRET,
    provider: process.env.PAYMENT_PROVIDER,
    mockEnabled: process.env.ENABLE_MOCK_CHECKOUT,
    webhookSecret: process.env.MOCK_PAYMENT_WEBHOOK_SECRET,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    email: process.env.RESEND_API_KEY,
    push: process.env.VAPID_PUBLIC_KEY
  };
  process.env.JWT_SECRET = "customer-payment-dto-test-secret-at-least-32-characters";
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.ENABLE_MOCK_CHECKOUT = "true";
  process.env.MOCK_PAYMENT_WEBHOOK_SECRET = "customer-payment-dto-webhook-secret";
  delete process.env.RESEND_API_KEY;
  delete process.env.VAPID_PUBLIC_KEY;

  await mongoose.connect(uri, { dbName: `seago_customer_payment_dto_${crypto.randomUUID().replaceAll("-", "")}` });
  t.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    for (const [key, value] of [
      ["JWT_SECRET", saved.jwt],
      ["PAYMENT_PROVIDER", saved.provider],
      ["ENABLE_MOCK_CHECKOUT", saved.mockEnabled],
      ["MOCK_PAYMENT_WEBHOOK_SECRET", saved.webhookSecret],
      ["PUBLIC_BASE_URL", saved.publicBaseUrl],
      ["RESEND_API_KEY", saved.email],
      ["VAPID_PUBLIC_KEY", saved.push]
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  await Promise.all([
    User,
    Provider,
    Trip,
    Departure,
    CheckoutHold,
    Payment,
    PaymentEvent,
    Booking,
    InAppNotification
  ].map(model => model.init()));

  const customerA = await User.create({
    name: "DTO Customer A",
    email: `${crypto.randomUUID()}@example.test`,
    phone: "+962790000001",
    role: "customer"
  });
  const customerB = await User.create({
    name: "DTO Customer B",
    email: `${crypto.randomUUID()}@example.test`,
    phone: "+962790000002",
    role: "customer"
  });
  const providerOwner = await User.create({
    name: "DTO Provider",
    email: `${crypto.randomUUID()}@example.test`,
    role: "provider"
  });
  const provider = await Provider.create({
    ownerUserId: providerOwner._id,
    businessName: "Disposable DTO Marine",
    status: "approved"
  });
  const pricing = {
    currency: "JOD",
    pricePerPerson: 20,
    adultPrice: 20,
    childPrice: 10,
    commissionType: "fixed_per_person",
    commissionValue: 4,
    grossAmount: 20,
    commissionAmount: 4,
    providerNetAmount: 16
  };
  const trip = await Trip.create({
    providerId: provider._id,
    titleEn: "Disposable DTO Trip",
    titleAr: "رحلة DTO تجريبية",
    category: "yacht",
    durationMinutes: 60,
    active: true,
    platformStatus: "allowed",
    pricing
  });
  const departure = await Departure.create({
    tripId: trip._id,
    startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    capacity: 5,
    reservedSeats: 0,
    status: "scheduled"
  });

  const tokenFor = user => jwt.sign(
    { sub: String(user._id), ver: user.authVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
  const headersA = { authorization: `Bearer ${tokenFor(customerA)}` };
  const headersB = { authorization: `Bearer ${tokenFor(customerB)}` };

  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.PUBLIC_BASE_URL = base;

  // R) Checkout creation remains a distinct response with the redirect data the browser actually needs.
  const checkoutResponse = await fetch(`${base}/api/payments/checkout`, {
    method: "POST",
    headers: {
      ...headersA,
      "content-type": "application/json",
      "idempotency-key": `dto-checkout-${crypto.randomUUID()}`
    },
    body: JSON.stringify({
      departureId: String(departure._id),
      adults: 1,
      children: 0,
      mealPlan: "without_buffet"
    })
  });
  assert.equal(checkoutResponse.status, 201);
  const checkout = await checkoutResponse.json();
  for (const key of ["paymentId", "provider", "status", "amount", "currency", "checkoutUrl", "expiresAt"]) {
    assert.ok(Object.hasOwn(checkout, key), `checkout response must retain ${key}`);
  }
  assert.equal(checkout.provider, "mock");
  assert.equal(checkout.status, "pending");
  assert.equal(checkout.currency, "JOD");
  assert.match(checkout.checkoutUrl, new RegExp(`/api/mock-payments/${checkout.paymentId}$`));
  for (const key of ["holdId", "externalPaymentId", "rawLastEvent", "lastEventId", "settlementRevision", "refundReference"]) {
    assert.equal(Object.hasOwn(checkout, key), false, `${key} must not leak from checkout creation`);
  }

  const statusUrl = `${base}/api/payments/${checkout.paymentId}`;

  // A/D/E/F/G/H/I/J/K/L/N) owner sees an exact allowlist while current persistence/gateway fields stay private.
  const pendingResponse = await fetch(statusUrl, { headers: headersA });
  assert.equal(pendingResponse.status, 200);
  assertCustomerStatusDto(await pendingResponse.json(), { status: "pending" });

  await Payment.updateOne(
    { _id: checkout.paymentId },
    {
      $set: {
        settlementRevision: 11,
        refundReference: "refund_private_reference",
        lastEventId: "evt_private_customer_status",
        rawLastEvent: {
          gatewayTransactionId: "gateway_private_tx",
          signature: "private_signature",
          riskScore: 91,
          authorization: "private_authorization"
        }
      }
    }
  );
  const hardenedResponse = await fetch(statusUrl, { headers: headersA });
  assert.equal(hardenedResponse.status, 200);
  const hardened = await hardenedResponse.json();
  assertCustomerStatusDto(hardened, { status: "pending" });
  assert.doesNotMatch(JSON.stringify(hardened), /private_|gatewayTransactionId|riskScore|authorization|signature/i);

  // B/C/Q) auth/ownership and enumeration behavior remain fail-closed.
  const unauthenticated = await fetch(statusUrl);
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(Object.keys(await unauthenticated.json()), ["error"]);

  const otherCustomer = await fetch(statusUrl, { headers: headersB });
  assert.equal(otherCustomer.status, 404);
  const otherCustomerBody = await otherCustomer.json();
  assert.deepEqual(otherCustomerBody, { error: "Payment not found" });

  const missingId = new mongoose.Types.ObjectId();
  const missing = await fetch(`${base}/api/payments/${missingId}`, { headers: headersA });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), otherCustomerBody);

  const malformed = await fetch(`${base}/api/payments/not-a-payment-id`, { headers: headersA });
  assert.equal(malformed.status, 400);
  const malformedBody = await malformed.json();
  assert.deepEqual(Object.keys(malformedBody), ["error"]);
  assert.equal(malformedBody.error, "Invalid paymentId");

  // M) Mock checkout -> paid -> bookingId remains the server-truth confirmation path.
  const complete = await fetch(`${base}/api/mock-payments/${checkout.paymentId}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "paid" })
  });
  assert.equal(complete.status, 200);
  const completeBody = await complete.json();
  assert.equal(completeBody.paymentStatus, "paid");
  assert.ok(completeBody.bookingId);
  const booking = await Booking.findOne({ _id: completeBody.bookingId, customerId: customerA._id }).lean();
  assert.ok(booking);
  assert.equal(booking.status, "confirmed");

  const paidResponse = await fetch(statusUrl, { headers: headersA });
  assert.equal(paidResponse.status, 200);
  assertCustomerStatusDto(await paidResponse.json(), { status: "paid", bookingId: completeBody.bookingId });

  // O/P plus remaining schema statuses: each customer-visible state is represented without diagnostics.
  const statuses = [
    "created",
    "pending",
    "needs_review",
    "failed",
    "cancelled",
    "expired",
    "partially_refunded",
    "refunded"
  ];
  for (const status of statuses) {
    const payment = await Payment.create({
      holdId: new mongoose.Types.ObjectId(),
      customerId: customerA._id,
      provider: "mock",
      externalPaymentId: `dto_${status}_${crypto.randomUUID()}`,
      status,
      settlementRevision: 7,
      amount: 42,
      currency: "JOD",
      checkoutUrl: "https://gateway.example.test/checkout?token=private",
      refundedAmount: status === "partially_refunded" ? 10 : status === "refunded" ? 42 : 0,
      refundReference: "gateway_refund_private",
      lastEventId: "evt_private",
      rawLastEvent: { processor: "private", webhook: { signature: "private" } }
    });
    const response = await fetch(`${base}/api/payments/${payment._id}`, { headers: headersA });
    assert.equal(response.status, 200, `status ${status} must remain readable by its owner`);
    assertCustomerStatusDto(await response.json(), { status });
  }
});
