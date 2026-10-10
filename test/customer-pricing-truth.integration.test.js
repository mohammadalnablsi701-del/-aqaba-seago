import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";

import { calculateTieredPricing } from "../src/services/pricing.js";
import { reserveCheckout } from "../src/services/checkout.js";
import { createCheckoutForHold, processPaymentWebhook } from "../src/services/payments.js";
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

function pricing(adultPrice, childPrice) {
  return {
    currency: "JOD",
    pricePerPerson: adultPrice,
    adultPrice,
    childPrice,
    buffetEnabled: true,
    buffetAdultPrice: adultPrice + 5,
    buffetChildPrice: childPrice + 3,
    commissionType: "fixed_per_person",
    commissionValue: 4,
    adultCommission: 4,
    childCommission: 2,
    buffetAdultCommission: 5,
    buffetChildCommission: 3
  };
}

test("L/M/N: checkout re-prices current server truth and confirmed booking keeps that snapshot", { skip: !uri }, async t => {
  assert.match(uri, /^mongodb:\/\/(127\.0\.0\.1|localhost):/, "Only a local disposable replica set is allowed");
  const saved = {
    secret: process.env.MOCK_PAYMENT_WEBHOOK_SECRET,
    paymentProvider: process.env.PAYMENT_PROVIDER,
    email: process.env.RESEND_API_KEY,
    push: process.env.VAPID_PUBLIC_KEY
  };
  process.env.MOCK_PAYMENT_WEBHOOK_SECRET = "customer-pricing-truth-test-key";
  process.env.PAYMENT_PROVIDER = "mock";
  delete process.env.RESEND_API_KEY;
  delete process.env.VAPID_PUBLIC_KEY;

  await mongoose.connect(uri, { dbName: `seago_pricing_truth_${crypto.randomUUID().replaceAll("-", "")}` });
  t.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    for (const [key, value] of [
      ["MOCK_PAYMENT_WEBHOOK_SECRET", saved.secret], ["PAYMENT_PROVIDER", saved.paymentProvider],
      ["RESEND_API_KEY", saved.email], ["VAPID_PUBLIC_KEY", saved.push]
    ]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  await Promise.all([Payment, PaymentEvent, Booking, CheckoutHold, Departure, Trip, Provider, User, InAppNotification].map(model => model.init()));

  const customer = await User.create({
    name: "Pricing Truth Customer", email: `${crypto.randomUUID()}@example.test`,
    phone: "+962790000000", role: "customer"
  });
  const owner = await User.create({ name: "Pricing Provider", email: `${crypto.randomUUID()}@example.test`, role: "provider" });
  const provider = await Provider.create({ ownerUserId: owner._id, businessName: "Disposable Pricing Operator", status: "approved" });
  const initialPricing = pricing(15, 10);
  const trip = await Trip.create({
    providerId: provider._id, titleEn: "Pricing truth test", titleAr: "اختبار السعر",
    category: "yacht", durationMinutes: 60, active: true, platformStatus: "allowed", pricing: initialPricing
  });
  const departure = await Departure.create({
    tripId: trip._id, startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    capacity: 10, reservedSeats: 0, status: "scheduled"
  });

  // T1: the customer has an older quote from the server.
  const oldQuote = calculateTieredPricing({ pricing: initialPricing, adults: 1, children: 1, mealPlan: "without_buffet" });
  assert.equal(oldQuote.grossAmount, 25);

  // T2: authoritative Trip pricing changes before checkout. No client total is sent.
  await Trip.updateOne({ _id: trip._id }, { $set: { pricing: pricing(20, 12) } });

  // T3: checkout reloads Trip and calculates the new server truth.
  const hold = await reserveCheckout({
    customerId: customer._id, key: crypto.randomUUID(), departureId: departure._id,
    adults: 1, children: 1, mealPlan: "without_buffet"
  });
  assert.equal(hold.pricing.adultUnitPrice, 20);
  assert.equal(hold.pricing.childUnitPrice, 12);
  assert.equal(hold.pricing.grossAmount, 32);
  assert.notEqual(hold.pricing.grossAmount, oldQuote.grossAmount);

  const payment = await createCheckoutForHold({ hold, customerId: customer._id, baseUrl: "https://example.test" });
  assert.equal(payment.amount, 32);
  assert.equal(payment.currency, "JOD");

  const rawBody = Buffer.from(JSON.stringify({
    eventId: crypto.randomUUID(), externalPaymentId: payment.externalPaymentId,
    status: "paid", amount: payment.amount, currency: payment.currency
  }));
  const signature = crypto.createHmac("sha256", process.env.MOCK_PAYMENT_WEBHOOK_SECRET).update(rawBody).digest("hex");
  await processPaymentWebhook({ providerName: "mock", rawBody, signature });

  const booking = await Booking.findOne({ departureId: departure._id }).lean();
  assert.equal(booking.status, "confirmed");
  assert.equal(booking.pricing.adultUnitPrice, 20);
  assert.equal(booking.pricing.childUnitPrice, 12);
  assert.equal(booking.pricing.grossAmount, 32);

  // Later catalog changes must not rewrite the historical booking snapshot.
  await Trip.updateOne({ _id: trip._id }, { $set: { pricing: pricing(99, 77) } });
  const historical = await Booking.findById(booking._id).lean();
  assert.equal(historical.pricing.adultUnitPrice, 20);
  assert.equal(historical.pricing.childUnitPrice, 12);
  assert.equal(historical.pricing.grossAmount, 32);
});
