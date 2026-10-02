import crypto from "node:crypto";

export function createMockProvider() {
  return {
    name: "mock",

    async createCheckout({ payment, baseUrl }) {
      const externalPaymentId = `mock_${payment._id}`;
      return {
        externalPaymentId,
        checkoutUrl: `${baseUrl}/api/mock-payments/${payment._id}`
      };
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
        externalPaymentId: String(body.externalPaymentId || ""),
        status: body.status,
        amount: Number(body.amount),
        currency: String(body.currency || "JOD"),
        raw: body
      };
    }
  };
}
