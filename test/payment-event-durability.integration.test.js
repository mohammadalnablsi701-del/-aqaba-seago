import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";

import { processPaymentWebhook } from "../src/services/payments.js";
import { toCustomerPaymentDto } from "../src/services/customerPaymentDto.js";
import Payment from "../src/models/Payment.js";
import PaymentEvent from "../src/models/PaymentEvent.js";
import Booking from "../src/models/Booking.js";
import CheckoutHold from "../src/models/CheckoutHold.js";
import Departure from "../src/models/Departure.js";
import Trip from "../src/models/Trip.js";
import Provider from "../src/models/Provider.js";
import User from "../src/models/User.js";
import InAppNotification from "../src/models/InAppNotification.js";

const uri = process.env.SEAGO_TEST_MONGODB_URI;

test("payment event durability on isolated MongoDB replica set", { skip: !uri }, async t => {
  assert.match(uri, /^mongodb:\/\/(127\.0\.0\.1|localhost):/, "Only a local disposable replica set is allowed");

  const saved = {
    secret: process.env.MOCK_PAYMENT_WEBHOOK_SECRET,
    paymentProvider: process.env.PAYMENT_PROVIDER,
    email: process.env.RESEND_API_KEY,
    push: process.env.VAPID_PUBLIC_KEY
  };
  process.env.MOCK_PAYMENT_WEBHOOK_SECRET = "payment-event-durability-test-key";
  process.env.PAYMENT_PROVIDER = "mock";
  delete process.env.RESEND_API_KEY;
  delete process.env.VAPID_PUBLIC_KEY;

  await mongoose.connect(uri, { dbName: `seago_payment_event_durability_${crypto.randomUUID().replaceAll("-", "")}` });
  t.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    for (const [key, value] of [
      ["MOCK_PAYMENT_WEBHOOK_SECRET", saved.secret],
      ["PAYMENT_PROVIDER", saved.paymentProvider],
      ["RESEND_API_KEY", saved.email],
      ["VAPID_PUBLIC_KEY", saved.push]
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  await Promise.all([
    Payment,
    PaymentEvent,
    Booking,
    CheckoutHold,
    Departure,
    Trip,
    Provider,
    User,
    InAppNotification
  ].map(model => model.init()));

  async function fixture() {
    const customer = await User.create({
      name: "Durability Customer",
      email: `${crypto.randomUUID()}@example.test`,
      phone: "+962790000000",
      role: "customer"
    });
    const owner = await User.create({
      name: "Durability Provider",
      email: `${crypto.randomUUID()}@example.test`,
      role: "provider"
    });
    const provider = await Provider.create({
      ownerUserId: owner._id,
      businessName: "Disposable Durability Operator",
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
      titleEn: "Durability trip",
      titleAr: "رحلة اختبار المتانة",
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
      reservedSeats: 1,
      status: "scheduled"
    });
    const hold = await CheckoutHold.create({
      customerId: customer._id,
      providerId: provider._id,
      tripId: trip._id,
      departureId: departure._id,
      seats: 1,
      adults: 1,
      children: 0,
      mealPlan: "without_buffet",
      pricing,
      idempotencyKey: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    });
    const payment = await Payment.create({
      holdId: hold._id,
      customerId: customer._id,
      provider: "mock",
      externalPaymentId: `mock_${crypto.randomUUID()}`,
      amount: 20,
      currency: "JOD",
      status: "pending"
    });
    return { customer, owner, provider, trip, departure, hold, payment };
  }

  async function send(f, {
    eventId = crypto.randomUUID(),
    paymentReference = String(f.payment._id),
    externalPaymentId = f.payment.externalPaymentId,
    status = "paid",
    amount = f.payment.amount,
    currency = f.payment.currency
  } = {}) {
    const rawBody = Buffer.from(JSON.stringify({
      eventId,
      paymentReference,
      externalPaymentId,
      status,
      amount,
      currency
    }));
    const signature = crypto
      .createHmac("sha256", process.env.MOCK_PAYMENT_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");
    return processPaymentWebhook({ providerName: "mock", rawBody, signature });
  }

  async function state(f, eventId) {
    const [payment, hold, booking, event] = await Promise.all([
      Payment.findById(f.payment._id).lean(),
      CheckoutHold.findById(f.hold._id).lean(),
      Booking.findOne({ customerId: f.customer._id, idempotencyKey: `payment:${f.payment._id}` }).lean(),
      eventId ? PaymentEvent.findOne({ provider: "mock", eventId }).lean() : null
    ]);
    return { payment, hold, booking, event };
  }

  await t.test("A: paid event, PaymentEvent, Payment, Booking and Hold commit together", async () => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    const result = await send(f, { eventId });
    const s = await state(f, eventId);
    assert.equal(result.duplicate, false);
    assert.ok(s.event);
    assert.equal(String(s.event.paymentId), String(f.payment._id));
    assert.equal(s.payment.status, "paid");
    assert.equal(s.hold.status, "paid");
    assert.equal(s.booking.status, "confirmed");
    assert.equal(String(s.payment.bookingId), String(s.booking._id));
  });

  await t.test("B: PaymentEvent insert failure aborts all financial mutation and retry succeeds", async sub => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    const stub = sub.mock.method(PaymentEvent, "create", async () => { throw new Error("Injected PaymentEvent insert failure"); });
    await assert.rejects(send(f, { eventId }), /Injected PaymentEvent insert failure/);
    stub.mock.restore();
    let s = await state(f, eventId);
    assert.equal(s.event, null);
    assert.equal(s.payment.status, "pending");
    assert.equal(s.hold.status, "active");
    assert.equal(s.booking, null);
    await send(f, { eventId });
    s = await state(f, eventId);
    assert.ok(s.event);
    assert.equal(s.payment.status, "paid");
    assert.equal(s.hold.status, "paid");
    assert.ok(s.booking);
  });

  await t.test("C: Booking creation failure rolls PaymentEvent back", async sub => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    const stub = sub.mock.method(Booking, "findOneAndUpdate", async () => { throw new Error("Injected booking failure"); });
    await assert.rejects(send(f, { eventId }), /Injected booking failure/);
    stub.mock.restore();
    const s = await state(f, eventId);
    assert.equal(s.event, null);
    assert.equal(s.payment.status, "pending");
    assert.equal(s.hold.status, "active");
    assert.equal(s.booking, null);
  });

  await t.test("D: Payment update failure rolls PaymentEvent, Booking and Hold back", async sub => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    const original = Payment.prototype.save;
    const stub = sub.mock.method(Payment.prototype, "save", function(...args) {
      if (String(this._id) === String(f.payment._id) && this.status === "paid") {
        throw new Error("Injected payment update failure");
      }
      return original.apply(this, args);
    });
    await assert.rejects(send(f, { eventId }), /Injected payment update failure/);
    stub.mock.restore();
    const s = await state(f, eventId);
    assert.equal(s.event, null);
    assert.equal(s.payment.status, "pending");
    assert.equal(s.hold.status, "active");
    assert.equal(s.booking, null);
  });

  await t.test("E: error before transaction commit leaves nothing effective committed", async sub => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    const stub = sub.mock.method(CheckoutHold, "findOneAndUpdate", async () => { throw new Error("Injected pre-commit crash"); });
    await assert.rejects(send(f, { eventId }), /Injected pre-commit crash/);
    stub.mock.restore();
    const s = await state(f, eventId);
    assert.equal(s.event, null);
    assert.equal(s.payment.status, "pending");
    assert.equal(s.hold.status, "active");
    assert.equal(s.booking, null);
  });

  await t.test("F: simulated process crash immediately after commit cannot lose PaymentEvent evidence", async () => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    await assert.rejects((async () => {
      await send(f, { eventId });
      throw new Error("Simulated process crash after commit");
    })(), /Simulated process crash after commit/);
    const s = await state(f, eventId);
    assert.ok(s.event);
    assert.equal(s.payment.status, "paid");
    assert.equal(s.hold.status, "paid");
    assert.ok(s.booking);
  });

  await t.test("G: duplicate webhook safely acknowledges without duplicate event or effect", async () => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    const first = await send(f, { eventId });
    const second = await send(f, { eventId });
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(await PaymentEvent.countDocuments({ provider: "mock", eventId }), 1);
    assert.equal(await Booking.countDocuments({ customerId: f.customer._id, idempotencyKey: `payment:${f.payment._id}` }), 1);
  });

  await t.test("H: concurrent duplicate webhooks have one effective transition", async () => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    const results = await Promise.all([send(f, { eventId }), send(f, { eventId })]);
    assert.equal(results.filter(result => result.duplicate === false).length, 1);
    assert.equal(results.filter(result => result.duplicate === true).length, 1);
    assert.equal(await PaymentEvent.countDocuments({ provider: "mock", eventId }), 1);
    assert.equal(await Booking.countDocuments({ customerId: f.customer._id, idempotencyKey: `payment:${f.payment._id}` }), 1);
    assert.equal((await state(f, eventId)).payment.status, "paid");
  });

  await t.test("I: wrong amount commits needs_review with durable event and no Booking", async () => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    await send(f, { eventId, amount: 19 });
    const s = await state(f, eventId);
    assert.ok(s.event);
    assert.equal(s.payment.status, "needs_review");
    assert.equal(s.booking, null);
  });

  await t.test("J: wrong currency commits needs_review with durable event and no Booking", async () => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    await send(f, { eventId, currency: "USD" });
    const s = await state(f, eventId);
    assert.ok(s.event);
    assert.equal(s.payment.status, "needs_review");
    assert.equal(s.booking, null);
  });

  await t.test("K: conflicting external ID commits needs_review with durable event and no Booking", async () => {
    const f = await fixture();
    const eventId = crypto.randomUUID();
    await send(f, { eventId, externalPaymentId: `conflict_${crypto.randomUUID()}` });
    const s = await state(f, eventId);
    assert.ok(s.event);
    assert.equal(s.payment.status, "needs_review");
    assert.equal(s.payment.externalPaymentId, f.payment.externalPaymentId);
    assert.equal(s.booking, null);
  });

  await t.test("L: expired Hold plus paid event has durable evidence and no Booking", async () => {
    const f = await fixture();
    await CheckoutHold.updateOne({ _id: f.hold._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const eventId = crypto.randomUUID();
    await send(f, { eventId });
    const s = await state(f, eventId);
    assert.ok(s.event);
    assert.equal(s.payment.status, "needs_review");
    assert.equal(s.booking, null);
  });

  await t.test("M: platform pause plus paid event has durable evidence, no Booking and safe release", async () => {
    const f = await fixture();
    await Trip.updateOne({ _id: f.trip._id }, { $set: { platformStatus: "paused" } });
    const eventId = crypto.randomUUID();
    await send(f, { eventId });
    const s = await state(f, eventId);
    assert.ok(s.event);
    assert.equal(s.payment.status, "needs_review");
    assert.equal(s.hold.status, "released");
    assert.equal(s.booking, null);
  });

  await t.test("N: provider suspension plus paid event has durable evidence, no Booking and safe release", async () => {
    const f = await fixture();
    await Provider.updateOne({ _id: f.provider._id }, { $set: { status: "suspended" } });
    const eventId = crypto.randomUUID();
    await send(f, { eventId });
    const s = await state(f, eventId);
    assert.ok(s.event);
    assert.equal(s.payment.status, "needs_review");
    assert.equal(s.hold.status, "released");
    assert.equal(s.booking, null);
  });

  await t.test("O: late paid after failure remains review-only with durable evidence", async () => {
    const f = await fixture();
    const failedEventId = crypto.randomUUID();
    const paidEventId = crypto.randomUUID();
    await send(f, { eventId: failedEventId, status: "failed" });
    await send(f, { eventId: paidEventId, status: "paid" });
    const s = await state(f, paidEventId);
    assert.ok(await PaymentEvent.findOne({ provider: "mock", eventId: failedEventId }).lean());
    assert.ok(s.event);
    assert.equal(s.payment.status, "needs_review");
    assert.equal(s.booking, null);
  });

  await t.test("P: Task 1 orphan-correlation recovery still binds only the referenced Payment", async () => {
    const f = await fixture();
    const pendingExternalId = `pending_${f.payment._id}`;
    await Payment.updateOne({ _id: f.payment._id }, { $set: { externalPaymentId: pendingExternalId } });
    f.payment.externalPaymentId = pendingExternalId;
    const recoveredExternalId = `mock_${f.payment._id}`;
    const eventId = crypto.randomUUID();
    await send(f, { eventId, externalPaymentId: recoveredExternalId });
    const s = await state(f, eventId);
    assert.ok(s.event);
    assert.equal(s.payment.externalPaymentId, recoveredExternalId);
    assert.equal(s.payment.status, "paid");
    assert.ok(s.booking);
  });

  await t.test("S: Customer Payment DTO remains status + bookingId only", async () => {
    const dto = toCustomerPaymentDto({
      status: "paid",
      bookingId: new mongoose.Types.ObjectId(),
      lastEventId: "must-not-leak",
      rawLastEvent: { secret: "must-not-leak" },
      externalPaymentId: "must-not-leak"
    });
    assert.deepEqual(Object.keys(dto).sort(), ["bookingId", "status"]);
  });

  await t.test("eventId rejects non-string and oversized provider identifiers", async () => {
    const f = await fixture();
    for (const eventId of [{ injected: true }, "x".repeat(201)]) {
      const rawBody = Buffer.from(JSON.stringify({
        eventId,
        paymentReference: String(f.payment._id),
        externalPaymentId: f.payment.externalPaymentId,
        status: "paid",
        amount: f.payment.amount,
        currency: f.payment.currency
      }));
      const signature = crypto
        .createHmac("sha256", process.env.MOCK_PAYMENT_WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");
      await assert.rejects(
        processPaymentWebhook({ providerName: "mock", rawBody, signature }),
        { statusCode: 400 }
      );
    }
    assert.equal((await Payment.findById(f.payment._id).lean()).status, "pending");
  });
});
