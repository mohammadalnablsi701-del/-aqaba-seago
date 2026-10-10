import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";

import { reserveCheckout } from "../src/services/checkout.js";
import { createCheckoutForHold, processPaymentWebhook } from "../src/services/payments.js";
import { releaseCheckoutHold } from "../src/services/inventory.js";
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

test("customer final payment confirmation re-checks current sales authority", { skip: !uri }, async t => {
  assert.match(uri, /^mongodb:\/\/(127\.0\.0\.1|localhost):/, "Only a local disposable replica set is allowed");

  const saved = {
    secret: process.env.MOCK_PAYMENT_WEBHOOK_SECRET,
    paymentProvider: process.env.PAYMENT_PROVIDER,
    email: process.env.RESEND_API_KEY,
    push: process.env.VAPID_PUBLIC_KEY
  };
  process.env.MOCK_PAYMENT_WEBHOOK_SECRET = "customer-phase1-platform-pause-test-key";
  process.env.PAYMENT_PROVIDER = "mock";
  delete process.env.RESEND_API_KEY;
  delete process.env.VAPID_PUBLIC_KEY;

  await mongoose.connect(uri, { dbName: `seago_customer_pause_${crypto.randomUUID().replaceAll("-", "")}` });
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

  async function fixture() {
    const customer = await User.create({
      name: "Customer Phase 1",
      email: `${crypto.randomUUID()}@example.test`,
      phone: "+962790000000",
      role: "customer"
    });
    const owner = await User.create({
      name: "Provider Owner",
      email: `${crypto.randomUUID()}@example.test`,
      role: "provider"
    });
    const provider = await Provider.create({
      ownerUserId: owner._id,
      businessName: "Disposable Marine Operator",
      status: "approved"
    });
    const trip = await Trip.create({
      providerId: provider._id,
      titleEn: "Disposable payment trip",
      titleAr: "رحلة دفع تجريبية",
      category: "yacht",
      durationMinutes: 60,
      active: true,
      platformStatus: "allowed",
      pricing
    });
    const departure = await Departure.create({
      tripId: trip._id,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      capacity: 3,
      reservedSeats: 0,
      status: "scheduled"
    });
    const request = {
      customerId: customer._id,
      key: crypto.randomUUID(),
      departureId: departure._id,
      adults: 1,
      children: 0,
      mealPlan: "without_buffet"
    };
    const hold = await reserveCheckout(request);
    const payment = await createCheckoutForHold({ hold, customerId: customer._id, baseUrl: "https://example.test" });
    return { customer, owner, provider, trip, departure, request, hold, payment };
  }

  async function paidWebhook(f, eventId = crypto.randomUUID()) {
    const rawBody = Buffer.from(JSON.stringify({
      eventId,
      externalPaymentId: f.payment.externalPaymentId,
      status: "paid",
      amount: f.payment.amount,
      currency: f.payment.currency
    }));
    const signature = crypto
      .createHmac("sha256", process.env.MOCK_PAYMENT_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");
    return processPaymentWebhook({ providerName: "mock", rawBody, signature });
  }

  async function assertBlockedAndReleased(f) {
    const [payment, hold, departure, bookings] = await Promise.all([
      Payment.findById(f.payment._id).lean(),
      CheckoutHold.findById(f.hold._id).lean(),
      Departure.findById(f.departure._id).lean(),
      Booking.countDocuments({ departureId: f.departure._id })
    ]);
    assert.equal(payment.status, "needs_review");
    assert.equal(payment.bookingId ?? null, null);
    assert.equal(hold.status, "released");
    assert.equal(departure.reservedSeats, 0);
    assert.equal(bookings, 0);
  }

  await t.test("A: allowed trip hold paid creates one confirmed booking", async () => {
    const f = await fixture();
    await paidWebhook(f);
    const payment = await Payment.findById(f.payment._id).lean();
    const hold = await CheckoutHold.findById(f.hold._id).lean();
    const departure = await Departure.findById(f.departure._id).lean();
    const booking = await Booking.findOne({ departureId: f.departure._id }).lean();
    assert.equal(payment.status, "paid");
    assert.equal(hold.status, "paid");
    assert.equal(departure.reservedSeats, 1);
    assert.equal(booking.status, "confirmed");
    assert.equal(String(payment.bookingId), String(booking._id));
  });

  await t.test("B/C/D/E/F: platform pause before paid fails closed, stays reviewable and releases exactly once", async () => {
    const f = await fixture();
    await Trip.updateOne({ _id: f.trip._id }, { $set: { platformStatus: "paused" } });
    const eventId = crypto.randomUUID();
    const first = await paidWebhook(f, eventId);
    const second = await paidWebhook(f, eventId);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    await assertBlockedAndReleased(f);
    assert.equal(await PaymentEvent.countDocuments({ paymentId: f.payment._id, eventId }), 1);
    assert.equal(await releaseCheckoutHold(f.hold._id), false);
    assert.equal((await Departure.findById(f.departure._id).lean()).reservedSeats, 0);
    const trip = await Trip.findById(f.trip._id).lean();
    assert.equal(trip.active, true);
    assert.equal(trip.platformStatus, "paused");
  });

  await t.test("G: provider pause after hold blocks final booking and releases inventory", async () => {
    const f = await fixture();
    await Trip.updateOne({ _id: f.trip._id }, { $set: { active: false } });
    await paidWebhook(f);
    await assertBlockedAndReleased(f);
  });

  await t.test("H: provider suspension after hold blocks final booking and releases inventory", async () => {
    const f = await fixture();
    await Provider.updateOne({ _id: f.provider._id }, { $set: { status: "suspended" } });
    await paidWebhook(f);
    await assertBlockedAndReleased(f);
  });

  await t.test("I: legacy trip with missing platformStatus remains allowed when otherwise valid", async () => {
    const f = await fixture();
    await Trip.collection.updateOne({ _id: f.trip._id }, { $unset: { platformStatus: "" } });
    await paidWebhook(f);
    const payment = await Payment.findById(f.payment._id).lean();
    const hold = await CheckoutHold.findById(f.hold._id).lean();
    assert.equal(payment.status, "paid");
    assert.equal(hold.status, "paid");
    assert.equal(await Booking.countDocuments({ departureId: f.departure._id }), 1);
  });

  await t.test("J: pause then allow before payment permits a still-valid hold", async () => {
    const f = await fixture();
    await Trip.updateOne({ _id: f.trip._id }, { $set: { platformStatus: "paused" } });
    await Trip.updateOne({ _id: f.trip._id }, { $set: { platformStatus: "allowed" } });
    await paidWebhook(f);
    assert.equal((await Payment.findById(f.payment._id).lean()).status, "paid");
    assert.equal((await CheckoutHold.findById(f.hold._id).lean()).status, "paid");
    assert.equal((await Departure.findById(f.departure._id).lean()).reservedSeats, 1);
    assert.equal(await Booking.countDocuments({ departureId: f.departure._id }), 1);
  });

  await t.test("K/L: existing confirmed booking survives later platform pause and active stays true", async () => {
    const f = await fixture();
    await paidWebhook(f);
    const booking = await Booking.findOne({ departureId: f.departure._id }).lean();
    await Trip.updateOne({ _id: f.trip._id }, { $set: { platformStatus: "paused" } });
    const afterBooking = await Booking.findById(booking._id).lean();
    const trip = await Trip.findById(f.trip._id).lean();
    assert.equal(afterBooking.status, "confirmed");
    assert.equal(trip.active, true);
    assert.equal(trip.platformStatus, "paused");
    assert.equal((await Departure.findById(f.departure._id).lean()).reservedSeats, 1);
  });

  await t.test("M/N: paid-but-blocked remains an explicit payment record with no fabricated booking", async () => {
    const f = await fixture();
    await Trip.updateOne({ _id: f.trip._id }, { $set: { platformStatus: "paused" } });
    await paidWebhook(f);
    const payment = await Payment.findById(f.payment._id).lean();
    assert.equal(payment.status, "needs_review");
    assert.equal(payment.bookingId ?? null, null);
    assert.ok(payment.lastEventId);
    assert.equal(await PaymentEvent.countDocuments({ paymentId: f.payment._id }), 1);
    assert.equal(await Booking.countDocuments({ customerId: f.customer._id, tripId: f.trip._id }), 0);
  });
});
