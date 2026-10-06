import test from "node:test";
import assert from "node:assert/strict";
import Trip from "../src/models/Trip.js";
import Provider from "../src/models/Provider.js";
import ProviderMember from "../src/models/ProviderMember.js";
import ProviderAuditLog from "../src/models/ProviderAuditLog.js";
import Departure from "../src/models/Departure.js";
import CheckoutHold from "../src/models/CheckoutHold.js";
import Booking from "../src/models/Booking.js";
import tripRoutes from "../src/routes/trips.js";
import departureRoutes from "../src/routes/departures.js";
import providerRoutes from "../src/routes/providers.js";
import bookingRoutes from "../src/routes/bookings.js";
import { calculateTieredPricing } from "../src/services/pricing.js";
import { salePricing } from "../src/services/pricingVisibility.js";

const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
const providerId = "bbbbbbbbbbbbbbbbbbbbbbbb";
const provider = { _id: providerId, status: "approved" };
const pricing = {
  currency: "JOD", pricePerPerson: 15, adultPrice: 15, childPrice: 10,
  buffetEnabled: true, buffetAdultPrice: 20, buffetChildPrice: 15,
  commissionType: "fixed_per_person", commissionValue: 3,
  adultCommission: 3, childCommission: 2, buffetAdultCommission: 5,
  buffetChildCommission: 3
};
const financeKeys = ["commissionType", "commissionValue", "adultCommission",
  "childCommission", "buffetAdultCommission", "buffetChildCommission",
  "commissionAmount", "providerNetAmount"];

function query(value) {
  return {
    select() { return this; }, populate() { return this; }, sort() { return this; },
    limit() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); }
  };
}
function fixture() {
  return Trip.hydrate({ _id: id, providerId, titleEn: "Test trip", titleAr: "رحلة",
    category: "yacht", durationMinutes: 120, active: true, pricing });
}
async function call(router, method, path, overrides = {}) {
  // Invoke the real endpoint handler with isolated model methods. Authentication
  // middleware is not exercised here; explicit users/access fixtures follow.
  const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
  let result;
  let status = 200;
  let error;
  const req = { body: {}, query: {}, params: {}, user: { _id: id, role: "provider" },
    protocol: "https", get: () => "audit.invalid", ...overrides };
  const res = { status(code) { status = code; return this; }, json(value) { result = value; return this; } };
  await route.stack.at(-1).handle(req, res, err => { error = err; });
  if (error) throw error;
  return { status, result: JSON.parse(JSON.stringify(result)) };
}
function assertPrivate(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!financeKeys.includes(key), `Financial field leaked: ${key}`);
    assertPrivate(child);
  }
}

for (const commissionType of ["fixed_per_person", "fixed_per_booking", "percentage"]) {
  test(`trip PATCH preserves ${commissionType} agreement and ignores injected finance fields`, async t => {
    const trip = fixture();
    trip.pricing.commissionType = commissionType;
    trip.$clearModifiedPaths();
    const before = Object.fromEntries(financeKeys.filter(k => trip.pricing[k] !== undefined).map(k => [k, trip.pricing[k]]));
    let modified;
    t.mock.method(Provider, "findOne", () => query(provider));
    t.mock.method(Trip, "findOne", async () => trip);
    t.mock.method(trip, "save", async () => { modified = trip.modifiedPaths(); return trip; });
    t.mock.method(ProviderAuditLog, "create", async () => ({}));
    const r = await call(tripRoutes, "patch", "/:tripId", {
      params: { tripId: id }, body: { pricing: { adultPrice: 17, childPrice: 12,
        buffetAdultPrice: 23, buffetChildPrice: 18, commissionType: "percentage",
        commissionValue: 0, adultCommission: 0, childCommission: 0,
        buffetAdultCommission: 0, buffetChildCommission: 0, providerNetAmount: 999 } }
    });
    assert.equal(r.status, 200);
    assert.equal(trip.pricing.adultPrice, 17);
    for (const [key, value] of Object.entries(before)) assert.equal(trip.pricing[key], value);
    for (const key of financeKeys) assert.ok(!modified.includes(`pricing.${key}`));
    // Mongoose must generate dotted sale writes, not replace the pricing object
    // with an old copy of the administrator's agreement.
    const update = trip.getChanges();
    assert.equal(update.$set?.pricing, undefined);
    for (const key of Object.keys(update.$set || {})) assert.ok(!financeKeys.includes(key.split(".")[1]));
    const plain = trip.pricing.toObject();
    if (commissionType === "fixed_per_person") {
      assert.equal(calculateTieredPricing({ pricing: plain, adults: 1, children: 1 }).commissionAmount, 5);
      assert.equal(calculateTieredPricing({ pricing: plain, adults: 1, children: 1, mealPlan: "with_buffet" }).commissionAmount, 8);
    } else {
      const amount = calculateTieredPricing({ pricing: plain, adults: 1, children: 1 }).commissionAmount;
      assert.equal(amount, commissionType === "fixed_per_booking" ? 3 : 0.87);
    }
  });
}

test("new trip creation ignores client commission settings", async t => {
  const original = process.env.DEFAULT_COMMISSION_PERCENTAGE;
  process.env.DEFAULT_COMMISSION_PERCENTAGE = "12";
  t.after(() => { if (original === undefined) delete process.env.DEFAULT_COMMISSION_PERCENTAGE; else process.env.DEFAULT_COMMISSION_PERCENTAGE = original; });
  let created;
  t.mock.method(Provider, "findOne", () => query(provider));
  t.mock.method(Trip, "create", async data => { created = data; return { _id: id, ...data }; });
  t.mock.method(ProviderAuditLog, "create", async () => ({}));
  const r = await call(tripRoutes, "post", "/", { body: {
    titleAr: "رحلة", titleEn: "Test trip", category: "yacht", durationMinutes: 120,
    pricing: { adultPrice: 20, commissionType: "fixed_per_person", commissionValue: 0, adultCommission: 0 }
  } });
  assert.equal(r.status, 201);
  assert.equal(created.pricing.commissionType, "percentage");
  assert.equal(created.pricing.commissionValue, 12);
  assert.equal(created.pricing.adultCommission, undefined);
});

test("public trips expose sale prices but no agreement fields", async t => {
  t.mock.method(Provider, "find", () => query([provider]));
  t.mock.method(Trip, "find", () => query([fixture()]));
  const { result } = await call(tripRoutes, "get", "/");
  assertPrivate(result);
  assert.equal(result[0].pricing.adultPrice, 15);
  assert.equal(result[0].pricing.buffetChildPrice, 15);
});

test("public quote keeps the customer total and hides internal split", async t => {
  t.mock.method(CheckoutHold, "find", () => query([]));
  t.mock.method(Departure, "findById", async () => ({ _id: id, tripId: id, status: "scheduled",
    startsAt: new Date(Date.now() + 86400000), capacity: 10, reservedSeats: 0 }));
  t.mock.method(Trip, "findOne", async () => fixture());
  t.mock.method(Provider, "findOne", () => query(provider));
  const { result } = await call(departureRoutes, "get", "/:departureId/quote", {
    params: { departureId: id }, query: { adults: "1", children: "1", mealPlan: "with_buffet" }
  });
  assertPrivate(result);
  assert.equal(result.pricing.grossAmount, 35);
  assert.equal(result.availableSeats, 10);
});

for (const role of ["owner", "manager", "staff", "checkin"]) {
  test(`provider trip list follows ${role} financial permissions`, async t => {
    t.mock.method(Provider, "findOne", () => query(role === "owner" ? provider : null));
    t.mock.method(ProviderMember, "findOne", () => query({ providerId: provider, role }));
    t.mock.method(Trip, "find", () => query([fixture()]));
    t.mock.method(Departure, "find", () => query([]));
    const { result } = await call(providerRoutes, "get", "/me/trips");
    if (["owner", "manager"].includes(role)) assert.equal(result[0].pricing.adultCommission, 3);
    else assertPrivate(result);
    assert.equal(result[0].pricing.adultPrice, 15);
    assert.equal(result[0].schedule.upcomingDepartures, 0);
  });
}

test("customer tickets redact both booking split and nested trip agreement", async t => {
  const oldSecret = process.env.TICKET_SIGNING_SECRET;
  process.env.TICKET_SIGNING_SECRET = "isolated-test-ticket-secret";
  t.after(() => { if (oldSecret === undefined) delete process.env.TICKET_SIGNING_SECRET; else process.env.TICKET_SIGNING_SECRET = oldSecret; });
  const row = { _id: id, toObject: () => ({ _id: id, status: "confirmed", tripId: fixture().toObject(),
    pricing: { grossAmount: 35, currency: "JOD", commissionAmount: 8, providerNetAmount: 27 } }) };
  t.mock.method(Booking, "find", () => query([row]));
  const { result } = await call(bookingRoutes, "get", "/", { user: { _id: id, role: "customer", name: "Test", phone: "+962790000000" } });
  assertPrivate(result);
  assert.equal(result[0].pricing.grossAmount, 35);
  assert.equal(result[0].tripId.pricing.adultPrice, 15);
  assert.ok(result[0].ticketToken);
});

test("sale response allowlist does not expose newly introduced internal fields", () => {
  assert.deepEqual(salePricing({ grossAmount: 20, currency: "JOD", internalMargin: 4 }), { currency: "JOD", grossAmount: 20 });
});
