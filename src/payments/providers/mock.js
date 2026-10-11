import crypto from "node:crypto";

const checkoutByReference = new Map();
const checkoutByIdempotencyKey = new Map();
const refundByReference = new Map();
const refundByIdempotencyKey = new Map();

function required(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function sameMoney(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.001;
}

function assertSameCheckoutIntent(existing, request) {
  if (existing.paymentReference !== request.paymentReference ||
      existing.providerIdempotencyKey !== request.providerIdempotencyKey ||
      !sameMoney(existing.amount, request.amount) ||
      existing.currency !== request.currency) {
    throw new Error("Mock checkout idempotency key/reference reused for a different payment intent");
  }
}

function assertSameRefundIntent(existing, request) {
  if (existing.refundReference !== request.refundReference ||
      existing.providerIdempotencyKey !== request.providerIdempotencyKey ||
      existing.externalPaymentId !== request.externalPaymentId ||
      !sameMoney(existing.amount, request.amount) ||
      existing.currency !== request.currency) {
    throw new Error("Mock refund idempotency key/reference reused for a different refund intent");
  }
}

export function createMockProvider() {
  return {
    name: "mock",

    async createCheckout({ paymentReference, providerIdempotencyKey, amount, currency, baseUrl }) {
      const request = {
        paymentReference: required(paymentReference, "paymentReference"),
        providerIdempotencyKey: required(providerIdempotencyKey, "providerIdempotencyKey"),
        amount: Number(amount),
        currency: required(currency || "JOD", "currency")
      };
      if (!Number.isFinite(request.amount) || request.amount < 0) throw new Error("amount is invalid");

      const byReference = checkoutByReference.get(request.paymentReference);
      const byKey = checkoutByIdempotencyKey.get(request.providerIdempotencyKey);
      const existing = byReference || byKey;
      if (existing) {
        assertSameCheckoutIntent(existing, request);
        return { ...existing.result };
      }

      const externalPaymentId = `mock_${request.paymentReference}`;
      const result = {
        paymentReference: request.paymentReference,
        externalPaymentId,
        checkoutUrl: `${String(baseUrl || "").replace(/\/$/, "")}/api/mock-payments/${request.paymentReference}`,
        amount: request.amount,
        currency: request.currency
      };
      const record = { ...request, result };
      checkoutByReference.set(request.paymentReference, record);
      checkoutByIdempotencyKey.set(request.providerIdempotencyKey, record);
      return { ...result };
    },

    async findCheckoutByReference({ paymentReference }) {
      const reference = required(paymentReference, "paymentReference");
      const existing = checkoutByReference.get(reference);
      return existing ? { ...existing.result } : null;
    },

    async refundPayment({ refundReference, providerIdempotencyKey, externalPaymentId, amount, currency }) {
      const request = {
        refundReference: required(refundReference, "refundReference"),
        providerIdempotencyKey: required(providerIdempotencyKey, "providerIdempotencyKey"),
        externalPaymentId: required(externalPaymentId, "externalPaymentId"),
        amount: Number(amount),
        currency: required(currency || "JOD", "currency")
      };
      if (!Number.isFinite(request.amount) || request.amount <= 0) throw new Error("amount is invalid");

      const byReference = refundByReference.get(request.refundReference);
      const byKey = refundByIdempotencyKey.get(request.providerIdempotencyKey);
      const existing = byReference || byKey;
      if (existing) {
        assertSameRefundIntent(existing, request);
        return { ...existing.result };
      }

      const result = {
        refundReference: request.refundReference,
        providerRefundId: `mock_${request.refundReference}`,
        status: "succeeded",
        amount: request.amount,
        currency: request.currency
      };
      const record = { ...request, result };
      refundByReference.set(request.refundReference, record);
      refundByIdempotencyKey.set(request.providerIdempotencyKey, record);
      return { ...result };
    },

    async findRefundByReference({ refundReference }) {
      const reference = required(refundReference, "refundReference");
      const existing = refundByReference.get(reference);
      return existing ? { ...existing.result } : null;
    },

    verifyWebhook({ rawBody, signature }) {
      const secret = process.env.MOCK_PAYMENT_WEBHOOK_SECRET;
      if (!secret) throw new Error("MOCK_PAYMENT_WEBHOOK_SECRET is required");

      const expected = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");

      const given = String(signature || "");
      const a = Buffer.from(expected);
      const b = Buffer.from(given);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new Error("Invalid webhook signature");
      }
    },

    parseWebhook(rawBody) {
      const body = JSON.parse(rawBody.toString("utf8"));
      return {
        eventId: String(body.eventId || ""),
        paymentReference: body.paymentReference ? String(body.paymentReference) : null,
        externalPaymentId: String(body.externalPaymentId || ""),
        status: body.status,
        amount: Number(body.amount),
        currency: String(body.currency || "JOD"),
        raw: body
      };
    },

    parseRefundWebhook(rawBody) {
      const body = JSON.parse(rawBody.toString("utf8"));
      return {
        eventId: String(body.eventId || ""),
        refundReference: body.refundReference ? String(body.refundReference) : null,
        providerRefundId: body.providerRefundId ? String(body.providerRefundId) : null,
        status: body.status,
        amount: Number(body.amount),
        currency: String(body.currency || "JOD")
      };
    }
  };
}
