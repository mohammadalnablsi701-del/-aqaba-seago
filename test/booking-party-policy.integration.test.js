import { cleanupFixtures, requireFixture, connectFixture } from "../scripts/test-safety/fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { reserveCheckout } from "../src/services/checkout.js";
import { processPaymentWebhook } from "../src/services/payments.js";
import User from "../src/models/User.js";
import Provider from "../src/models/Provider.js";
import Trip from "../src/models/Trip.js";
import Departure from "../src/models/Departure.js";
import CheckoutHold from "../src/models/CheckoutHold.js";
import Payment from "../src/models/Payment.js";
import PaymentEvent from "../src/models/PaymentEvent.js";
import Booking from "../src/models/Booking.js";
import InAppNotification from "../src/models/InAppNotification.js";

requireFixture();
test.after(cleanupFixtures);

test("family/couple policy is authoritative through checkout and payment confirmation", async t => {
  const settings = {
    JWT_SECRET: "booking-party-policy-test-secret-at-least-32-characters",
    TICKET_SIGNING_SECRET: "booking-party-policy-ticket-secret-at-least-32-characters",
    PAYMENT_PROVIDER: "mock",
    ENABLE_MOCK_CHECKOUT: "true",
    MOCK_PAYMENT_WEBHOOK_SECRET: "booking-party-policy-local-webhook-secret",
    RESEND_API_KEY: undefined,
    VAPID_PUBLIC_KEY: undefined
  };
  const saved = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  await connectFixture();
  await Promise.all([User, Provider, Trip, Departure, CheckoutHold, Payment, PaymentEvent, Booking, InAppNotification].map(model => model.init()));
  const customer = await User.create({ name: "Policy Customer", role: "customer", phone: "+962790000001" });
  const owner = await User.create({ name: "Policy Owner", role: "provider", phone: "+962790000002" });
  const admin = await User.create({ name: "Policy Admin", role: "admin", phone: "+962790000003" });
  const provider = await Provider.create({ ownerUserId: owner._id, businessName: "Disposable Policy Marine", status: "approved" });
  const trip = await Trip.create({
    providerId: provider._id, titleEn: "Policy Trip", titleAr: "رحلة تجريبية", category: "yacht", durationMinutes: 60, active: true,
    pricing: { currency: "JOD", pricePerPerson: 20, adultPrice: 20, childPrice: 10, commissionType: "fixed_per_person", commissionValue: 4 }
  });
  const departure = () => Departure.create({ tripId: trip._id, startsAt: new Date(Date.now() + 86400000), capacity: 8, reservedSeats: 0, status: "scheduled" });
  const tokenFor = user => jwt.sign({ sub: String(user._id), ver: user.authVersion || 0 }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const customerHeaders = { authorization: `Bearer ${tokenFor(customer)}`, "content-type": "application/json" };
  const providerHeaders = { authorization: `Bearer ${tokenFor(owner)}` };
  const adminHeaders = { authorization: `Bearer ${tokenFor(admin)}` };
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const checkout = async (dep, policy, key = crypto.randomUUID()) => {
    const response = await fetch(`${base}/api/payments/checkout`, {
      method: "POST", headers: { ...customerHeaders, "idempotency-key": key },
      body: JSON.stringify({ departureId: String(dep._id), adults: 2, children: 1, mealPlan: "without_buffet", ...policy })
    });
    return { status: response.status, body: await response.json() };
  };
  const counts = async () => ({ holds: await CheckoutHold.countDocuments(), payments: await Payment.countDocuments(), bookings: await Booking.countDocuments() });
  const visibility = async (bookingId, expected) => {
    const providerResponse = await fetch(`${base}/api/providers/me/bookings/${bookingId}`, { headers: providerHeaders });
    assert.equal(providerResponse.status, 200);
    assert.equal((await providerResponse.json()).partyType ?? null, expected);
    const adminResponse = await fetch(`${base}/api/admin/bookings/${bookingId}`, { headers: adminHeaders });
    assert.equal(adminResponse.status, 200);
    assert.equal((await adminResponse.json()).booking.partyType, expected);
  };

  await t.test("missing or invalid party types and non-literal confirmations reject without business writes", async () => {
    const dep = await departure();
    const before = await counts();
    const policies = [
      { partyPolicyConfirmed: true },
      ...[null, "", "Family", "family ", "friends", ["family"], { type: "family" }, 1].map(partyType => ({ partyType, partyPolicyConfirmed: true })),
      { partyType: "family" },
      ...[null, false, "true", 1, [], {}].map(partyPolicyConfirmed => ({ partyType: "family", partyPolicyConfirmed }))
    ];
    for (const policy of policies) {
      const result = await checkout(dep, policy);
      assert.equal(result.status, 400, JSON.stringify(policy));
      assert.equal(typeof result.body.error, "string");
    }
    assert.deepEqual(await counts(), before);
    assert.equal((await Departure.findById(dep._id)).reservedSeats, 0);
  });

  await t.test("the checkout service rejects policy bypasses before opening a transaction", async sub => {
    let sessions = 0;
    const stub = sub.mock.method(mongoose, "startSession", async () => { sessions += 1; throw new Error("Transaction must not start"); });
    try {
      for (const policy of [{}, { partyType: "friends", partyPolicyConfirmed: true }, { partyType: "family", partyPolicyConfirmed: "true" }]) {
        await assert.rejects(reserveCheckout({ customerId: customer._id, key: crypto.randomUUID(), adults: 2, children: 1, mealPlan: "without_buffet", ...policy }), error => error?.statusCode === 400);
      }
      assert.equal(sessions, 0);
    } finally { stub.mock.restore(); }
  });

  for (const partyType of ["family", "couple"]) {
    await t.test(`${partyType} persists with unchanged finances, seats and idempotent payment confirmation`, async () => {
      const dep = await departure();
      const key = crypto.randomUUID();
      const policy = { partyType, partyPolicyConfirmed: true };
      const first = await checkout(dep, policy, key);
      assert.equal(first.status, 201);
      assert.equal(first.body.amount, 50);
      assert.equal(first.body.currency, "JOD");
      const duplicate = await checkout(dep, policy, key);
      assert.equal(duplicate.status, 201);
      assert.equal(duplicate.body.paymentId, first.body.paymentId);
      const conflict = await checkout(dep, { ...policy, partyType: partyType === "family" ? "couple" : "family" }, key);
      assert.equal(conflict.status, 409);
      const payment = await Payment.findById(first.body.paymentId).lean();
      const hold = await CheckoutHold.findById(payment.holdId).lean();
      assert.equal(hold.partyType, partyType);
      assert.equal(hold.partyPolicyConfirmed, true);
      assert.equal(hold.seats, 3);
      assert.equal(hold.pricing.grossAmount, 50);
      assert.equal(hold.pricing.commissionAmount, 12);
      assert.equal(hold.pricing.providerNetAmount, 38);
      assert.equal(payment.amount, 50);
      assert.equal(await CheckoutHold.countDocuments({ departureId: dep._id }), 1);
      assert.equal(await Payment.countDocuments({ holdId: hold._id }), 1);
      assert.equal((await Departure.findById(dep._id)).reservedSeats, 3);
      const sendPaid = async eventId => {
        const rawBody = Buffer.from(JSON.stringify({ eventId, paymentReference: String(payment._id), externalPaymentId: payment.externalPaymentId, status: "paid", amount: payment.amount, currency: payment.currency }));
        return processPaymentWebhook({ providerName: "mock", rawBody, signature: crypto.createHmac("sha256", process.env.MOCK_PAYMENT_WEBHOOK_SECRET).update(rawBody).digest("hex") });
      };
      const eventId = crypto.randomUUID();
      await sendPaid(eventId);
      await sendPaid(eventId);
      await sendPaid(crypto.randomUUID());
      const paid = await Payment.findById(payment._id).lean();
      const booking = await Booking.findById(paid.bookingId).lean();
      assert.equal(paid.status, "paid");
      assert.equal(booking.status, "confirmed");
      assert.equal(booking.partyType, partyType);
      assert.equal(booking.seats, 3);
      assert.deepEqual(booking.pricing, hold.pricing);
      assert.equal(await Booking.countDocuments({ departureId: dep._id }), 1);
      assert.equal((await CheckoutHold.findById(hold._id)).status, "paid");
      const inventory = await Departure.findById(dep._id).lean();
      assert.equal(inventory.capacity, 8);
      assert.equal(inventory.reservedSeats, 3);
      assert.equal(paid.amount, 50);
      await visibility(booking._id, partyType);
    });
  }

  await t.test("historical bookings without a party type remain schema-valid and readable by provider and admin", async () => {
    const dep = await departure();
    const booking = await Booking.create({
      customerId: customer._id, providerId: provider._id, tripId: trip._id, departureId: dep._id,
      adults: 1, children: 0, seats: 1, status: "confirmed", holdExpiresAt: new Date(Date.now() + 300000),
      pricing: { currency: "JOD", unitPrice: 20, grossAmount: 20, commissionAmount: 4, providerNetAmount: 16 }, idempotencyKey: crypto.randomUUID()
    });
    assert.equal((await Booking.findById(booking._id).lean()).partyType, undefined);
    await visibility(booking._id, null);
  });
});
