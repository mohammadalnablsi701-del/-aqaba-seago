import Payment from "../models/Payment.js";
import Booking from "../models/Booking.js";
import CheckoutHold from "../models/CheckoutHold.js";
import Departure from "../models/Departure.js";
import { getPaymentProvider } from "../payments/index.js";

function sameMoney(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.001;
}

async function releaseHold(hold, status = "released") {
  if (!hold || hold.status !== "active") return;
  hold.status = status;
  await hold.save();
  await Departure.updateOne({ _id: hold.departureId }, { $inc: { reservedSeats: -hold.seats } });
}

export async function createCheckoutForHold({ hold, customerId, baseUrl }) {
  if (hold.customerId.toString() !== customerId.toString()) {
    throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  }
  if (hold.status !== "active" || hold.expiresAt <= new Date()) {
    if (hold.status === "active") await releaseHold(hold, "expired");
    throw Object.assign(new Error("Checkout expired"), { statusCode: 409 });
  }

  let payment = await Payment.findOne({ holdId: hold._id });
  if (!payment) {
    payment = await Payment.create({
      holdId: hold._id,
      customerId,
      provider: process.env.PAYMENT_PROVIDER || "mock",
      amount: hold.pricing.grossAmount,
      currency: hold.pricing.currency || "JOD"
    });
  }

  const provider = getPaymentProvider(payment.provider);
  const checkout = await provider.createCheckout({ payment, baseUrl });
  payment.externalPaymentId = checkout.externalPaymentId;
  payment.checkoutUrl = checkout.checkoutUrl;
  payment.status = payment.status === "paid" ? "paid" : "pending";
  await payment.save();
  return payment;
}

export async function processPaymentWebhook({ providerName, rawBody, signature }) {
  const provider = getPaymentProvider(providerName);
  provider.verifyWebhook({ rawBody, signature });
  const event = provider.parseWebhook(rawBody);

  if (!event.eventId || !event.externalPaymentId) {
    throw Object.assign(new Error("Malformed payment event"), { statusCode: 400 });
  }

  const payment = await Payment.findOne({
    provider: providerName,
    externalPaymentId: event.externalPaymentId
  });
  if (!payment) throw Object.assign(new Error("Payment not found"), { statusCode: 404 });
  if (payment.lastEventId === event.eventId) return { duplicate: true, payment };

  const hold = await CheckoutHold.findById(payment.holdId);
  if (!hold) {
    payment.status = "needs_review";
    payment.lastEventId = event.eventId;
    payment.rawLastEvent = event.raw;
    await payment.save();
    return { duplicate: false, payment };
  }

  const amountMatches = sameMoney(event.amount, payment.amount);
  const currencyMatches = event.currency === payment.currency;

  if (!amountMatches || !currencyMatches) {
    payment.status = "needs_review";
  } else if (event.status === "paid") {
    if (hold.status === "active" && hold.expiresAt > new Date()) {
      const booking = await Booking.create({
        customerId: hold.customerId,
        providerId: hold.providerId,
        tripId: hold.tripId,
        departureId: hold.departureId,
        seats: hold.seats,
        status: "confirmed",
        holdExpiresAt: hold.expiresAt,
        pricing: hold.pricing,
        idempotencyKey: `payment:${payment._id}`
      });
      hold.status = "paid";
      await hold.save();
      payment.bookingId = booking._id;
      payment.status = "paid";
      payment.paidAt = new Date();
    } else if (hold.status === "paid" && payment.bookingId) {
      payment.status = "paid";
      payment.paidAt ||= new Date();
    } else {
      if (hold.status === "active") await releaseHold(hold, "expired");
      payment.status = "needs_review";
    }
  } else if (["failed", "cancelled", "expired"].includes(event.status)) {
    await releaseHold(hold, event.status === "expired" ? "expired" : "released");
    payment.status = event.status;
    payment.failedAt = new Date();
  } else {
    payment.status = "pending";
  }

  payment.lastEventId = event.eventId;
  payment.rawLastEvent = event.raw;
  await payment.save();
  return { duplicate: false, payment };
}
