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
import Booking from "../src/models/Booking.js";
import Payment from "../src/models/Payment.js";
import InAppNotification from "../src/models/InAppNotification.js";

const uri = process.env.SEAGO_TEST_MONGODB_URI;

function auth(userId, secret) {
  return jwt.sign({ sub: String(userId) }, secret, { expiresIn: "1h" });
}

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

test("customer cancellation is server-authoritative, idempotent and ownership-safe", { skip: !uri }, async t => {
  assert.match(uri, /^mongodb:\/\/(127\.0\.0\.1|localhost):/, "Only a local disposable replica set is allowed");
  const previousJwt = process.env.JWT_SECRET;
  const previousTicket = process.env.TICKET_SIGNING_SECRET;
  const secret = "customer-cancellation-test-secret-at-least-32-characters";
  process.env.JWT_SECRET = secret;
  process.env.TICKET_SIGNING_SECRET = secret;

  await mongoose.connect(uri, { dbName: "seago_customer_cancellation_" + crypto.randomUUID().replaceAll("-", "") });
  t.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (previousJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousJwt;
    if (previousTicket === undefined) delete process.env.TICKET_SIGNING_SECRET; else process.env.TICKET_SIGNING_SECRET = previousTicket;
  });
  await Promise.all([User, Provider, Trip, Departure, Booking, Payment, InAppNotification].map(model => model.init()));

  const providerOwner = await User.create({ name: "Cancellation Provider", phone: "+962790002001", role: "provider" });
  const customer = await User.create({ name: "Cancellation Customer", phone: "+962790002002", role: "customer" });
  const otherCustomer = await User.create({ name: "Other Customer", phone: "+962790002003", role: "customer" });
  const provider = await Provider.create({ ownerUserId: providerOwner._id, businessName: "Cancellation Boats", phone: "+96232000001", status: "approved" });
  const trip = await Trip.create({
    providerId: provider._id,
    titleAr: "رحلة اختبار الإلغاء",
    titleEn: "Cancellation test trip",
    category: "yacht",
    durationMinutes: 90,
    active: true,
    pricing: { currency: "JOD", pricePerPerson: 40, adultPrice: 40, commissionType: "fixed_per_person", commissionValue: 4 }
  });

  async function fixture({
    ownerId = customer._id,
    hours = 48,
    departureStatus = "scheduled",
    checkedInAt = null,
    grossAmount = 40,
    seats = 2,
    paymentProvider = "mock",
    withPayment = true,
    marker = crypto.randomUUID()
  } = {}) {
    const departure = await Departure.create({
      tripId: trip._id,
      startsAt: new Date(Date.now() + hours * 3600000),
      capacity: 20,
      reservedSeats: seats,
      status: departureStatus
    });
    const booking = await Booking.create({
      customerId: ownerId,
      customerSnapshot: { name: "Cancellation Customer", phone: "+962790002002" },
      providerId: provider._id,
      tripId: trip._id,
      departureId: departure._id,
      seats,
      adults: seats,
      children: 0,
      mealPlan: "without_buffet",
      status: "confirmed",
      holdExpiresAt: new Date(Date.now() + 300000),
      pricing: { currency: "JOD", grossAmount, unitPrice: grossAmount / seats, commissionAmount: 8, providerNetAmount: grossAmount - 8 },
      idempotencyKey: `cancel-${marker}`,
      checkedInAt,
      checkInCount: checkedInAt ? 1 : 0
    });
    let payment = null;
    if (withPayment) {
      payment = await Payment.create({
        bookingId: booking._id,
        holdId: new mongoose.Types.ObjectId(),
        customerId: ownerId,
        provider: paymentProvider,
        status: "paid",
        amount: grossAmount,
        currency: "JOD",
        paidAt: new Date()
      });
    }
    return { departure, booking, payment };
  }

  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const customerToken = auth(customer._id, secret);
  const otherToken = auth(otherCustomer._id, secret);

  async function call(path, { token = customerToken, method = "GET", body } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    return readJson(await fetch(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
  }

  await t.test("policy preview is owned, authenticated and sourced from the booking snapshot", async () => {
    const { booking } = await fixture({ hours: 30, grossAmount: 44, marker: "policy" });
    const preview = await call(`/api/bookings/${booking._id}/cancellation-policy`);
    assert.equal(preview.response.status, 200);
    assert.equal(preview.body.refundPercentage, 100);
    assert.equal(preview.body.refundAmount, 44);
    assert.equal(preview.body.currency, "JOD");
    assert.ok(Array.isArray(preview.body.rules));

    const other = await call(`/api/bookings/${booking._id}/cancellation-policy`, { token: otherToken });
    assert.equal(other.response.status, 404, "another customer must not learn whether the booking is owned by someone else");
    const anonymous = await call(`/api/bookings/${booking._id}/cancellation-policy`, { token: null });
    assert.equal(anonymous.response.status, 401);
  });

  await t.test("successful cancellation releases seats and mock refund exactly once", async () => {
    const { booking, departure, payment } = await fixture({ hours: 30, grossAmount: 40, seats: 2, marker: "success" });
    const first = await call(`/api/bookings/${booking._id}/cancel`, { method: "POST", body: {} });
    assert.equal(first.response.status, 200);
    assert.deepEqual(
      { status: first.body.status, refundPercentage: first.body.refundPercentage, refundAmount: first.body.refundAmount, refundStatus: first.body.refundStatus, currency: first.body.currency },
      { status: "cancelled", refundPercentage: 100, refundAmount: 40, refundStatus: "processed", currency: "JOD" }
    );
    assert.equal(Object.hasOwn(first.body, "refundReference"), false, "customer response must not expose refund references");

    const afterDeparture = await Departure.findById(departure._id).lean();
    const afterPayment = await Payment.findById(payment._id).lean();
    const afterBooking = await Booking.findById(booking._id).lean();
    assert.equal(afterDeparture.reservedSeats, 0);
    assert.equal(afterPayment.refundedAmount, 40);
    assert.equal(afterPayment.status, "refunded");
    assert.equal(afterBooking.status, "cancelled");
    assert.equal(afterBooking.cancellation.refundPercentage, 100);
    assert.equal(afterBooking.cancellation.refundAmount, 40);
    assert.equal(afterBooking.pricing.grossAmount, 40, "historical pricing snapshot must remain unchanged");

    const second = await call(`/api/bookings/${booking._id}/cancel`, { method: "POST", body: {} });
    assert.equal(second.response.status, 200, "duplicate cancellation is an idempotent success");
    const duplicateDeparture = await Departure.findById(departure._id).lean();
    const duplicatePayment = await Payment.findById(payment._id).lean();
    assert.equal(duplicateDeparture.reservedSeats, 0, "duplicate cancellation must not release seats twice or go negative");
    assert.equal(duplicatePayment.refundedAmount, 40, "duplicate cancellation must not refund twice");
    assert.equal(await InAppNotification.countDocuments({ bookingId: booking._id, type: "booking_cancelled" }), 2, "deduped cancellation creates one customer and one provider in-app notice");
  });

  await t.test("checked-in and non-scheduled departures fail closed without mutation", async () => {
    const checked = await fixture({ hours: 30, checkedInAt: new Date(), marker: "checked" });
    const checkedPolicy = await call(`/api/bookings/${checked.booking._id}/cancellation-policy`);
    assert.equal(checkedPolicy.response.status, 409);
    const checkedCancel = await call(`/api/bookings/${checked.booking._id}/cancel`, { method: "POST", body: {} });
    assert.equal(checkedCancel.response.status, 409);
    assert.equal((await Departure.findById(checked.departure._id).lean()).reservedSeats, 2);
    assert.equal((await Booking.findById(checked.booking._id).lean()).status, "confirmed");

    for (const departureStatus of ["completed", "cancelled"]) {
      const row = await fixture({ hours: 30, departureStatus, marker: `state-${departureStatus}` });
      const policy = await call(`/api/bookings/${row.booking._id}/cancellation-policy`);
      assert.equal(policy.response.status, 409);
      const cancel = await call(`/api/bookings/${row.booking._id}/cancel`, { method: "POST", body: {} });
      assert.equal(cancel.response.status, 409);
      assert.equal((await Departure.findById(row.departure._id).lean()).reservedSeats, 2);
      assert.equal((await Booking.findById(row.booking._id).lean()).status, "confirmed");
    }
  });

  await t.test("other customer and unauthenticated mutation attempts cannot cancel", async () => {
    const { booking, departure } = await fixture({ marker: "ownership" });
    const other = await call(`/api/bookings/${booking._id}/cancel`, { token: otherToken, method: "POST", body: {} });
    assert.equal(other.response.status, 404);
    const anonymous = await call(`/api/bookings/${booking._id}/cancel`, { token: null, method: "POST", body: {} });
    assert.equal(anonymous.response.status, 401);
    assert.equal((await Booking.findById(booking._id).lean()).status, "confirmed");
    assert.equal((await Departure.findById(departure._id).lean()).reservedSeats, 2);
  });

  await t.test("final cancellation recalculates a changed policy instead of trusting preview", async () => {
    const { booking, departure, payment } = await fixture({ hours: 30, grossAmount: 40, marker: "policy-race" });
    const preview = await call(`/api/bookings/${booking._id}/cancellation-policy`);
    assert.equal(preview.body.refundPercentage, 100);
    assert.equal(preview.body.refundAmount, 40);

    await Departure.updateOne({ _id: departure._id }, { $set: { startsAt: new Date(Date.now() + 13 * 3600000) } });
    await Trip.updateOne({ _id: trip._id }, { $set: { "pricing.pricePerPerson": 999, "pricing.adultPrice": 999 } });

    const final = await call(`/api/bookings/${booking._id}/cancel`, { method: "POST", body: {} });
    assert.equal(final.response.status, 200);
    assert.equal(final.body.refundPercentage, 50);
    assert.equal(final.body.refundAmount, 20, "final refund must use the booking snapshot and current server policy");
    const stored = await Booking.findById(booking._id).lean();
    assert.equal(stored.pricing.grossAmount, 40, "current Trip pricing must not rewrite booking finance history");
    assert.equal((await Payment.findById(payment._id).lean()).refundedAmount, 20);
  });

  await t.test("departure state race after preview is rejected before refund or seat release", async () => {
    const { booking, departure, payment } = await fixture({ hours: 30, grossAmount: 40, marker: "departure-race" });
    const preview = await call(`/api/bookings/${booking._id}/cancellation-policy`);
    assert.equal(preview.response.status, 200);
    await Departure.updateOne({ _id: departure._id }, { $set: { status: "completed" } });

    const final = await call(`/api/bookings/${booking._id}/cancel`, { method: "POST", body: {} });
    assert.equal(final.response.status, 409);
    assert.equal(final.body.error, "This booking can no longer be cancelled");
    assert.equal((await Booking.findById(booking._id).lean()).status, "confirmed");
    assert.equal((await Departure.findById(departure._id).lean()).reservedSeats, 2);
    const storedPayment = await Payment.findById(payment._id).lean();
    assert.equal(storedPayment.status, "paid");
    assert.equal(storedPayment.refundedAmount, 0);
  });

  await t.test("no-refund policy window remains cancellable because that is the current contract", async () => {
    const { booking, departure, payment } = await fixture({ hours: 2, grossAmount: 40, marker: "zero-refund" });
    const preview = await call(`/api/bookings/${booking._id}/cancellation-policy`);
    assert.equal(preview.response.status, 200);
    assert.equal(preview.body.refundPercentage, 0);
    assert.equal(preview.body.refundAmount, 0);
    const result = await call(`/api/bookings/${booking._id}/cancel`, { method: "POST", body: {} });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.refundStatus, "none");
    assert.equal(result.body.refundAmount, 0);
    assert.equal((await Departure.findById(departure._id).lean()).reservedSeats, 0);
    const storedPayment = await Payment.findById(payment._id).lean();
    assert.equal(storedPayment.status, "paid");
    assert.equal(storedPayment.refundedAmount, 0);
  });

  await t.test("non-mock refunds stay pending and never claim gateway completion", async () => {
    const { booking, departure, payment } = await fixture({ hours: 30, grossAmount: 40, paymentProvider: "future_gateway", marker: "gateway" });
    const result = await call(`/api/bookings/${booking._id}/cancel`, { method: "POST", body: {} });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, "cancelled");
    assert.equal(result.body.refundStatus, "pending");
    assert.equal(result.body.refundAmount, 40);
    const storedPayment = await Payment.findById(payment._id).lean();
    assert.equal(storedPayment.status, "needs_review");
    assert.equal(storedPayment.refundedAmount, 0);
    assert.equal((await Departure.findById(departure._id).lean()).reservedSeats, 0);
  });

  await t.test("cancelled booking remains historical and ticket lifecycle becomes non-usable", async () => {
    const { booking } = await fixture({ hours: 30, grossAmount: 40, marker: "history" });
    const before = await call("/api/bookings");
    const beforeRow = before.body.find(row => row._id === String(booking._id));
    assert.equal(beforeRow.ticketLifecycle.state, "ready");
    assert.equal(beforeRow.ticketLifecycle.usable, true);
    const originalPricing = structuredClone(beforeRow.pricing);

    const result = await call(`/api/bookings/${booking._id}/cancel`, { method: "POST", body: {} });
    assert.equal(result.response.status, 200);
    const after = await call("/api/bookings");
    const afterRow = after.body.find(row => row._id === String(booking._id));
    assert.ok(afterRow, "cancelled booking must remain in My Tickets history");
    assert.equal(afterRow.status, "cancelled");
    assert.deepEqual(afterRow.ticketLifecycle, { state: "booking_cancelled", usable: false, used: false });
    assert.deepEqual(afterRow.pricing, originalPricing, "booking pricing snapshot must remain unchanged");
    assert.deepEqual(Object.keys(afterRow.cancellation).sort(), ["cancelledAt", "refundAmount", "refundPercentage", "refundStatus"].sort());

    const validation = await call(`/api/tickets/validate?token=${encodeURIComponent(afterRow.ticketToken)}`);
    assert.equal(validation.response.status, 200);
    assert.equal(validation.body.valid, false);
    assert.equal(validation.body.lifecycleState, "booking_cancelled");
  });
});
