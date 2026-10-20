import { requireFixture, connectFixture, cleanupFixtures } from '../scripts/test-safety/fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import express from 'express';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { chromium } from 'playwright-core';
import User from '../src/models/User.js';
import Provider from '../src/models/Provider.js';
import Trip from '../src/models/Trip.js';
import Departure from '../src/models/Departure.js';
import Hold from '../src/models/CheckoutHold.js';
import Payment from '../src/models/Payment.js';
import PaymentEvent from '../src/models/PaymentEvent.js';
import Booking from '../src/models/Booking.js';
import { installSyntheticCamera, setCameraQr } from './support/browser-camera.mjs';

requireFixture();
test.after(cleanupFixtures);

test('Phase2C isolated Customer and Provider browser/check-in acceptance', { timeout: 110000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const artifacts = root + 'node_modules/.cache/phase2c-browser/';
  for (const app of ['customer', 'provider']) assert.ok(existsSync(artifacts + app + '/index.html'),
    'Run npm run test:browser:build on Node22 before browser/database acceptance');
  const executablePath = ['/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome']
    .find(path => existsSync(path));
  assert.ok(executablePath, 'System Chromium/Chrome is required; browser acceptance never skips');
  await connectFixture();
  await Promise.all([User, Provider, Trip, Departure, Hold, Payment, PaymentEvent, Booking].map(model => model.init()));
  Object.assign(process.env, {
    JWT_SECRET: crypto.randomBytes(48).toString('base64url'),
    TICKET_SIGNING_SECRET: crypto.randomBytes(48).toString('base64url'),
    MOCK_PAYMENT_WEBHOOK_SECRET: crypto.randomBytes(48).toString('base64url'),
    PAYMENT_PROVIDER: 'mock', ENABLE_MOCK_CHECKOUT: 'true', FCM_ENABLED: 'false',
    PUBLIC_LAUNCH: 'false', API_RATE_LIMIT: '3000', AUTH_RATE_LIMIT: '100'
  });
  for (const key of ['RESEND_API_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'GOOGLE_CLIENT_ID']) delete process.env[key];
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const apiBase = origin + '/__local_api';
  process.env.PUBLIC_BASE_URL = apiBase;
  process.env.FRONTEND_BASE_URL = origin + '/customer';
  const originalFetch = globalThis.fetch;
  const outbound = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== origin || url.username || url.password) {
      outbound.push(url.origin); throw new Error('Nonlocal backend HTTP forbidden by browser harness');
    }
    return originalFetch(input, { ...options, redirect: 'error' });
  };
  const { createApp } = await import('../src/app.js');
  const local = express();
  local.use('/__local_api', createApp());
  local.use('/customer', express.static(artifacts + 'customer'));
  local.use('/provider', express.static(artifacts + 'provider'));
  // The existing hero references this public asset at a historic absolute path.
  local.get('/-aqaba-seago/aqaba-hero.jpg', (_req, res) => res.sendFile(artifacts + 'customer/aqaba-hero.jpg'));
  server.on('request', local);

  const password = crypto.randomBytes(20).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 12);
  const [customer, owner, otherOwner] = await User.create([
    { name: 'Phase2C Test Customer', email: 'phase2c-customer@example.invalid', phone: '+962790002301', role: 'customer', passwordHash },
    { name: 'Phase2C Test Owner', email: 'phase2c-owner@example.invalid', phone: '+962790002302', role: 'provider', passwordHash },
    { name: 'Phase2C Test Other Owner', email: 'phase2c-other@example.invalid', role: 'provider', passwordHash }
  ]);
  const provider = await Provider.create({ ownerUserId: owner._id, businessName: 'Phase2C Test Company', status: 'approved',
    settings: { configured: true, defaultCapacity: 10, defaultDepartureTime: '12:00' } });
  await Provider.create({ ownerUserId: otherOwner._id, businessName: 'Phase2C Test Other Company', status: 'approved' });
  const trip = await Trip.create({ providerId: provider._id, titleAr: 'رحلة اختبار المتصفح',
    titleEn: 'Phase2C Test Browser Cruise', vesselName: 'Phase2C Synthetic Vessel', category: 'sunset', durationMinutes: 120,
    active: true, platformStatus: 'allowed', departureLocation: { name: 'Phase2C Synthetic Pier',
      address: 'Synthetic test location', googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Phase2C+Synthetic+Pier' },
    pricing: { currency: 'JOD', pricePerPerson: 15, adultPrice: 15, childPrice: 10,
      buffetEnabled: true, buffetAdultPrice: 17, buffetChildPrice: 12,
      commissionType: 'fixed_per_person', commissionValue: 3, adultCommission: 3, childCommission: 2,
      buffetAdultCommission: 3, buffetChildCommission: 2 } });
  const departure = await Departure.create({ tripId: trip._id, startsAt: new Date(Date.now() + 72 * 3600000),
    capacity: 10, reservedSeats: 0, status: 'scheduled' });
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update'] });
  const contexts = [];
  const pageErrors = [];
  const blockedDecorative = [];
  t.after(async () => {
    try {
      await Promise.all(contexts.map(context => context.close()));
      await browser.close();
      await new Promise(resolve => server.close(resolve));
      if (outbound.length) console.error('error: blocked unexpected origins ' + JSON.stringify([...new Set(outbound)]));
      assert.deepEqual(outbound, [], 'no external business HTTP was attempted');
    } finally { globalThis.fetch = originalFetch; }
  });
  async function pageFor({ camera = false } = {}) {
    const context = await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' });
    contexts.push(context);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      if (['fonts.googleapis.com', 'fonts.gstatic.com', 'commons.wikimedia.org'].includes(url.hostname)) {
        blockedDecorative.push(url.hostname);
      } else outbound.push(url.origin);
      return route.abort('blockedbyclient');
    });
    if (camera) await installSyntheticCamera(context);
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.on('pageerror', error => pageErrors.push(error.message));
    return page;
  }
  async function signIn(page, app, email) {
    await page.goto(origin + '/' + app + '/' + (app === 'customer' ? '?open=tickets' : ''));
    await page.getByPlaceholder('Email', { exact: true }).fill(email);
    await page.getByPlaceholder('Password (8+ characters)', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  const customerPage = await pageFor();
  const providerPage = await pageFor({ camera: true });
  let ticketSvg, booking, payment;
  const screenshots = root + 'coverage/phase2c/';
  await mkdir(screenshots, { recursive: true });
  async function scenario(name, run) {
    return t.test(name, async () => {
      try { await run(); }
      catch (error) {
        console.error('error: browser scenario ' + name + ': ' + String(error.message).replace(/\s+/g, ' ').slice(0, 1200));
        const decoder = await providerPage.evaluate(() => {
          const video = document.querySelector('#reader video');
          const canvas = document.querySelector('#reader canvas');
          return { video: video && { width: video.videoWidth, height: video.videoHeight, clientWidth: video.clientWidth, clientHeight: video.clientHeight, paused: video.paused, readyState: video.readyState },
            canvas: canvas && { width: canvas.width, height: canvas.height, data: canvas.toDataURL() } };
        }).catch(() => null);
        if (decoder?.canvas) {
          await writeFile(screenshots + 'decoder-crop.png', Buffer.from(decoder.canvas.data.split(',')[1], 'base64'));
          delete decoder.canvas.data;
          console.error('error: decoder diagnostics ' + JSON.stringify(decoder));
        }
        await customerPage.screenshot({ path: screenshots + 'customer-failure.png', fullPage: true }).catch(() => {});
        await providerPage.screenshot({ path: screenshots + 'provider-' + name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60) + '.png', fullPage: true }).catch(() => {});
        throw error;
      }
    });
  }
  t.after(async () => {
    if (!customerPage.isClosed()) await customerPage.screenshot({ path: screenshots + 'customer-final.png', fullPage: true }).catch(() => {});
    if (!providerPage.isClosed()) await providerPage.screenshot({ path: screenshots + 'provider-final.png', fullPage: true }).catch(() => {});
  });

  await scenario('Customer login, synthetic catalog, future departure, quantities and authoritative buffet quote', async () => {
    await signIn(customerPage, 'customer', customer.email);
    await customerPage.locator('.ticket-empty').waitFor();
    await customerPage.evaluate(() => sessionStorage.removeItem('seago_active_screen'));
    await customerPage.goto(origin + '/customer/');
    await customerPage.locator('.trip-card').filter({ hasText: trip.titleEn }).click();
    await customerPage.locator('.detail-departure-option').first().waitFor();
    await customerPage.getByRole('button', { name: /Continue with selected time/ }).click();
    await customerPage.locator('.departure-option.active').waitFor();
    const adults = customerPage.locator('.booking-form--guests > label').nth(0);
    const children = customerPage.locator('.booking-form--guests > label').nth(1);
    await adults.locator('.stepper button').nth(0).click();
    await adults.locator('.stepper button').nth(0).click();
    await customerPage.waitForFunction(() => document.querySelector('.booking-confirm')?.disabled === true);
    assert.equal(await adults.locator('.stepper b').textContent(), '0');
    assert.equal(await Hold.countDocuments(), 0);
    await adults.locator('.stepper button').nth(1).click();
    await children.locator('.stepper button').nth(1).click();
    await customerPage.waitForFunction(() => document.querySelector('.price-box__total strong')?.textContent.includes('25.00'));
    await customerPage.getByRole('button', { name: /Add open buffet/ }).click();
    await customerPage.waitForFunction(() => document.querySelector('.price-box__total strong')?.textContent.includes('29.00'));
    const family = customerPage.getByRole('radio', { name: 'Family', exact: true });
    const couple = customerPage.getByRole('radio', { name: 'Couple', exact: true });
    const acknowledgement = customerPage.getByRole('checkbox', { name: 'I confirm that this booking is for a family or couple and complies with the trip policy.', exact: true });
    const checkout = customerPage.locator('.booking-confirm');
    assert.equal(await family.isChecked(), false);
    assert.equal(await couple.isChecked(), false);
    assert.equal(await checkout.isDisabled(), true);
    await family.check();
    assert.equal(await checkout.isDisabled(), true, 'booking type alone cannot continue to payment');
    await acknowledgement.check();
    assert.equal(await checkout.isDisabled(), false);
    await acknowledgement.uncheck();
    assert.equal(await checkout.isDisabled(), true, 'withdrawing confirmation blocks payment again');
    await couple.check();
    assert.equal(await checkout.isDisabled(), true);
    await acknowledgement.check();
    assert.equal(await checkout.isDisabled(), false, 'Couple and explicit confirmation permit checkout');
    await family.check();
    assert.equal(await checkout.isDisabled(), false, 'Family and explicit confirmation permit checkout');
    assert.match(await customerPage.locator('.price-box__total strong').textContent(), /29\.00/);
    assert.equal(await Hold.countDocuments(), 0);
    const manipulated = await customerPage.evaluate(async departureId => {
      const auth = JSON.parse(localStorage.getItem('seago_auth'));
      const response = await fetch('/__local_api/api/payments/checkout', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token, 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ departureId, adults: 1, children: 1, mealPlan: 'with_buffet', partyType: 'family', partyPolicyConfirmed: true, total: 0.01, commissionAmount: 0 }) });
      return response.status;
    }, String(departure._id));
    assert.equal(manipulated, 400);
    await customerPage.locator('.price-box__total strong').evaluate(element => { element.textContent = '0.01 JOD'; });
    await customerPage.locator('.booking-confirm').click();
    await customerPage.getByRole('heading', { name: 'Test payment ready' }).waitFor();
    assert.match(await customerPage.locator('.payment-review-card').innerText(), /29\.00/);
    assert.equal(await Booking.countDocuments(), 0);
    payment = await Payment.findOne({ customerId: customer._id });
    assert.equal(payment.status, 'pending'); assert.equal(payment.amount, 29);
    const hold = await Hold.findById(payment.holdId);
    assert.equal(hold.partyType, 'family');
    assert.equal(hold.partyPolicyConfirmed, true);
    assert.equal(hold.seats, 2);
    assert.equal((await Departure.findById(departure._id)).reservedSeats, 2);
  });

  await scenario('Real mock checkout UI confirms payment, exposes correct company, ticket, maps and QR', async () => {
    assert.ok(payment, 'Customer checkout prerequisite');
    await customerPage.locator('.payment-main-cta').click();
    await customerPage.getByRole('heading', { name: 'Complete payment' }).waitFor();
    assert.equal(await Booking.countDocuments(), 0);
    await customerPage.getByRole('button', { name: 'Pay now', exact: true }).click();
    await customerPage.getByText('BOOKING CONFIRMED', { exact: true }).waitFor();
    await customerPage.getByRole('button', { name: /Open my ticket/ }).click();
    await customerPage.locator('.ticket-qr svg').waitFor();
    assert.equal(await customerPage.locator('.ticket-provider strong').textContent(), provider.businessName);
    assert.match(await customerPage.locator('.ticket-card__details').innerText(), /29\.00 JOD/);
    assert.match(await customerPage.locator('.ticket-map-button').getAttribute('href'), /Phase2C\+Synthetic\+Pier/);
    ticketSvg = await customerPage.locator('.ticket-qr svg').evaluate(element => element.outerHTML);
    await writeFile(screenshots + 'synthetic-ticket.svg', ticketSvg);
    booking = await Booking.findOne({ customerId: customer._id });
    assert.equal(booking.status, 'confirmed');
    assert.equal(booking.partyType, 'family');
    assert.deepEqual([booking.adults, booking.children, booking.pricing.grossAmount,
      booking.pricing.commissionAmount, booking.pricing.providerNetAmount], [1, 1, 29, 5, 24]);
    await customerPage.screenshot({ path: screenshots + 'customer-ticket.png', fullPage: true });
  });

  await scenario('Provider login, departure context, booking lookup and manual check-in cancel are usable', async () => {
    assert.ok(booking, 'Paid booking prerequisite');
    await signIn(providerPage, 'provider', owner.email);
    await providerPage.locator('nav button.scan').waitFor();
    await providerPage.locator('nav').getByRole('button', { name: 'Bookings', exact: true }).click();
    await providerPage.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await providerPage.getByPlaceholder('Search guest or booking').fill(customer.name);
    await providerPage.locator('.booking-card-main').click();
    await providerPage.locator('.booking-detail-sheet').waitFor();
    assert.match(await providerPage.locator('.booking-detail-sheet').innerText(), /Phase2C Test Browser Cruise/);
    assert.equal(await providerPage.locator('.booking-detail-grid > div').filter({ hasText: 'Booking type' }).locator('b').textContent(), 'Family');
    providerPage.once('dialog', dialog => dialog.dismiss());
    await providerPage.getByRole('button', { name: 'Check in manually', exact: true }).click();
    assert.equal((await Booking.findById(booking._id)).checkInCount, 0);
    await providerPage.locator('.booking-detail-sheet .manage-form-head button').click();
  });

  await scenario('Mocked camera uses environment preference, supports torch controls and closes without blank UI', async () => {
    await setCameraQr(providerPage, null);
    await providerPage.locator('nav button.scan').click();
    await providerPage.getByLabel('Toggle flash').waitFor();
    await providerPage.getByLabel('Toggle flash').click();
    assert.equal(await providerPage.evaluate(() => window.__phase2cCamera.torchRequests.includes(true)), true);
    await providerPage.getByLabel('Close scanner').click();
    await providerPage.locator('nav button.scan').waitFor();
    const media = await providerPage.evaluate(() => ({ calls: window.__phase2cCamera.calls,
      live: window.__phase2cCamera.tracks.filter(track => track.readyState === 'live').length,
      torch: window.__phase2cCamera.torchRequests }));
    assert.equal(media.calls[0].video.facingMode.exact, 'environment');
    assert.equal(media.live, 0); assert.equal(media.torch.at(-1), false);
    assert.equal((await Booking.findById(booking._id)).checkInCount, 0);
  });

  await scenario('Actual QR decoder inspects, preview-cancels, redeems once, rejects duplicate and updates Customer used state', async () => {
    assert.ok(ticketSvg, 'Customer-rendered QR prerequisite');
    await setCameraQr(providerPage, ticketSvg);
    await providerPage.locator('nav button.scan').click();
    await providerPage.locator('.ticket-preview').waitFor();
    assert.match(await providerPage.locator('.ticket-preview').innerText(), /VALID TICKET/);
    assert.match(await providerPage.locator('.ticket-preview').innerText(), /Phase2C Test Browser Cruise/);
    await providerPage.locator('.secondary-scan').click();
    await providerPage.locator('.ticket-preview').waitFor();
    assert.equal((await Booking.findById(booking._id)).checkInCount, 0);
    await providerPage.locator('.confirm-checkin').click();
    await providerPage.locator('.scan-result.ok').waitFor();
    assert.equal((await Booking.findById(booking._id)).checkInCount, 1);
    await providerPage.screenshot({ path: screenshots + 'provider-checked-in.png', fullPage: true });
    await providerPage.locator('.scan-result.ok button').click();
    await providerPage.locator('.ticket-preview').waitFor();
    assert.match(await providerPage.locator('.ticket-preview').innerText(), /ALREADY USED/);
    assert.equal(await providerPage.locator('.confirm-checkin').isDisabled(), true);
    await providerPage.getByLabel('Close scanner').click();
    await providerPage.locator('nav button.scan').waitFor();
    await customerPage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await customerPage.locator('.ticket-used-banner').waitFor();
    assert.equal(await customerPage.locator('.ticket-qr svg').count(), 0);
    assert.match(await customerPage.locator('.ticket-used-stamp').innerText(), /USED/);
  });

  await scenario('Wrong-provider and forged signed QR are visibly rejected through the real decoder and API', async () => {
    assert.ok(ticketSvg);
    const wrongPage = await pageFor({ camera: true });
    await signIn(wrongPage, 'provider', otherOwner.email);
    await wrongPage.locator('nav button.scan').waitFor();
    await setCameraQr(wrongPage, ticketSvg);
    await wrongPage.locator('nav button.scan').click();
    await wrongPage.locator('.scan-result.bad').waitFor();
    assert.match(await wrongPage.locator('.scan-result.bad').innerText(), /another provider/);
    await wrongPage.getByLabel('Close scanner').click();
    await setCameraQr(providerPage, await QRCode.toString('SG2:2.' + booking._id + '.forged', { type: 'svg', margin: 4 }));
    await providerPage.locator('nav button.scan').click();
    await providerPage.locator('.scan-result.bad').waitFor();
    assert.match(await providerPage.locator('.scan-result.bad').innerText(), /Invalid ticket signature/);
    await providerPage.getByLabel('Close scanner').click();
    await providerPage.locator('nav button.scan').waitFor();
    assert.equal((await Booking.findById(booking._id)).checkInCount, 1);
  });

  await scenario('Environment fallback starts and close during pending permission stops late streams', async () => {
    if (await providerPage.locator('.scanner-screen').isVisible()) await providerPage.getByLabel('Close scanner').click();
    await setCameraQr(providerPage, null);
    await providerPage.evaluate(() => { window.__phase2cCamera.failExact = true; });
    const before = await providerPage.evaluate(() => window.__phase2cCamera.calls.length);
    await providerPage.locator('nav button.scan').click();
    await providerPage.getByLabel('Toggle flash').waitFor();
    const calls = await providerPage.evaluate(start => window.__phase2cCamera.calls.slice(start), before);
    assert.equal(calls[0].video.facingMode.exact, 'environment');
    assert.equal(calls[1].video.facingMode, 'environment');
    await providerPage.getByLabel('Close scanner').click();
    await providerPage.locator('nav button.scan').waitFor();
    await providerPage.evaluate(() => { window.__phase2cCamera.delayed = true; });
    const pendingBefore = await providerPage.evaluate(() => window.__phase2cCamera.calls.length);
    await providerPage.locator('nav button.scan').click();
    await providerPage.waitForFunction(start => window.__phase2cCamera.calls.length > start, pendingBefore);
    await providerPage.getByLabel('Close scanner').click();
    await providerPage.locator('nav button.scan').waitFor();
    const tracksBeforeRelease = await providerPage.evaluate(() => window.__phase2cCamera.tracks.length);
    await providerPage.evaluate(() => window.__phase2cCamera.release());
    await providerPage.waitForFunction(before => window.__phase2cCamera.tracks.length > before, tracksBeforeRelease, { timeout: 2500 });
    await providerPage.waitForFunction(() => window.__phase2cCamera.tracks.every(track => track.readyState === 'ended'), null, { timeout: 2500 });
    assert.ok(await providerPage.locator('.app').isVisible());
    assert.equal((await Booking.findById(booking._id)).checkInCount, 1);
  });

  await scenario('Closing and reopening before old camera permission resolves preserves the new scanner', async () => {
    await providerPage.evaluate(() => { window.__phase2cCamera.delayed = true; });
    const before = await providerPage.evaluate(() => window.__phase2cCamera.calls.length);
    await providerPage.locator('nav button.scan').click();
    await providerPage.waitForFunction(start => window.__phase2cCamera.calls.length > start, before);
    await providerPage.getByLabel('Close scanner').click();
    await providerPage.locator('nav button.scan').waitFor();
    // Permit new requests without resolving the retired instance's request yet.
    await providerPage.evaluate(() => { window.__phase2cCamera.delayed = false; });
    const newTrack = await providerPage.evaluate(() => window.__phase2cCamera.tracks.length);
    await providerPage.locator('nav button.scan').click();
    await providerPage.getByLabel('Toggle flash').waitFor();
    await providerPage.evaluate(() => window.__phase2cCamera.release());
    await providerPage.waitForFunction(index => {
      const tracks = window.__phase2cCamera.tracks;
      return tracks.length > index + 1 && tracks[index].readyState === 'live'
        && tracks.slice(index + 1).every(track => track.readyState === 'ended');
    }, newTrack, { timeout: 2500 });
    assert.equal(await providerPage.locator('.scanner-screen').isVisible(), true);
    await providerPage.getByLabel('Toggle flash').click();
    await providerPage.getByLabel('Close scanner').click();
    await providerPage.locator('nav button.scan').waitFor();
    await providerPage.waitForFunction(() => window.__phase2cCamera.tracks.every(track => track.readyState === 'ended'));
    assert.equal(await providerPage.locator('body > [id^="seago-reader-"]').count(), 0);
  });

  await scenario('Late ticket inspection cannot overwrite a reopened scanner or redeem a ticket', async () => {
    await setCameraQr(providerPage, ticketSvg);
    let release;
    let arrived;
    const gate = new Promise(resolve => { release = resolve; });
    const requestArrived = new Promise(resolve => { arrived = resolve; });
    const pattern = '**/__local_api/api/tickets/inspect';
    const handler = async route => { arrived(); await gate; await route.continue(); };
    await providerPage.route(pattern, handler);
    try {
      await providerPage.locator('nav button.scan').click();
      await requestArrived;
      await providerPage.getByLabel('Close scanner').click();
      await providerPage.locator('nav button.scan').waitFor();
      await setCameraQr(providerPage, null);
      await providerPage.locator('nav button.scan').click();
      await providerPage.getByLabel('Toggle flash').waitFor();
      const completed = providerPage.waitForResponse(response => response.url() === apiBase + '/api/tickets/inspect');
      release();
      await completed;
      // Drain fetch and React continuations before asserting the retired result.
      await providerPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await providerPage.locator('.ticket-preview, .scan-result').count(), 0);
      await providerPage.getByLabel('Close scanner').click();
      await providerPage.locator('nav button.scan').waitFor();
      assert.equal((await Booking.findById(booking._id)).checkInCount, 1);
    } finally {
      release();
      await providerPage.unroute(pattern, handler);
    }
  });

  await scenario('No blank-screen exceptions, external business delivery, or live-data access occurred', async () => {
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(outbound, []);
    assert.equal(await Payment.countDocuments({ provider: { $ne: 'mock' } }), 0);
    assert.equal(process.env.FCM_ENABLED, 'false');
    assert.ok(blockedDecorative.every(host => ['fonts.googleapis.com', 'fonts.gstatic.com', 'commons.wikimedia.org'].includes(host)));
  });
});
