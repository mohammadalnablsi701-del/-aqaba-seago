import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createMockProvider } from "../src/payments/providers/mock.js";

test("mock provider verifies a valid webhook signature", () => {
  process.env.MOCK_PAYMENT_WEBHOOK_SECRET = "test-secret";
  const provider = createMockProvider();
  const body = Buffer.from(JSON.stringify({
    eventId: "evt_1",
    paymentReference: "507f1f77bcf86cd799439011",
    externalPaymentId: "mock_123",
    status: "paid",
    amount: 20,
    currency: "JOD"
  }));

  const signature = crypto
    .createHmac("sha256", "test-secret")
    .update(body)
    .digest("hex");

  assert.doesNotThrow(() => provider.verifyWebhook({ rawBody: body, signature }));
});

test("mock provider rejects an invalid webhook signature", () => {
  process.env.MOCK_PAYMENT_WEBHOOK_SECRET = "test-secret";
  const provider = createMockProvider();
  const body = Buffer.from("{}");

  assert.throws(() =>
    provider.verifyWebhook({ rawBody: body, signature: "bad-signature" })
  );
});

test("mock provider normalizes webhook payload with SeaGo reference", () => {
  const provider = createMockProvider();
  const body = Buffer.from(JSON.stringify({
    eventId: "evt_2",
    paymentReference: "507f1f77bcf86cd799439012",
    externalPaymentId: "mock_456",
    status: "paid",
    amount: "17.5",
    currency: "JOD"
  }));

  assert.deepEqual(provider.parseWebhook(body), {
    eventId: "evt_2",
    paymentReference: "507f1f77bcf86cd799439012",
    externalPaymentId: "mock_456",
    status: "paid",
    amount: 17.5,
    currency: "JOD",
    raw: {
      eventId: "evt_2",
      paymentReference: "507f1f77bcf86cd799439012",
      externalPaymentId: "mock_456",
      status: "paid",
      amount: "17.5",
      currency: "JOD"
    }
  });
});

test("mock provider keeps legacy webhook parsing compatible when reference is absent", () => {
  const provider = createMockProvider();
  const body = Buffer.from(JSON.stringify({
    eventId: "evt_legacy",
    externalPaymentId: "legacy_external",
    status: "pending",
    amount: 9,
    currency: "JOD"
  }));
  assert.equal(provider.parseWebhook(body).paymentReference, null);
});

test("mock checkout creation is idempotent by SeaGo reference and provider idempotency key", async () => {
  const provider = createMockProvider();
  const request = {
    paymentReference: "507f1f77bcf86cd799439013",
    providerIdempotencyKey: "checkout:507f1f77bcf86cd799439013",
    amount: 20,
    currency: "JOD",
    baseUrl: "https://example.test"
  };

  const first = await provider.createCheckout(request);
  const second = await provider.createCheckout(request);
  const recovered = await provider.findCheckoutByReference({ paymentReference: request.paymentReference });

  assert.deepEqual(second, first);
  assert.deepEqual(recovered, first);
  assert.equal(first.paymentReference, request.paymentReference);
  assert.equal(first.externalPaymentId, `mock_${request.paymentReference}`);
});

test("mock provider rejects idempotency/reference reuse for a different intent", async () => {
  const provider = createMockProvider();
  const paymentReference = "507f1f77bcf86cd799439014";
  const providerIdempotencyKey = `checkout:${paymentReference}`;
  await provider.createCheckout({
    paymentReference,
    providerIdempotencyKey,
    amount: 20,
    currency: "JOD",
    baseUrl: "https://example.test"
  });

  await assert.rejects(
    provider.createCheckout({
      paymentReference,
      providerIdempotencyKey,
      amount: 21,
      currency: "JOD",
      baseUrl: "https://example.test"
    }),
    /different payment intent/
  );
});
