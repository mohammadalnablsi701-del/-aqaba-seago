import Payment from "../models/Payment.js";
import Booking from "../models/Booking.js";
import { getPaymentProvider } from "../payments/index.js";

function sameMoney(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.001;
}

export async function createCheckoutForBooking({ booking, customerId, baseUrl }) {
  if (booking.customerId.toString() !== customerId.toString()) {
    throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  }

  if (booking.status !== "pending_payment") {
    throw Object.assign(new Error("Booking is not payable"), { statusCode: 409 });
  }

  if (booking.holdExpiresAt <= new Date()) {
    throw Object.assign(new Error("Booking hold expired"), { statusCode: 409 });
  }

  let payment = await Payment.findOne({ bookingId: booking._id });
  if (payment?.status === "paid") return payment;

  if (!payment) {
    payment = await Payment.create({
      bookingId: booking._id,
      customerId,
      provider: process.env.PAYMENT_PROVIDER || "mock",
      amount: booking.pricing.grossAmount,
      currency: booking.pricing.currency || "JOD"
    });
  }

  const provider = getPaymentProvider(payment.provider);
  const checkout = await provider.createCheckout({ payment, booking, baseUrl });

  payment.externalPaymentId = checkout.externalPaymentId;
  payment.checkoutUrl = checkout.checkoutUrl;
  payment.status = "pending";
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

  if (!payment) {
    throw Object.assign(new Error("Payment not found"), { statusCode: 404 });
  }

  if (payment.lastEventId === event.eventId) {
    return { duplicate: true, payment };
  }

  const booking = await Booking.findById(payment.bookingId);
  if (!booking) {
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
    if (booking.status === "pending_payment" && booking.holdExpiresAt > new Date()) {
      booking.status = "confirmed";
      await booking.save();
      payment.status = "paid";
      payment.paidAt = new Date();
    } else if (booking.status === "confirmed") {
      payment.status = "paid";
      payment.paidAt ||= new Date();
    } else {
      payment.status = "needs_review";
    }
  } else if (["failed", "cancelled", "expired"].includes(event.status)) {
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
