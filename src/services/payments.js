import mongoose from "mongoose";
import { releaseCheckoutHold } from "./inventory.js";
import Payment from "../models/Payment.js";
import PaymentEvent from "../models/PaymentEvent.js";
import Booking from "../models/Booking.js";
import CheckoutHold from "../models/CheckoutHold.js";
import Departure from "../models/Departure.js";
import Trip from "../models/Trip.js";
import Provider from "../models/Provider.js";
import User from "../models/User.js";
import { getPaymentProvider } from "../payments/index.js";
import { sendBookingConfirmation } from "./notifications.js";

const SUCCESS_TERMINAL_PAYMENT_STATUSES=new Set(["paid","partially_refunded","refunded"]);
export function isSuccessfulTerminalPaymentStatus(status){return SUCCESS_TERMINAL_PAYMENT_STATUSES.has(String(status||""));}

const FAILURE_TERMINAL_PAYMENT_STATUSES=new Set(["failed","cancelled","expired"]);

async function recordPaymentEvent({providerName,event,payment}){
  try{
    await PaymentEvent.create({provider:providerName,eventId:event.eventId,externalPaymentId:event.externalPaymentId,paymentId:payment._id,eventStatus:event.status,amount:event.amount,currency:event.currency,raw:event.raw,processedAt:new Date()});
  }catch(e){if(e?.code!==11000)throw e;}
}

async function confirmPaidHoldInSession({payment,event,session}){
  let result=null;
  async function confirm(){
      const hold=await CheckoutHold.findById(payment.holdId).session(session);
      if(!hold){
        payment.status="needs_review";
        payment.lastEventId=event.eventId;
        payment.rawLastEvent=event.raw;
        await payment.save({session});
        result={payment,bookingId:null};
        return;
      }

      if(hold.status==="paid"){
        const booking=payment.bookingId
          ? await Booking.findById(payment.bookingId).session(session)
          : await Booking.findOne({customerId:hold.customerId,idempotencyKey:`payment:${payment._id}`}).session(session);
        if(!booking || booking.status!=="confirmed"){
          payment.status="needs_review";
          payment.lastEventId=event.eventId;
          payment.rawLastEvent=event.raw;
          await payment.save({session});
          result={payment,bookingId:null};
          return;
        }
        payment.bookingId=booking._id;
        payment.status="paid";
        payment.paidAt ||= new Date();
        payment.lastEventId=event.eventId;
        payment.rawLastEvent=event.raw;
        await payment.save({session});
        result={payment,bookingId:booking._id};
        return;
      }

      const now=new Date();
      if(hold.status!=="active"||hold.expiresAt<=now){
        payment.status="needs_review";
        payment.lastEventId=event.eventId;
        payment.rawLastEvent=event.raw;
        await payment.save({session});
        result={payment,bookingId:null};
        return;
      }

      const departure=await Departure.findOne({_id:hold.departureId,status:"scheduled",salesClosed:{$ne:true},startsAt:{$gt:now}}).session(session).select("_id");
      const trip=await Trip.findOne({_id:hold.tripId,active:true}).session(session).select("_id providerId");
      const provider=trip?await Provider.findOne({_id:trip.providerId,status:"approved"}).session(session).select("_id"):null;
      if(!departure||!trip||!provider){
        payment.status="needs_review";
        payment.lastEventId=event.eventId;
        payment.rawLastEvent=event.raw;
        await payment.save({session});
        result={payment,bookingId:null};
        return;
      }

      const customer=await User.findById(hold.customerId).session(session).select("name phone phoneNormalized");
      if(!customer||!(customer.phoneNormalized||customer.phone)){
        payment.status="needs_review";
        payment.lastEventId=event.eventId;
        payment.rawLastEvent=event.raw;
        await payment.save({session});
        result={payment,bookingId:null};
        return;
      }

      const idempotencyKey=`payment:${payment._id}`;
      const booking=await Booking.findOneAndUpdate(
        {customerId:hold.customerId,idempotencyKey},
        {$setOnInsert:{
          customerId:hold.customerId,
          customerSnapshot:{
            name:String(customer.name||"").trim(),
            phone:String(customer.phoneNormalized||customer.phone||"").trim()
          },
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
        }},
        {new:true,upsert:true,setDefaultsOnInsert:true,session}
      );

      const claimed=await CheckoutHold.findOneAndUpdate(
        {_id:hold._id,status:"active",expiresAt:{$gt:now}},
        {$set:{status:"paid"}},
        {new:true,session}
      );
      if(!claimed)throw Object.assign(new Error("Checkout hold changed during payment confirmation"),{statusCode:409});

      payment.bookingId=booking._id;
      payment.status="paid";
      payment.paidAt ||= now;
      payment.lastEventId=event.eventId;
      payment.rawLastEvent=event.raw;
      await payment.save({session});
      result={payment,bookingId:booking._id};
  }
  await confirm();
  return result;
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

async function releaseHold(hold, status = "released", session = undefined) {
  if (!hold) return false;
  return releaseCheckoutHold(hold._id, {status,session});
}

export async function releaseCheckoutHoldsForDeparture(departureId) {
  const active=await CheckoutHold.find({departureId,status:"active"}).select("_id").limit(1000);
  let released=0;
  for(const hold of active)if(await releaseCheckoutHold(hold._id))released++;
  return released;
}

export async function releaseExpiredCheckoutHolds({ limit = 200 } = {}) {
  const now=new Date();
  const expired=await CheckoutHold.find({status:"active",expiresAt:{$lte:now}})
    .select("_id").sort({expiresAt:1}).limit(limit);
  let released=0;
  for(const hold of expired){
    if(await releaseCheckoutHold(hold._id,{status:"expired",expiredBefore:now}))released++;
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
      salesClosed: { $ne: true },
      startsAt: { $gt: new Date() }
    }).select("_id"),
    holdInventoryIsSellable(hold)
  ]);
  if (!departure || !inventorySellable) {
    await releaseHold(hold, "released");
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
  // A webhook may have finalized this payment while checkout was being prepared.
  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ["created", "pending"] } },
    { $set: { externalPaymentId: checkout.externalPaymentId, checkoutUrl: checkout.checkoutUrl, status: "pending" } },
    { new: true }
  );
  return updated || await Payment.findById(payment._id);
}

export async function processPaymentWebhook({ providerName, rawBody, signature }) {
  const provider = getPaymentProvider(providerName);
  provider.verifyWebhook({ rawBody, signature });
  const event = provider.parseWebhook(rawBody);
  const allowedStatuses = new Set(["pending", "paid", "failed", "cancelled", "expired"]);
  if (!event.eventId || !event.externalPaymentId || !allowedStatuses.has(event.status) ||
      !Number.isFinite(event.amount) || event.amount < 0) {
    throw Object.assign(new Error("Malformed payment event"), { statusCode: 400 });
  }

  const session = await mongoose.startSession();
  let result;
  let confirmationBookingId;
  try {
    await session.withTransaction(async () => {
      // MongoDB may retry this callback after a write conflict. Always reload
      // the state and reset side effects instead of using a stale preflight read.
      confirmationBookingId = null;
      const payment = await Payment.findOne({
        provider: providerName, externalPaymentId: event.externalPaymentId
      }).session(session);
      if (!payment) throw Object.assign(new Error("Payment not found"), { statusCode: 404 });
      const seen = await PaymentEvent.exists({provider:providerName,eventId:event.eventId}).session(session);
      if (seen || payment.lastEventId === event.eventId) {
        result = { duplicate: true, payment };
        return;
      }

      // Never resurrect a refunded payment or overwrite a successful result.
      // Record ignored events separately without saving a stale Payment document.
      if (isSuccessfulTerminalPaymentStatus(payment.status) || payment.status === "needs_review" ||
          (FAILURE_TERMINAL_PAYMENT_STATUSES.has(payment.status) && event.status !== "paid")) {
        result = { duplicate: false, payment };
        return;
      }

      const hold = await CheckoutHold.findById(payment.holdId).session(session);
      if (!hold || !sameMoney(event.amount, payment.amount) || event.currency !== payment.currency) {
        payment.status = "needs_review";
      } else if (event.status === "paid") {
        if (FAILURE_TERMINAL_PAYMENT_STATUSES.has(payment.status)) {
          // A late success after seats were released requires reconciliation,
          // never automatic rebooking or a second seat allocation.
          payment.status = "needs_review";
        } else {
          const confirmed = await confirmPaidHoldInSession({payment,event,session});
          confirmationBookingId = confirmed?.bookingId || null;
          result = { duplicate: false, payment: confirmed?.payment || payment };
          return;
        }
      } else if (FAILURE_TERMINAL_PAYMENT_STATUSES.has(event.status)) {
        if (hold.status === "paid" || payment.bookingId) {
          payment.status = "needs_review";
        } else {
          await releaseHold(hold, event.status === "expired" ? "expired" : "released", session);
          payment.status = event.status;
          payment.failedAt = new Date();
        }
      } else {
        payment.status = "pending";
      }
      payment.lastEventId = event.eventId;
      payment.rawLastEvent = event.raw;
      await payment.save({session});
      result = { duplicate: false, payment };
    });
  } finally {
    await session.endSession();
  }

  if (!result.duplicate) await recordPaymentEvent({providerName,event,payment:result.payment});
  if (confirmationBookingId) {
    try { await sendBookingConfirmation(confirmationBookingId); }
    catch (err) { console.error("Booking confirmation notification failed", err); }
  }
  return result;
}
