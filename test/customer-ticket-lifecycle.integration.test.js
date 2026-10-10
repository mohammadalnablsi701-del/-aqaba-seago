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
import ProviderMember from "../src/models/ProviderMember.js";

const uri = process.env.SEAGO_TEST_MONGODB_URI;

function auth(userId, secret) {
  return jwt.sign({ sub: String(userId) }, secret, { expiresIn: "1h" });
}

async function json(response) {
  const body = await response.json();
  return { response, body };
}

test("customer ticket lifecycle DTO matches validator truth", { skip: !uri }, async t => {
  assert.match(uri, /^mongodb:\/\/(127\.0\.0\.1|localhost):/, "Only a local disposable replica set is allowed");
  const oldJwt = process.env.JWT_SECRET;
  const oldTicket = process.env.TICKET_SIGNING_SECRET;
  const secret = "ticket-lifecycle-test-secret-at-least-32-characters";
  process.env.JWT_SECRET = secret;
  process.env.TICKET_SIGNING_SECRET = secret;

  await mongoose.connect(uri, { dbName: "seago_ticket_lifecycle_" + crypto.randomUUID().replaceAll("-", "") });
  t.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (oldJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldJwt;
    if (oldTicket === undefined) delete process.env.TICKET_SIGNING_SECRET; else process.env.TICKET_SIGNING_SECRET = oldTicket;
  });
  await Promise.all([User, Provider, Trip, Departure, Booking, ProviderMember].map(model => model.init()));

  const owner = await User.create({ name: "Lifecycle Provider", phone: "+962790001001", role: "provider" });
  const customer = await User.create({ name: "Lifecycle Customer", phone: "+962790001002", role: "customer" });
  const otherCustomer = await User.create({ name: "Other Customer", phone: "+962790001003", role: "customer" });
  const provider = await Provider.create({ ownerUserId: owner._id, businessName: "Lifecycle Boats", phone: "+96232000000", status: "approved" });
  const trip = await Trip.create({
    providerId: provider._id,
    titleAr: "رحلة دورة حياة التذكرة",
    titleEn: "Ticket lifecycle trip",
    category: "yacht",
    durationMinutes: 60,
    active: true,
    pricing: { currency: "JOD", pricePerPerson: 20, adultPrice: 20, commissionType: "fixed_per_person", commissionValue: 4 }
  });

  const baseTime = Date.now() + 3 * 86400000;
  async function departure(offsetHours, status = "scheduled") {
    return Departure.create({
      tripId: trip._id,
      startsAt: new Date(baseTime + offsetHours * 3600000),
      capacity: 20,
      reservedSeats: 1,
      status
    });
  }

  const readyDep = await departure(1, "scheduled");
  const usedDep = await departure(2, "scheduled");
  const bookingCancelledDep = await departure(3, "scheduled");
  const refundedDep = await departure(4, "scheduled");
  const departureCancelledDep = await departure(5, "cancelled");
  const completedDep = await departure(6, "completed");
  const completedUsedDep = await departure(7, "completed");
  const pastScheduledDep = await Departure.create({
    tripId: trip._id,
    startsAt: new Date(Date.now() - 3600000),
    capacity: 20,
    reservedSeats: 1,
    status: "scheduled"
  });
  const otherDep = await departure(8, "scheduled");

  async function makeBooking({ customerId = customer._id, departureId, status = "confirmed", checkedInAt = null, checkedInBy = null, marker }) {
    return Booking.create({
      customerId,
      customerSnapshot: { name: "Lifecycle Customer", phone: "+962790001002" },
      providerId: provider._id,
      tripId: trip._id,
      departureId,
      seats: 1,
      adults: 1,
      children: 0,
      mealPlan: "without_buffet",
      status,
      holdExpiresAt: new Date(Date.now() + 300000),
      pricing: { currency: "JOD", grossAmount: 20 + marker, commissionAmount: 4, providerNetAmount: 16 + marker },
      idempotencyKey: `lifecycle-${marker}-${crypto.randomUUID()}`,
      checkedInAt,
      checkedInBy,
      checkInCount: checkedInAt ? 1 : 0,
      ...(status === "cancelled" ? { cancellation: { source: "customer", reason: "fixture", cancelledAt: new Date(), refundPercentage: 50, refundAmount: 10, refundStatus: "processed" } } : {})
    });
  }

  const ready = await makeBooking({ departureId: readyDep._id, marker: 1 });
  const used = await makeBooking({ departureId: usedDep._id, checkedInAt: new Date(), checkedInBy: owner._id, marker: 2 });
  const bookingCancelled = await makeBooking({ departureId: bookingCancelledDep._id, status: "cancelled", marker: 3 });
  const refunded = await makeBooking({ departureId: refundedDep._id, status: "refunded", marker: 4 });
  const departureCancelled = await makeBooking({ departureId: departureCancelledDep._id, marker: 5 });
  const completed = await makeBooking({ departureId: completedDep._id, marker: 6 });
  const completedUsed = await makeBooking({ departureId: completedUsedDep._id, checkedInAt: new Date(), checkedInBy: owner._id, marker: 7 });
  const pastScheduled = await makeBooking({ departureId: pastScheduledDep._id, marker: 8 });
  const otherBooking = await makeBooking({ customerId: otherCustomer._id, departureId: otherDep._id, marker: 9 });

  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const customerToken = auth(customer._id, secret);
  const otherToken = auth(otherCustomer._id, secret);
  const providerToken = auth(owner._id, secret);

  async function list(token = customerToken) {
    return json(await fetch(`${base}/api/bookings`, { headers: { authorization: `Bearer ${token}` } }));
  }

  const { response: listResponse, body: rows } = await list();
  assert.equal(listResponse.status, 200);
  assert.equal(rows.length, 8, "completed/cancelled/refunded/used bookings must remain visible");
  assert.equal(rows.some(row => row._id === String(otherBooking._id)), false, "another customer's booking must not be returned");

  const expected = new Map([
    [String(ready._id), ["ready", true, false]],
    [String(used._id), ["checked_in", false, true]],
    [String(bookingCancelled._id), ["booking_cancelled", false, false]],
    [String(refunded._id), ["refunded", false, false]],
    [String(departureCancelled._id), ["departure_cancelled", false, false]],
    [String(completed._id), ["trip_completed", false, false]],
    [String(completedUsed._id), ["checked_in", false, true]],
    [String(pastScheduled._id), ["ready", true, false]]
  ]);

  for (const row of rows) {
    const truth = expected.get(row._id);
    assert.ok(truth, `unexpected booking ${row._id}`);
    assert.deepEqual(row.ticketLifecycle, { state: truth[0], usable: truth[1], used: truth[2] });
    assert.deepEqual(Object.keys(row.ticketLifecycle).sort(), ["state", "usable", "used"]);
    assert.deepEqual(Object.keys(row.departureId).sort(), ["_id", "startsAt", "status"]);

    const validation = await json(await fetch(`${base}/api/tickets/validate?token=${encodeURIComponent(row.ticketToken)}`));
    assert.equal(validation.response.status, 200);
    assert.equal(validation.body.valid, row.ticketLifecycle.usable, `validator parity failed for ${truth[0]}`);
    assert.equal(validation.body.lifecycleState, row.ticketLifecycle.state);
    assert.equal(validation.body.used, row.ticketLifecycle.used);
  }

  const readyRow = rows.find(row => row._id === String(ready._id));
  const topLevelKeys = Object.keys(readyRow).sort();
  assert.deepEqual(topLevelKeys, [
    "_id", "adults", "cancellation", "checkedInAt", "children", "createdAt", "customer", "departureId",
    "mealPlan", "pricing", "providerId", "seats", "status", "ticketLifecycle", "ticketToken", "ticketValidationUrl",
    "tripId", "updatedAt"
  ].sort());
  for (const forbidden of ["customerId", "checkedInBy", "checkInCount", "holdExpiresAt", "idempotencyKey", "__v"]) {
    assert.equal(Object.hasOwn(readyRow, forbidden), false, `${forbidden} must stay out of the customer DTO`);
  }
  assert.equal(Object.hasOwn(readyRow.pricing, "commissionAmount"), false);
  assert.equal(Object.hasOwn(readyRow.pricing, "providerNetAmount"), false);
  assert.equal(Object.hasOwn(readyRow.departureId, "capacity"), false);
  assert.equal(Object.hasOwn(readyRow.departureId, "reservedSeats"), false);
  assert.equal(JSON.stringify(rows).includes(secret), false, "signing secret must never appear in the DTO");

  const otherList = await list(otherToken);
  assert.equal(otherList.response.status, 200);
  assert.deepEqual(otherList.body.map(row => row._id), [String(otherBooking._id)]);

  await t.test("provider check-in turns a ready customer ticket into checked-in truth", async () => {
    const checkIn = await json(await fetch(`${base}/api/tickets/check-in`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ token: readyRow.ticketToken })
    }));
    assert.equal(checkIn.response.status, 200);
    assert.ok(checkIn.body.checkedInAt);

    const afterCheckIn = await list();
    const row = afterCheckIn.body.find(item => item._id === String(ready._id));
    assert.deepEqual(row.ticketLifecycle, { state: "checked_in", usable: false, used: true });

    readyDep.status = "completed";
    await readyDep.save();
    const afterCompletion = await list();
    const historical = afterCompletion.body.find(item => item._id === String(ready._id));
    assert.deepEqual(historical.ticketLifecycle, { state: "checked_in", usable: false, used: true });
    assert.ok(historical.checkedInAt, "departure completion must not erase check-in history");
  });
});
