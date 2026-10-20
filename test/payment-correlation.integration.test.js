import { cleanupFixtures, requireFixture, connectFixture } from "../scripts/test-safety/fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";

import { reserveCheckout } from "../src/services/checkout.js";
import {
  createCheckoutForHold,
  createOrRecoverProviderCheckout,
  paymentReferenceFor,
  providerCheckoutIdempotencyKeyFor,
  processPaymentWebhook
} from "../src/services/payments.js";
import { createMockProvider } from "../src/payments/providers/mock.js";
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

requireFixture();
test.after(cleanupFixtures);

test("payment provider correlation and orphan checkout recovery", {}, async t => {

  const saved = {
    secret: process.env.MOCK_PAYMENT_WEBHOOK_SECRET,
    paymentProvider: process.env.PAYMENT_PROVIDER,
    email: process.env.RESEND_API_KEY,
    push: process.env.VAPID_PUBLIC_KEY
  };
  process.env.MOCK_PAYMENT_WEBHOOK_SECRET = "payment-correlation-test-key";
  process.env.PAYMENT_PROVIDER = "mock";
  delete process.env.RESEND_API_KEY;
  delete process.env.VAPID_PUBLIC_KEY;

  await connectFixture();
  t.after(async () => {
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
    commissionValue: 4
  };

  function unboundExternalId(payment) {
    return `pending_${payment._id}`;
  }

  async function fixture() {
    const customer = await User.create({
      name: "Correlation Customer",
      email: `${crypto.randomUUID()}@example.test`,
      phone: "+962790000000",
      role: "customer"
    });
    const owner = await User.create({
      name: "Correlation Provider Owner",
      email: `${crypto.randomUUID()}@example.test`,
      role: "provider"
    });
    const provider = await Provider.create({
      ownerUserId: owner._id,
      businessName: "Disposable Correlation Operator",
      status: "approved"
    });
    const trip = await Trip.create({
      providerId: provider._id,
      titleEn: "Correlation test trip",
      titleAr: "رحلة اختبار الربط",
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
    const request = {
      customerId: customer._id,
      key: crypto.randomUUID(),
      departureId: departure._id,
      adults: 1,
      children: 0,
      mealPlan: "without_buffet",
      partyType: "family",
      partyPolicyConfirmed: true
    };
    const hold = await reserveCheckout(request);
    const payment = await Payment.findOne({ holdId: hold._id });
    assert.ok(payment, "reserveCheckout must durably create Payment before provider call");
    return { customer, owner, provider, trip, departure, request, hold, payment };
  }

  async function signedWebhook({
    payment,
    eventId = crypto.randomUUID(),
    paymentReference = String(payment._id),
    externalPaymentId = `mock_${payment._id}`,
    status = "paid",
    amount = payment.amount,
    currency = payment.currency,
    includeReference = true
  }) {
    const body = {
      eventId,
      externalPaymentId,
      status,
      amount,
      currency
    };
    if (includeReference) body.paymentReference = paymentReference;
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = crypto
      .createHmac("sha256", process.env.MOCK_PAYMENT_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");
    return processPaymentWebhook({ providerName: "mock", rawBody, signature });
  }

  async function createExternalCheckoutOnly(payment) {
    const provider = createMockProvider();
    return provider.createCheckout({
      paymentReference: paymentReferenceFor(payment),
      providerIdempotencyKey: providerCheckoutIdempotencyKeyFor(payment),
      amount: payment.amount,
      currency: payment.currency,
      baseUrl: "https://example.test"
    });
  }

  await t.test("A: durable SeaGo reference exists before provider create and normal mapping persists", async () => {
    const f = await fixture();
    assert.equal(f.payment.externalPaymentId, unboundExternalId(f.payment));
    const reference = paymentReferenceFor(f.payment);
    assert.equal(reference, String(f.payment._id));

    const payment = await createCheckoutForHold({ hold: f.hold, customerId: f.customer._id, baseUrl: "https://example.test" });
    assert.equal(payment.externalPaymentId, `mock_${reference}`);
    assert.equal(payment.status, "pending");
    assert.match(payment.checkoutUrl, new RegExp(`/api/mock-payments/${reference}$`));
  });

  await t.test("B/C/D/E crash window: external create succeeds, DB mapping is absent, webhook recovers original Payment and creates one Booking", async () => {
    const f = await fixture();
    const checkout = await createExternalCheckoutOnly(f.payment);
    const before = await Payment.findById(f.payment._id).lean();
    assert.equal(before.externalPaymentId, unboundExternalId(f.payment), "simulate crash before external ID persistence");
    assert.equal(await Payment.countDocuments({ holdId: f.hold._id }), 1);

    await signedWebhook({ payment: f.payment, externalPaymentId: checkout.externalPaymentId });
    await signedWebhook({ payment: f.payment, externalPaymentId: checkout.externalPaymentId });

    const [payment, hold, bookings] = await Promise.all([
      Payment.findById(f.payment._id).lean(),
      CheckoutHold.findById(f.hold._id).lean(),
      Booking.find({ departureId: f.departure._id }).lean()
    ]);
    assert.equal(payment.externalPaymentId, checkout.externalPaymentId);
    assert.equal(payment.status, "paid");
    assert.equal(hold.status, "paid");
    assert.equal(bookings.length, 1);
    assert.equal(String(payment.bookingId), String(bookings[0]._id));
    assert.equal(await Payment.countDocuments({ holdId: f.hold._id }), 1);
  });

  await t.test("F: retry after an uncertain external result reuses the provider checkout", async () => {
    const f = await fixture();
    const external = await createExternalCheckoutOnly(f.payment);
    const recovered = await createCheckoutForHold({ hold: f.hold, customerId: f.customer._id, baseUrl: "https://different-host.test" });
    const retried = await createCheckoutForHold({ hold: f.hold, customerId: f.customer._id, baseUrl: "https://another-host.test" });
    assert.equal(recovered.externalPaymentId, external.externalPaymentId);
    assert.equal(retried.externalPaymentId, external.externalPaymentId);
    assert.equal(retried.checkoutUrl, external.checkoutUrl);
  });

  await t.test("G: timeout after provider side effect is reconciled by SeaGo reference without a second create", async () => {
    const payment = { _id: new mongoose.Types.ObjectId(), amount: 20, currency: "JOD" };
    let remoteCheckout = null;
    let createCalls = 0;
    const provider = {
      async findCheckoutByReference() { return remoteCheckout; },
      async createCheckout(request) {
        createCalls += 1;
        remoteCheckout = {
          paymentReference: request.paymentReference,
          externalPaymentId: `remote_${request.paymentReference}`,
          checkoutUrl: `https://gateway.test/${request.paymentReference}`,
          amount: request.amount,
          currency: request.currency
        };
        throw new Error("simulated timeout after external create");
      }
    };

    const first = await createOrRecoverProviderCheckout({ provider, payment, baseUrl: "https://example.test" });
    const second = await createOrRecoverProviderCheckout({ provider, payment, baseUrl: "https://example.test" });
    assert.equal(first.externalPaymentId, remoteCheckout.externalPaymentId);
    assert.equal(second.externalPaymentId, remoteCheckout.externalPaymentId);
    assert.equal(createCalls, 1);
  });

  await t.test("B persistence failure + retry: provider checkout remains recoverable and no new Payment is created", async sub => {
    const f = await fixture();
    const original = Payment.findOneAndUpdate;
    let injected = false;
    const stub = sub.mock.method(Payment, "findOneAndUpdate", function(...args) {
      if (!injected) {
        injected = true;
        throw new Error("Injected mapping write failure");
      }
      return original.apply(this, args);
    });
    await assert.rejects(
      createCheckoutForHold({ hold: f.hold, customerId: f.customer._id, baseUrl: "https://example.test" }),
      /Injected mapping write failure/
    );
    stub.mock.restore();

    const afterFailure = await Payment.findById(f.payment._id).lean();
    assert.equal(afterFailure.externalPaymentId, unboundExternalId(f.payment));
    const recovered = await createCheckoutForHold({ hold: f.hold, customerId: f.customer._id, baseUrl: "https://example.test" });
    assert.equal(recovered.externalPaymentId, `mock_${f.payment._id}`);
    assert.equal(await Payment.countDocuments({ holdId: f.hold._id }), 1);
  });

  await t.test("H: correct reference with conflicting external ID fails closed without overwrite or Booking", async () => {
    const f = await fixture();
    const mapped = await createCheckoutForHold({ hold: f.hold, customerId: f.customer._id, baseUrl: "https://example.test" });
    const originalExternalId = mapped.externalPaymentId;
    await signedWebhook({ payment: mapped, externalPaymentId: `conflict_${crypto.randomUUID()}` });
    const payment = await Payment.findById(mapped._id).lean();
    assert.equal(payment.status, "needs_review");
    assert.equal(payment.externalPaymentId, originalExternalId);
    assert.equal(await Booking.countDocuments({ departureId: f.departure._id }), 0);
  });

  await t.test("I: external ID known for another Payment plus wrong merchant reference fails closed", async () => {
    const a = await fixture();
    const b = await fixture();
    const paymentA = await createCheckoutForHold({ hold: a.hold, customerId: a.customer._id, baseUrl: "https://example.test" });
    const paymentB = await createCheckoutForHold({ hold: b.hold, customerId: b.customer._id, baseUrl: "https://example.test" });

    await signedWebhook({
      payment: paymentA,
      paymentReference: String(paymentA._id),
      externalPaymentId: paymentB.externalPaymentId
    });
    assert.equal((await Payment.findById(paymentA._id).lean()).status, "needs_review");
    assert.equal((await Payment.findById(paymentB._id).lean()).status, "pending");
    assert.equal(await Booking.countDocuments({ departureId: { $in: [a.departure._id, b.departure._id] } }), 0);
  });

  await t.test("J: correct reference with wrong amount becomes needs_review and does not bind external identity", async () => {
    const f = await fixture();
    await signedWebhook({ payment: f.payment, amount: Number(f.payment.amount) + 1 });
    const payment = await Payment.findById(f.payment._id).lean();
    assert.equal(payment.status, "needs_review");
    assert.equal(payment.externalPaymentId, unboundExternalId(f.payment));
    assert.equal(await Booking.countDocuments({ departureId: f.departure._id }), 0);
  });

  await t.test("K: correct reference with wrong currency becomes needs_review and does not bind external identity", async () => {
    const f = await fixture();
    await signedWebhook({ payment: f.payment, currency: "USD" });
    const payment = await Payment.findById(f.payment._id).lean();
    assert.equal(payment.status, "needs_review");
    assert.equal(payment.externalPaymentId, unboundExternalId(f.payment));
    assert.equal(await Booking.countDocuments({ departureId: f.departure._id }), 0);
  });

  await t.test("L: duplicate webhook is idempotent", async () => {
    const f = await fixture();
    const payment = await createCheckoutForHold({ hold: f.hold, customerId: f.customer._id, baseUrl: "https://example.test" });
    const eventId = crypto.randomUUID();
    const first = await signedWebhook({ payment, eventId, externalPaymentId: payment.externalPaymentId });
    const second = await signedWebhook({ payment, eventId, externalPaymentId: payment.externalPaymentId });
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(await Booking.countDocuments({ departureId: f.departure._id }), 1);
    assert.equal(await PaymentEvent.countDocuments({ provider: "mock", eventId }), 1);
  });

  await t.test("M: concurrent duplicate webhook performs one financial transition", async () => {
    const f = await fixture();
    const payment = await createCheckoutForHold({ hold: f.hold, customerId: f.customer._id, baseUrl: "https://example.test" });
    const eventId = crypto.randomUUID();
    await Promise.all([
      signedWebhook({ payment, eventId, externalPaymentId: payment.externalPaymentId }),
      signedWebhook({ payment, eventId, externalPaymentId: payment.externalPaymentId })
    ]);
    assert.equal((await Payment.findById(payment._id).lean()).status, "paid");
    assert.equal(await Booking.countDocuments({ departureId: f.departure._id }), 1);
    assert.equal(await PaymentEvent.countDocuments({ provider: "mock", eventId }), 1);
  });

  await t.test("N: expired Hold plus correctly correlated paid event never creates Booking", async () => {
    const f = await fixture();
    await CheckoutHold.updateOne({ _id: f.hold._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await signedWebhook({ payment: f.payment });
    assert.equal((await Payment.findById(f.payment._id).lean()).status, "needs_review");
    assert.equal(await Booking.countDocuments({ departureId: f.departure._id }), 0);
  });

  await t.test("O: platform paused after Hold blocks Booking and releases inventory", async () => {
    const f = await fixture();
    await Trip.updateOne({ _id: f.trip._id }, { $set: { platformStatus: "paused" } });
    await signedWebhook({ payment: f.payment });
    const [payment, hold, departure] = await Promise.all([
      Payment.findById(f.payment._id).lean(),
      CheckoutHold.findById(f.hold._id).lean(),
      Departure.findById(f.departure._id).lean()
    ]);
    assert.equal(payment.status, "needs_review");
    assert.equal(hold.status, "released");
    assert.equal(departure.reservedSeats, 0);
    assert.equal(await Booking.countDocuments({ departureId: f.departure._id }), 0);
  });

  await t.test("P: provider suspended after Hold blocks Booking and releases inventory", async () => {
    const f = await fixture();
    await Provider.updateOne({ _id: f.provider._id }, { $set: { status: "suspended" } });
    await signedWebhook({ payment: f.payment });
    const [payment, hold] = await Promise.all([
      Payment.findById(f.payment._id).lean(),
      CheckoutHold.findById(f.hold._id).lean()
    ]);
    assert.equal(payment.status, "needs_review");
    assert.equal(hold.status, "released");
    assert.equal(await Booking.countDocuments({ departureId: f.departure._id }), 0);
  });

  await t.test("Q: customer Payment DTO remains status + bookingId only", async () => {
    const dto = toCustomerPaymentDto({
      status: "pending",
      bookingId: null,
      paymentReference: "must-not-leak",
      externalPaymentId: "must-not-leak",
      checkoutUrl: "must-not-leak"
    });
    assert.deepEqual(Object.keys(dto).sort(), ["bookingId", "status"]);
    assert.deepEqual(dto, { status: "pending", bookingId: null });
  });

  await t.test("legacy webhook without paymentReference still correlates an already-bound legacy Payment", async () => {
    const f = await fixture();
    await Payment.updateOne({ _id: f.payment._id }, { $set: { externalPaymentId: `legacy_${f.payment._id}`, status: "pending" } });
    const payment = await Payment.findById(f.payment._id);
    await signedWebhook({ payment, includeReference: false, externalPaymentId: payment.externalPaymentId });
    assert.equal((await Payment.findById(payment._id).lean()).status, "paid");
    assert.equal(await Booking.countDocuments({ departureId: f.departure._id }), 1);
  });
});