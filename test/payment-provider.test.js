import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createMockProvider } from "../src/payments/providers/mock.js";

test("mock provider verifies a valid webhook signature", () => {
  process.env.MOCK_PAYMENT_WEBHOOK_SECRET = "test-secret";
  const provider = createMockProvider();
  const body = Buffer.from(JSON.stringify({
    eventId: "evt_1",
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

test("mock provider normalizes webhook payload", () => {
  const provider = createMockProvider();
  const body = Buffer.from(JSON.stringify({
    eventId: "evt_2",
    externalPaymentId: "mock_456",
    status: "paid",
    amount: "17.5",
    currency: "JOD"
  }));

  assert.deepEqual(provider.parseWebhook(body), {
    eventId: "evt_2",
    externalPaymentId: "mock_456",
    status: "paid",
    amount: 17.5,
    currency: "JOD",
    raw: {
      eventId: "evt_2",
      externalPaymentId: "mock_456",
      status: "paid",
      amount: "17.5",
      currency: "JOD"
    }
  });
});
