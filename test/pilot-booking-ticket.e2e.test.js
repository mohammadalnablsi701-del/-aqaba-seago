import { cleanupFixtures, requireFixture, connectFixture } from '../scripts/test-safety/fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../src/models/User.js';
import Provider from '../src/models/Provider.js';
import Trip from '../src/models/Trip.js';
import Departure from '../src/models/Departure.js';
import Hold from '../src/models/CheckoutHold.js';
import Payment from '../src/models/Payment.js';
import PaymentEvent from '../src/models/PaymentEvent.js';
import Booking from '../src/models/Booking.js';
import ProviderMember from '../src/models/ProviderMember.js';
import InAppNotification from '../src/models/InAppNotification.js';
import NotificationLog from '../src/models/NotificationLog.js';
import Refund from '../src/models/Refund.js';

requireFixture();
test.after(cleanupFixtures);

// These deliberately synthetic prices establish independent arithmetic, not a
// business price decision: base 15 + 10 = 25; buffet 17 + 12 = 29; fee 3 + 2 = 5.
const FIXTURE_PRICING = {
  currency: 'JOD', pricePerPerson: 15, adultPrice: 15, childPrice: 10,
  buffetEnabled: true, buffetAdultPrice: 17, buffetChildPrice: 12,
  commissionType: 'fixed_per_person', commissionValue: 3,
  adultCommission: 3, childCommission: 2, buffetAdultCommission: 3, buffetChildCommission: 2
};

test('Phase 2B disposable local API quote-to-check-in acceptance', async t => {
  const environmentNames = [
    'JWT_SECRET', 'JWT_EXPIRES_IN', 'TICKET_SIGNING_SECRET', 'MOCK_PAYMENT_WEBHOOK_SECRET',
    'PAYMENT_PROVIDER', 'ENABLE_MOCK_CHECKOUT', 'PUBLIC_LAUNCH', 'FCM_ENABLED',
    'RESEND_API_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY',
    'PUBLIC_BASE_URL', 'FRONTEND_BASE_URL', 'API_RATE_LIMIT', 'AUTH_RATE_LIMIT'
  ];
  const savedEnvironment = Object.fromEntries(environmentNames.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const attemptedExternal = [];
  let server;
  t.after(async () => {
    try {
      if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      assert.deepEqual(attemptedExternal, [], 'the acceptance harness must never attempt external HTTP');
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(savedEnvironment)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  await connectFixture();
  await Promise.all([User, Provider, Trip, Departure, Hold, Payment, PaymentEvent, Booking,
    ProviderMember, InAppNotification, NotificationLog, Refund].map(model => model.init()));

  // Listen without an application first, so module-time notification URLs are
  // local too. Never import server.js, dotenv, a seed script or a live URI.
  server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, {
    JWT_SECRET: crypto.randomBytes(48).toString('base64url'), JWT_EXPIRES_IN: '1h',
    TICKET_SIGNING_SECRET: crypto.randomBytes(48).toString('base64url'),
    MOCK_PAYMENT_WEBHOOK_SECRET: crypto.randomBytes(48).toString('base64url'),
    PAYMENT_PROVIDER: 'mock', ENABLE_MOCK_CHECKOUT: 'true', PUBLIC_LAUNCH: 'false', FCM_ENABLED: 'false',
    PUBLIC_BASE_URL: base, FRONTEND_BASE_URL: base, API_RATE_LIMIT: '2000', AUTH_RATE_LIMIT: '100'
  });
  for (const key of ['RESEND_API_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) delete process.env[key];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== base || url.username || url.password) {
      attemptedExternal.push(url.origin);
      throw new Error('Phase 2B blocks non-local HTTP');
    }
    return originalFetch(input, { ...options, redirect: 'error' });
  };
  const { createApp } = await import('../src/app.js');
  server.on('request', createApp());

  const tokenFor = user => jwt.sign({ sub: String(user._id), ver: user.authVersion || 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  async function api(path, { method = 'GET', token, body, headers = {}, rawBody } = {}) {
    const response = await fetch(base + path, {
      method, headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined || rawBody !== undefined ? { 'content-type': 'application/json' } : {}), ...headers
      }, ...(rawBody !== undefined ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  }
  function expectStatus(result, expected) {
    assert.equal(result.status, expected, JSON.stringify(result.data));
    return result.data;
  }
  const quote = (departure, quantities = {}) => api(`/api/departures/${departure._id}/quote?${new URLSearchParams({ adults: '1', children: '1', mealPlan: 'with_buffet', ...quantities })}`);
  let customerToken, customerId;
  async function checkout(departure, overrides = {}, key = crypto.randomUUID(), token = customerToken) {
    return api('/api/payments/checkout', {
      method: 'POST', token, headers: { 'idempotency-key': key },
      body: { departureId: String(departure._id), adults: 1, children: 1, mealPlan: 'with_buffet', partyType: 'family', partyPolicyConfirmed: true, ...overrides }
    });
  }
  async function webhook(payment, overrides = {}, { eventId = crypto.randomUUID(), signature } = {}) {
    const payload = {
      eventId, paymentReference: String(payment._id), externalPaymentId: payment.externalPaymentId,
      status: 'paid', amount: payment.amount, currency: payment.currency, ...overrides
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signed = signature ?? crypto.createHmac('sha256', process.env.MOCK_PAYMENT_WEBHOOK_SECRET).update(rawBody).digest('hex');
    return api('/api/payments/webhooks/mock', { method: 'POST', rawBody, headers: { 'x-seago-signature': signed } });
  }
  async function makeTrip(provider, { title = 'Phase2B Test Trip', pricing = {}, capacity = 20, hours = 48 } = {}) {
    const trip = await Trip.create({
      providerId: provider._id, titleAr: 'رحلة اختبار المرحلة الثانية', titleEn: title,
      vesselName: 'Phase2B Synthetic Vessel', category: 'sunset', durationMinutes: 120,
      active: true, platformStatus: 'allowed', departureLocation: { name: 'Phase2B Synthetic Marina' },
      pricing: { ...FIXTURE_PRICING, ...pricing }
    });
    const departure = await Departure.create({
      tripId: trip._id, startsAt: new Date(Date.now() + hours * 3600000), capacity, reservedSeats: 0, status: 'scheduled'
    });
    return { trip, departure };
  }
  async function payCheckout(departure, overrides = {}) {
    const created = expectStatus(await checkout(departure, overrides), 201);
    const payment = await Payment.findById(created.paymentId);
    expectStatus(await webhook(payment), 200);
    const paid = await Payment.findById(payment._id);
    assert.equal(paid.status, 'paid');
    const booking = await Booking.findById(paid.bookingId);
    assert.equal(booking.status, 'confirmed');
    const rows = expectStatus(await api('/api/bookings', { token: customerToken }), 200);
    const ticket = rows.find(row => String(row._id) === String(booking._id));
    assert.ok(ticket?.ticketToken);
    return { payment: paid, booking, ticket };
  }
  const ticketRequest = (path, ticket, token) => api(`/api/tickets/${path}`, { method: 'POST', token, body: { token: ticket } });
  const manualCheckin = (booking, token) => api(`/api/providers/me/bookings/${booking._id}/check-in`, { method: 'POST', token });

  const [owner, otherOwner, scanner, manager, staff, revoked, unassigned, admin] = await User.create([
    { name: 'Phase2B Test Provider Owner', role: 'provider' },
    { name: 'Phase2B Test Other Provider Owner', role: 'provider' },
    { name: 'Phase2B Test Checkin Member', role: 'provider' },
    { name: 'Phase2B Test Manager Member', role: 'provider' },
    { name: 'Phase2B Test Staff Member', role: 'provider' },
    { name: 'Phase2B Test Revoked Member', role: 'provider' },
    { name: 'Phase2B Test Unassigned Member', role: 'provider' },
    { name: 'Phase2B Test Admin', role: 'admin' }
  ]);
  const provider = await Provider.create({ ownerUserId: owner._id, businessName: 'Phase2B Test Provider', status: 'approved' });
  await Provider.create({ ownerUserId: otherOwner._id, businessName: 'Phase2B Test Other Provider', status: 'approved' });
  await ProviderMember.create([
    { providerId: provider._id, userId: scanner._id, role: 'checkin', isActive: true },
    { providerId: provider._id, userId: manager._id, role: 'manager', isActive: true },
    { providerId: provider._id, userId: staff._id, role: 'staff', isActive: true },
    { providerId: provider._id, userId: revoked._id, role: 'staff', isActive: false }
  ]);
  const ownerToken = tokenFor(owner), otherToken = tokenFor(otherOwner), scanToken = tokenFor(scanner);
  const main = await makeTrip(provider, { capacity: 10 });
  let mainPayment, mainBooking, mainTicket, mainSnapshot;

  await t.test('synthetic customer registration/login establishes real authenticated API access', async () => {
    const credentials = { name: 'Phase2B Test Customer', email: 'phase2b-customer@example.invalid', phone: '+962790002201', password: crypto.randomBytes(24).toString('base64url') };
    const registered = expectStatus(await api('/api/auth/register', { method: 'POST', body: credentials }), 201);
    assert.equal(registered.user.role, 'customer');
    const login = expectStatus(await api('/api/auth/login', { method: 'POST', body: { email: credentials.email, password: credentials.password } }), 200);
    customerToken = login.token;
    customerId = login.user.id || login.user._id;
    assert.ok(customerId);
    assert.equal(jwt.verify(customerToken, process.env.JWT_SECRET).sub, String(customerId));
    expectStatus(await checkout(main.departure, {}, crypto.randomUUID(), ''), 401);
    expectStatus(await checkout(main.departure, {}, crypto.randomUUID(), ownerToken), 403);
    expectStatus(await api('/api/bookings', { token: customerToken }), 200);
  });

  await t.test('server quote distinguishes base and buffet arithmetic and rejects authoritative financial overrides', async () => {
    const baseQuote = expectStatus(await quote(main.departure, { mealPlan: 'without_buffet' }), 200);
    assert.equal(baseQuote.pricing.grossAmount, 25);
    assert.equal(baseQuote.pricing.adultUnitPrice, 15);
    assert.equal(baseQuote.pricing.childUnitPrice, 10);
    const buffetQuote = expectStatus(await quote(main.departure), 200);
    assert.equal(buffetQuote.pricing.grossAmount, 29);
    assert.equal(buffetQuote.pricing.adultSubtotal, 17);
    assert.equal(buffetQuote.pricing.childSubtotal, 12);
    assert.equal(buffetQuote.availableSeats, 10);
    for (const result of [baseQuote, buffetQuote]) {
      assert.equal(result.seats, 2);
      assert.equal(result.pricing.currency, 'JOD');
      assert.equal('commissionAmount' in result.pricing, false);
      assert.equal('providerNetAmount' in result.pricing, false);
    }
    for (const override of [
      { total: 0.01 }, { amount: 0.01 }, { pricing: { grossAmount: 0.01 } },
      { commissionAmount: 0 }, { commissionValue: 0 }, { providerNetAmount: 9999 }, { providerId: String(provider._id) }
    ]) expectStatus(await checkout(main.departure, override), 400);
    expectStatus(await api(`/api/trips/${main.trip._id}`, { method: 'PATCH', token: ownerToken, body: { pricing: { ...FIXTURE_PRICING, commissionValue: 0, adultCommission: 0, childCommission: 0 } } }), 200);
    const trustedCommission = (await Trip.findById(main.trip._id)).pricing;
    assert.equal(trustedCommission.commissionValue, 3);
    assert.equal(trustedCommission.adultCommission, 3); assert.equal(trustedCommission.childCommission, 2);
    assert.equal(await Hold.countDocuments(), 0);
    assert.equal(await Payment.countDocuments(), 0);
    assert.equal((await Departure.findById(main.departure._id)).reservedSeats, 0);
  });

  await t.test('checkout atomically holds seats with a server-owned pending mock payment and no booking', async () => {
    const result = expectStatus(await checkout(main.departure), 201);
    assert.equal(result.provider, 'mock');
    assert.equal(result.status, 'pending');
    assert.equal(result.amount, 29);
    assert.equal(result.currency, 'JOD');
    assert.equal(new URL(result.checkoutUrl).origin, base);
    mainPayment = await Payment.findById(result.paymentId);
    const hold = await Hold.findById(mainPayment.holdId);
    assert.equal(hold.status, 'active');
    assert.equal(String(hold.customerId), String(customerId));
    assert.equal(String(hold.providerId), String(provider._id));
    assert.equal(String(hold.tripId), String(main.trip._id));
    assert.equal(String(hold.departureId), String(main.departure._id));
    assert.equal(hold.adults, 1); assert.equal(hold.children, 1); assert.equal(hold.seats, 2);
    assert.equal(hold.mealPlan, 'with_buffet');
    mainSnapshot = hold.pricing.toObject();
    assert.deepEqual(mainSnapshot, { currency: 'JOD', unitPrice: 17, adultUnitPrice: 17, childUnitPrice: 12, adultSubtotal: 17, childSubtotal: 12, grossAmount: 29, commissionAmount: 5, providerNetAmount: 24 });
    assert.equal((await Departure.findById(main.departure._id)).reservedSeats, 2);
    assert.equal(await Booking.countDocuments(), 0);
    assert.deepEqual(expectStatus(await api('/api/bookings', { token: customerToken }), 200), []);
    expectStatus(await api('/api/bookings', { method: 'POST', token: customerToken, body: {} }), 410);
    expectStatus(await webhook(mainPayment, {}, { signature: '0'.repeat(64) }), 400);
    assert.equal(await PaymentEvent.countDocuments(), 0);
    assert.equal((await Payment.findById(mainPayment._id)).status, 'pending');
    assert.equal(await Booking.countDocuments(), 0);
  });

  await t.test('verified HTTP webhook confirms once, preserves hold finances and prevents retry accounting effects', async () => {
    await Trip.updateOne({ _id: main.trip._id }, { $set: { 'pricing.buffetAdultPrice': 100, 'pricing.buffetChildPrice': 80, 'pricing.adultCommission': 1, 'pricing.childCommission': 1, 'pricing.buffetAdultCommission': 1, 'pricing.buffetChildCommission': 1 } });
    const eventId = crypto.randomUUID();
    assert.equal(expectStatus(await webhook(mainPayment, {}, { eventId }), 200).duplicate, false);
    assert.equal(expectStatus(await webhook(mainPayment, {}, { eventId }), 200).duplicate, true);
    assert.equal(expectStatus(await webhook(mainPayment), 200).duplicate, false);
    mainPayment = await Payment.findById(mainPayment._id);
    mainBooking = await Booking.findById(mainPayment.bookingId);
    assert.equal(mainPayment.status, 'paid'); assert.equal(mainPayment.amount, 29); assert.equal(mainPayment.currency, 'JOD');
    assert.ok(mainPayment.paidAt);
    assert.equal(mainBooking.status, 'confirmed');
    assert.equal(String(mainBooking.customerId), String(customerId));
    assert.equal(String(mainBooking.providerId), String(provider._id));
    assert.equal(String(mainBooking.tripId), String(main.trip._id));
    assert.equal(String(mainBooking.departureId), String(main.departure._id));
    assert.equal(mainBooking.adults, 1); assert.equal(mainBooking.children, 1); assert.equal(mainBooking.seats, 2);
    assert.equal(mainBooking.mealPlan, 'with_buffet');
    assert.equal(mainBooking.customerSnapshot.name, 'Phase2B Test Customer');
    assert.deepEqual(mainBooking.pricing.toObject(), mainSnapshot);
    assert.equal((await Hold.findById(mainPayment.holdId)).status, 'paid');
    assert.equal(await Booking.countDocuments(), 1);
    assert.equal(await Payment.countDocuments(), 1);
    assert.equal(await PaymentEvent.countDocuments({ paymentId: mainPayment._id }), 2);
    assert.equal((await Departure.findById(main.departure._id)).reservedSeats, 2);
    assert.equal(await InAppNotification.countDocuments({ bookingId: mainBooking._id, userId: customerId }), 1);
    const financial = expectStatus(await api(`/api/admin/settlements?providerId=${provider._id}`, { token: tokenFor(admin) }), 200);
    const row = financial.breakdown.find(item => String(item.providerId) === String(provider._id));
    assert.equal(row.bookings, 1); assert.equal(row.grossSales, 29);
    assert.equal(row.seaGoCommission, 5); assert.equal(row.providerNet, 24); assert.equal(row.payableNow, 24);
    await Trip.updateOne({ _id: main.trip._id }, { $set: { pricing: FIXTURE_PRICING } });
    assert.deepEqual((await Booking.findById(mainBooking._id)).pricing.toObject(), mainSnapshot);
  });

  await t.test('customer API issues the correct signed ticket while financial internals remain private', async () => {
    const rows = expectStatus(await api('/api/bookings', { token: customerToken }), 200);
    mainTicket = rows.find(row => String(row._id) === String(mainBooking._id));
    assert.ok(mainTicket);
    assert.equal(mainTicket.tripId._id, String(main.trip._id));
    assert.equal(mainTicket.departureId._id, String(main.departure._id));
    assert.equal(mainTicket.providerId._id, String(provider._id));
    assert.equal(mainTicket.ticketLifecycle.state, 'ready');
    assert.equal(mainTicket.pricing.grossAmount, 29);
    assert.equal('commissionAmount' in mainTicket.pricing, false);
    assert.equal('providerNetAmount' in mainTicket.pricing, false);
    assert.equal('commissionValue' in mainTicket.tripId.pricing, false);
    const paymentDto = expectStatus(await api(`/api/payments/${mainPayment._id}`, { token: customerToken }), 200);
    assert.equal(paymentDto.status, 'paid');
    assert.equal('rawLastEvent' in paymentDto, false); assert.equal('externalPaymentId' in paymentDto, false);
    const [version, bookingId, signature] = mainTicket.ticketToken.split('.');
    assert.equal(version, '2'); assert.equal(bookingId, String(mainBooking._id));
    const expectedSignature = crypto.createHmac('sha256', process.env.TICKET_SIGNING_SECRET).update(`2.${bookingId}`).digest().subarray(0, 12).toString('base64url');
    assert.equal(signature, expectedSignature, 'independent HMAC verification of the API-issued QR');
    const publicLink = new URL(mainTicket.ticketValidationUrl);
    assert.equal(publicLink.origin, base);
    const publicTicket = expectStatus(await api(publicLink.pathname + publicLink.search), 200);
    assert.equal(publicTicket.boardable, true); assert.equal(publicTicket.guests, 2);
  });

  await t.test('provider ownership and active capabilities protect inspection and redemption', async () => {
    for (const user of [owner, manager, staff, scanner]) {
      const info = expectStatus(await ticketRequest('inspect', mainTicket.ticketToken, tokenFor(user)), 200);
      assert.equal(info.valid, true); assert.equal(info.customer.name, 'Phase2B Test Customer');
    }
    for (const token of [otherToken, tokenFor(revoked), tokenFor(unassigned)]) {
      expectStatus(await ticketRequest('inspect', mainTicket.ticketToken, token), 403);
      expectStatus(await ticketRequest('check-in', mainTicket.ticketToken, token), 403);
    }
    expectStatus(await ticketRequest('check-in', mainTicket.ticketToken, customerToken), 403);
    assert.equal((await Booking.findById(mainBooking._id)).checkInCount, 0);
    expectStatus(await ticketRequest('check-in', mainTicket.ticketToken, scanToken), 200);
    const used = await Booking.findById(mainBooking._id);
    assert.ok(used.checkedInAt); assert.equal(used.checkInCount, 1); assert.equal(String(used.checkedInBy), String(scanner._id));
    const repeated = expectStatus(await ticketRequest('check-in', mainTicket.ticketToken, scanToken), 409);
    assert.equal(repeated.code, 'already_checked_in');
    expectStatus(await manualCheckin(mainBooking, ownerToken), 409);
    expectStatus(await ticketRequest('check-in', mainTicket.ticketToken, otherToken), 403);
    const rows = expectStatus(await api('/api/bookings', { token: customerToken }), 200);
    assert.equal(rows.find(row => row._id === String(mainBooking._id)).ticketLifecycle.state, 'checked_in');
    const afterReplay = await Booking.findById(mainBooking._id);
    assert.equal(afterReplay.checkInCount, 1);
    assert.equal(afterReplay.checkedInAt.getTime(), used.checkedInAt.getTime());
    assert.equal(String(afterReplay.checkedInBy), String(used.checkedInBy));
  });

  await t.test('forged and modified QR cannot cross a genuine different trip or departure', async () => {
    const other = await makeTrip(provider, { title: 'Phase2B Test Different Trip' });
    const paid = await payCheckout(other.departure, { children: 0, mealPlan: 'without_buffet' });
    const sameTripDeparture = await Departure.create({ tripId: main.trip._id, startsAt: new Date(Date.now() + 72 * 3600000), capacity: 3, status: 'scheduled' });
    const sameTripPaid = await payCheckout(sameTripDeparture, { children: 0, mealPlan: 'without_buffet' });
    const oldSignature = mainTicket.ticketToken.split('.')[2];
    for (const token of ['not-a-ticket', `${mainTicket.ticketToken}x`, `2.${paid.booking._id}.${oldSignature}`, `2.${sameTripPaid.booking._id}.${oldSignature}`]) {
      expectStatus(await ticketRequest('inspect', token, ownerToken), 400);
      expectStatus(await ticketRequest('check-in', token, ownerToken), 400);
    }
    assert.notEqual(String(paid.booking.tripId), String(mainBooking.tripId));
    assert.notEqual(String(paid.booking.departureId), String(mainBooking.departureId));
    assert.equal((await Booking.findById(paid.booking._id)).checkInCount, 0);
    assert.equal((await Booking.findById(sameTripPaid.booking._id)).checkInCount, 0);
    // The API has no selected-trip/departure scan context. A genuine signed QR
    // identifies its own booking; tampering with that identity must be rejected.
  });

  await t.test('invalid passenger and meal inputs fail without holds, payments or inventory changes', async () => {
    const beforeHolds = await Hold.countDocuments(), beforePayments = await Payment.countDocuments();
    const beforeSeats = (await Departure.findById(main.departure._id)).reservedSeats;
    const invalid = [
      { adults: 0, children: 0 }, { adults: -1 }, { children: -1 }, { adults: 1.5 }, { children: 0.5 },
      { adults: '1' }, { adults: 'one' }, { adults: {} }, { children: [] }, { adults: 501 },
      { adults: 500, children: 1 }, { mealPlan: 'malformed' }, { mealPlan: {} }, { mealPlan: true }
    ];
    for (const body of invalid) expectStatus(await checkout(main.departure, body), 400);
    for (const quantities of [
      { adults: '0', children: '0' }, { adults: '-1' }, { children: '-1' },
      { adults: '1.5' }, { adults: 'one' }, { mealPlan: 'malformed' }
    ]) expectStatus(await quote(main.departure, quantities), 400);
    expectStatus(await quote(main.departure, { adults: '501', children: '0' }), 409);
    assert.equal(await Hold.countDocuments(), beforeHolds);
    assert.equal(await Payment.countDocuments(), beforePayments);
    assert.equal((await Departure.findById(main.departure._id)).reservedSeats, beforeSeats);
  });

  await t.test('disabled buffet, missing selected buffet prices and negative stored prices fail closed', async () => {
    const cases = [
      { name: 'Disabled Buffet', set: { 'pricing.buffetEnabled': false } },
      { name: 'Missing Buffet Adult', unset: { 'pricing.buffetAdultPrice': '' } },
      { name: 'Missing Buffet Child', unset: { 'pricing.buffetChildPrice': '' } },
      { name: 'Negative Buffet Adult', set: { 'pricing.buffetAdultPrice': -1 } },
      { name: 'Negative Buffet Child', set: { 'pricing.buffetChildPrice': -1 } },
      { name: 'Negative Base Adult', set: { 'pricing.adultPrice': -1 }, mealPlan: 'without_buffet' },
      { name: 'Negative Base Child', set: { 'pricing.childPrice': -1 }, mealPlan: 'without_buffet' }
    ];
    for (const scenario of cases) {
      const fixture = await makeTrip(provider, { title: `Phase2B Test ${scenario.name}` });
      await Trip.updateOne({ _id: fixture.trip._id }, { ...(scenario.set ? { $set: scenario.set } : {}), ...(scenario.unset ? { $unset: scenario.unset } : {}) });
      const mealPlan = scenario.mealPlan || 'with_buffet';
      expectStatus(await quote(fixture.departure, { mealPlan }), 500);
      expectStatus(await checkout(fixture.departure, { mealPlan }), 500);
      assert.equal((await Departure.findById(fixture.departure._id)).reservedSeats, 0);
      assert.equal(await Hold.countDocuments({ departureId: fixture.departure._id }), 0);
    }
  });

  await t.test('concurrent last-seat sales cannot oversell and a shared checkout key reserves once', async () => {
    const lastSeat = await makeTrip(provider, { title: 'Phase2B Test Last Seat', capacity: 1 });
    const contenders = await Promise.all([checkout(lastSeat.departure, { children: 0 }), checkout(lastSeat.departure, { children: 0 })]);
    assert.deepEqual(contenders.map(result => result.status).sort(), [201, 409]);
    assert.equal((await Departure.findById(lastSeat.departure._id)).reservedSeats, 1);
    assert.equal(await Hold.countDocuments({ departureId: lastSeat.departure._id }), 1);
    const sameKey = await makeTrip(provider, { title: 'Phase2B Test Shared Key', capacity: 2 });
    const key = crypto.randomUUID();
    const retries = await Promise.all([checkout(sameKey.departure, { children: 0 }, key), checkout(sameKey.departure, { children: 0 }, key)]);
    retries.forEach(result => expectStatus(result, 201));
    assert.equal(retries[0].data.paymentId, retries[1].data.paymentId);
    expectStatus(await checkout(sameKey.departure, { adults: 2, children: 0 }, key), 409);
    assert.equal((await Departure.findById(sameKey.departure._id)).reservedSeats, 1);
    const holds = await Hold.find({ departureId: sameKey.departure._id });
    assert.equal(holds.length, 1);
    assert.equal(await Payment.countDocuments({ holdId: holds[0]._id }), 1);
  });

  await t.test('expired owned hold releases once and a late paid event cannot create a booking', async () => {
    const fixture = await makeTrip(provider, { title: 'Phase2B Test Expired Hold', capacity: 2 });
    const key = crypto.randomUUID();
    const created = expectStatus(await checkout(fixture.departure, {}, key), 201);
    const payment = await Payment.findById(created.paymentId);
    await Hold.updateOne({ _id: payment.holdId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal(expectStatus(await quote(fixture.departure), 200).availableSeats, 2);
      assert.equal((await Departure.findById(fixture.departure._id)).reservedSeats, 0);
    }
    assert.equal((await Hold.findById(payment.holdId)).status, 'expired');
    assert.equal((await Payment.findById(payment._id)).status, 'expired');
    expectStatus(await checkout(fixture.departure, {}, key), 409);
    expectStatus(await webhook(payment), 200);
    assert.equal((await Payment.findById(payment._id)).status, 'needs_review');
    assert.equal(await Booking.countDocuments({ departureId: fixture.departure._id }), 0);
    assert.equal((await Departure.findById(fixture.departure._id)).reservedSeats, 0);
  });

  await t.test('unknown, cross-correlated and money-mismatched payment events never confirm bookings', async () => {
    expectStatus(await webhook({ _id: new mongoose.Types.ObjectId(), externalPaymentId: 'mock_phase2b_unknown', amount: 29, currency: 'JOD' }), 404);
    const a = await makeTrip(provider, { title: 'Phase2B Test Correlation A' });
    const b = await makeTrip(provider, { title: 'Phase2B Test Correlation B' });
    const pa = await Payment.findById(expectStatus(await checkout(a.departure), 201).paymentId);
    const pb = await Payment.findById(expectStatus(await checkout(b.departure), 201).paymentId);
    expectStatus(await webhook(pa, { externalPaymentId: pb.externalPaymentId }), 200);
    assert.equal((await Payment.findById(pa._id)).status, 'needs_review');
    assert.equal((await Payment.findById(pb._id)).status, 'pending');
    assert.equal(await Booking.countDocuments({ departureId: { $in: [a.departure._id, b.departure._id] } }), 0);
    for (const override of [{ amount: 0.01 }, { currency: 'USD' }, { paymentReference: String(new mongoose.Types.ObjectId()) }]) {
      const fixture = await makeTrip(provider, { title: 'Phase2B Test Invalid Payment Intent' });
      const payment = await Payment.findById(expectStatus(await checkout(fixture.departure), 201).paymentId);
      expectStatus(await webhook(payment, override), 200);
      assert.equal((await Payment.findById(payment._id)).status, 'needs_review');
      assert.equal(await Booking.countDocuments({ departureId: fixture.departure._id }), 0);
    }
    assert.equal((await Booking.findById(mainBooking._id)).status, 'confirmed');
    assert.deepEqual((await Booking.findById(mainBooking._id)).pricing.toObject(), mainSnapshot);
  });

  await t.test('API cancellation refunds once, releases seats once and blocks boarding and late-paid resurrection', async () => {
    const fixture = await makeTrip(provider, { title: 'Phase2B Test Refund', capacity: 2, hours: 48 });
    const paid = await payCheckout(fixture.departure);
    const request = () => api(`/api/bookings/${paid.booking._id}/cancel`, { method: 'POST', token: customerToken, body: { reason: 'Phase2B synthetic cancellation' } });
    for (let attempt = 0; attempt < 2; attempt++) {
      const cancelled = expectStatus(await request(), 200);
      assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.refundAmount, 29); assert.equal(cancelled.refundPercentage, 100);
      assert.equal(cancelled.refundStatus, 'processed');
      assert.equal((await Departure.findById(fixture.departure._id)).reservedSeats, 0);
    }
    assert.equal(await Refund.countDocuments({ paymentId: paid.payment._id }), 1);
    const refund = await Refund.findOne({ paymentId: paid.payment._id });
    assert.equal(refund.state, 'succeeded'); assert.equal(refund.amount, 29);
    assert.equal((await Payment.findById(paid.payment._id)).refundedAmount, 29);
    expectStatus(await ticketRequest('check-in', paid.ticket.ticketToken, ownerToken), 409);
    expectStatus(await manualCheckin(paid.booking, ownerToken), 409);
    expectStatus(await webhook(paid.payment), 200);
    assert.equal((await Payment.findById(paid.payment._id)).status, 'refunded');
    assert.equal((await Booking.findById(paid.booking._id)).status, 'cancelled');
    assert.equal(await Refund.countDocuments({ paymentId: paid.payment._id }), 1);
    assert.equal((await Departure.findById(fixture.departure._id)).reservedSeats, 0);
  });

  await t.test('paid ticket past its planned operational end is rejected without check-in mutation', async () => {
    const fixture = await makeTrip(provider, { title: 'Phase2B Test Expired Ticket' });
    const paid = await payCheckout(fixture.departure, { children: 0 });
    await Departure.updateOne({ _id: fixture.departure._id }, { $set: { startsAt: new Date(Date.now() - 3 * 3600000) } });
    assert.equal(expectStatus(await ticketRequest('check-in', paid.ticket.ticketToken, ownerToken), 409).code, 'departure_expired');
    expectStatus(await manualCheckin(paid.booking, ownerToken), 409);
    assert.equal((await Booking.findById(paid.booking._id)).checkInCount, 0);
  });

  await t.test('synthetic suspension/ineligibility blocks sales and check-in and reviews late payment', async () => {
    const suspendedOwner = await User.create({ name: 'Phase2B Test Suspension Owner', role: 'provider' });
    const suspendedProvider = await Provider.create({ ownerUserId: suspendedOwner._id, businessName: 'Phase2B Test Aladdin Suspension Fixture', status: 'approved' });
    const fixture = await makeTrip(suspendedProvider, { title: 'Phase2B Test Suspension Trip', capacity: 5 });
    const suspendedToken = tokenFor(suspendedOwner);
    expectStatus(await quote(fixture.departure), 200);
    const paid = await payCheckout(fixture.departure, { children: 0 });
    expectStatus(await ticketRequest('inspect', paid.ticket.ticketToken, suspendedToken), 200);
    const pending = await Payment.findById(expectStatus(await checkout(fixture.departure, { children: 0 }), 201).paymentId);
    for (const status of ['suspended', 'pending', 'rejected']) {
      await Provider.updateOne({ _id: suspendedProvider._id }, { $set: { status } });
      expectStatus(await quote(fixture.departure), 404);
      expectStatus(await checkout(fixture.departure, { children: 0 }), 409);
      expectStatus(await ticketRequest('inspect', paid.ticket.ticketToken, suspendedToken), 403);
      expectStatus(await ticketRequest('check-in', paid.ticket.ticketToken, suspendedToken), 403);
      expectStatus(await manualCheckin(paid.booking, suspendedToken), 403);
      if (status === 'suspended') {
        expectStatus(await webhook(pending), 200);
        assert.equal((await Payment.findById(pending._id)).status, 'needs_review');
        assert.equal((await Hold.findById(pending.holdId)).status, 'released');
        assert.equal((await Departure.findById(fixture.departure._id)).reservedSeats, 1);
      }
    }
    assert.equal(await Booking.countDocuments({ providerId: suspendedProvider._id }), 1);
    assert.equal((await Booking.findById(paid.booking._id)).checkInCount, 0);
    assert.equal((await Departure.findById(fixture.departure._id)).reservedSeats, 1);
  });

  await t.test('safety boundary remains local with mock payments and no configured external delivery', async () => {
    assert.deepEqual(attemptedExternal, []);
    assert.equal(process.env.PAYMENT_PROVIDER, 'mock'); assert.equal(process.env.PUBLIC_LAUNCH, 'false');
    assert.equal(process.env.FCM_ENABLED, 'false');
    for (const key of ['RESEND_API_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) assert.equal(process.env[key], undefined);
    assert.equal(await Payment.countDocuments({ provider: { $ne: 'mock' } }), 0);
    assert.equal(await NotificationLog.countDocuments({ status: 'sent' }), 0);
    assert.equal(await Departure.countDocuments({ reservedSeats: { $lt: 0 } }), 0);
    assert.equal(await Departure.countDocuments({ $expr: { $gt: ['$reservedSeats', '$capacity'] } }), 0);
  });
});
