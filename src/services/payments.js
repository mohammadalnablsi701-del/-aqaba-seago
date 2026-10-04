import Payment from "../models/Payment.js";
import Booking from "../models/Booking.js";
import CheckoutHold from "../models/CheckoutHold.js";
import Departure from "../models/Departure.js";
import Trip from "../models/Trip.js";
import Provider from "../models/Provider.js";
import { getPaymentProvider } from "../payments/index.js";
import { sendBookingConfirmation } from "./notifications.js";

const SUCCESS_TERMINAL_PAYMENT_STATUSES=new Set(["paid","partially_refunded","refunded"]);

async function findOrCreateConfirmedBooking(hold,payment){
  const idempotencyKey=`payment:${payment._id}`;
  let booking=await Booking.findOne({customerId:hold.customerId,idempotencyKey});
  if(booking)return booking;
  try{
    booking=await Booking.create({
      customerId:hold.customerId,
      providerId:hold.providerId,
      tripId:hold.tripId,
      departureId:hold.departureId,
      seats:hold.seats,
      adults:hold.adults,
      children:hold.children,
      mealPlan:hold.mealPlan,
      status:"confirmed",
      holdExpiresAt:hold.expiresAt,
      pricing:hold.pricing,
      idempotencyKey
    });
    return booking;
  }catch(e){
    if(e?.code===11000){
      booking=await Booking.findOne({customerId:hold.customerId,idempotencyKey});
      if(booking)return booking;
    }
    throw e;
  }
}

function sameMoney(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.001;
}

async function holdInventoryIsSellable(hold) {
  const trip = await Trip.findOne({ _id: hold.tripId, active: true }).select("_id providerId");
  if (!trip) return false;
  const provider = await Provider.findOne({ _id: trip.providerId, status: "approved" }).select("_id");
  return Boolean(provider);
}

async function releaseHold(hold, status = "released") {
  if (!hold || hold.status !== "active") return false;
  const claimed = await CheckoutHold.findOneAndUpdate(
    { _id: hold._id, status: "active" },
    { $set: { status } },
    { new: true }
  );
  if (!claimed) return false;
  await Departure.updateOne(
    { _id: claimed.departureId },
    { $inc: { reservedSeats: -Number(claimed.seats || 0) } }
  );
  return true;
}

export async function releaseCheckoutHoldsForDeparture(departureId) {
  const active = await CheckoutHold.find({ departureId, status: "active" })
.select("_id departureId seats status")
    .limit(1000);

  let released = 0;
  for (const hold of active) {
    const didRelease = await releaseHold(hold, "released");
    if (!didRelease) continue;
    await Payment.updateMany(
      { holdId: hold._id, status: { $in: ["created", "pending"] } },
      { $set: { status: "cancelled", failedAt: new Date() } }
    );
    released += 1;
  }
  return released;
}

export async function releaseExpiredCheckoutHolds({ limit = 200 } = {}) {
  const now = new Date();
  const expired = await CheckoutHold.find({
    status: "active",
    expiresAt: { $lte: now }
  }).select("_id departureId seats").sort({ expiresAt: 1 }).limit(limit);

  let released = 0;
  for (const hold of expired) {
    const claimed = await CheckoutHold.findOneAndUpdate(
      { _id: hold._id, status: "active", expiresAt: { $lte: now } },
      { $set: { status: "expired" } },
      { new: true }
    );
    if (!claimed) continue;

    await Departure.updateOne(
      { _id: claimed.departureId },
      { $inc: { reservedSeats: -Number(claimed.seats || 0) } }
    );

    await Payment.updateMany(
      { holdId: claimed._id, status: "pending" },
      { $set: { status: "expired", failedAt: now } }
    );

    released += 1;
  }
  return released;
}

export async function createCheckoutForHold({ hold, customerId, baseUrl }) {
  if (hold.customerId.toString() !== customerId.toString()) {
    throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  }
  if (hold.status !== "active" || hold.expiresAt <= new Date()) {
    if (hold.status === "active") await releaseHold(hold, "expired");
    throw Object.assign(new Error("Checkout expired"), { statusCode: 409 });
  }

  const [departure, inventorySellable] = await Promise.all([
    Departure.findOne({
      _id: hold.departureId,
      status: "scheduled",
      startsAt: { $gt: new Date() }
    }).select("_id"),
    holdInventoryIsSellable(hold)
  ]);
  if (!departure || !inventorySellable) {
    await releaseHold(hold, "released");
    await Payment.updateMany(
      { holdId: hold._id, status: { $in: ["created", "pending"] } },
      { $set: { status: "cancelled", failedAt: new Date() } }
    );
    throw Object.assign(new Error("Departure is no longer available"), { statusCode: 409 });
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

  if(SUCCESS_TERMINAL_PAYMENT_STATUSES.has(payment.status)&&event.status!=="paid"){
    payment.lastEventId=event.eventId;
    payment.rawLastEvent=event.raw;
    await payment.save();
    return {duplicate:false,payment};
  }

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
  let bookingToNotify=null;

  if (!amountMatches || !currencyMatches) {
    payment.status = "needs_review";
  } else if (event.status === "paid") {
    const [departure, inventorySellable] = await Promise.all([
      Departure.findOne({
        _id: hold.departureId,
        status: "scheduled",
        startsAt: { $gt: new Date() }
      }).select("_id"),
      holdInventoryIsSellable(hold)
    ]);
    if (!departure || !inventorySellable) {
      if (hold.status === "active") await releaseHold(hold, "released");
      payment.status = "needs_review";
    } else if (hold.status === "active" && hold.expiresAt > new Date()) {
      const booking=await findOrCreateConfirmedBooking(hold,payment);
      await CheckoutHold.updateOne({_id:hold._id,status:"active"},{$set:{status:"paid"}});
      payment.bookingId=booking._id;
      payment.status="paid";
      payment.paidAt ||= new Date();
      bookingToNotify=booking._id;
    } else if (hold.status === "paid") {
      const booking=payment.bookingId
        ? await Booking.findById(payment.bookingId)
        : await Booking.findOne({customerId:hold.customerId,idempotencyKey:`payment:${payment._id}`});
      if(booking){
        payment.bookingId=booking._id;
        payment.status="paid";
        payment.paidAt ||= new Date();
      }else{
        payment.status="needs_review";
      }
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
  if(bookingToNotify){
    sendBookingConfirmation(bookingToNotify).catch(err=>console.error("Booking confirmation notification failed",err));
  }
  return { duplicate: false, payment };
}
