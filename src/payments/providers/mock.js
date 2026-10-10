import crypto from "node:crypto";

const checkoutByReference = new Map();
const checkoutByIdempotencyKey = new Map();

function required(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function sameMoney(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.001;
}

function assertSameIntent(existing, request) {
  if (existing.paymentReference !== request.paymentReference ||
      existing.providerIdempotencyKey !== request.providerIdempotencyKey ||
      !sameMoney(existing.amount, request.amount) ||
      existing.currency !== request.currency) {
    throw new Error("Mock checkout idempotency key/reference reused for a different payment intent");
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
        assertSameIntent(existing, request);
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
    }
  };
}
