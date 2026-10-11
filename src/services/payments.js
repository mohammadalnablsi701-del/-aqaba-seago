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
import { sellableTripFilter } from "./tripSales.js";

const SUCCESS_TERMINAL_PAYMENT_STATUSES=new Set(["paid","partially_refunded","refunded"]);
export function isSuccessfulTerminalPaymentStatus(status){return SUCCESS_TERMINAL_PAYMENT_STATUSES.has(String(status||""));}

const FAILURE_TERMINAL_PAYMENT_STATUSES=new Set(["failed","cancelled","expired"]);
const CHECKOUT_MUTABLE_PAYMENT_STATUSES=new Set(["created","pending"]);
const MAX_PROVIDER_EVENT_ID_LENGTH=200;

export function paymentReferenceFor(payment){
  if(!payment?._id)throw new TypeError("Payment identity is required");
  return String(payment._id);
}

export function providerCheckoutIdempotencyKeyFor(payment){
  return `checkout:${paymentReferenceFor(payment)}`;
}

function legacyPendingExternalPaymentId(payment){
  return `pending_${paymentReferenceFor(payment)}`;
}

function hasBoundExternalPaymentId(payment){
  const value=String(payment?.externalPaymentId||"");
  return Boolean(value&&value!==legacyPendingExternalPaymentId(payment));
}

function sameMoney(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.001;
}

function normalizedCheckout({checkout,paymentReference,amount,currency}){
  if(!checkout||typeof checkout!=="object")throw Object.assign(new Error("Payment provider returned an invalid checkout"),{statusCode:502});
  const returnedReference=checkout.paymentReference==null?paymentReference:String(checkout.paymentReference);
  if(returnedReference!==paymentReference){
    throw Object.assign(new Error("Payment provider checkout reference mismatch"),{statusCode:502});
  }
  const externalPaymentId=String(checkout.externalPaymentId||"").trim();
  const checkoutUrl=String(checkout.checkoutUrl||"").trim();
  if(!externalPaymentId||!checkoutUrl){
    throw Object.assign(new Error("Payment provider returned an incomplete checkout"),{statusCode:502});
  }
  if(checkout.amount!==undefined&&!sameMoney(checkout.amount,amount)){
    throw Object.assign(new Error("Payment provider checkout amount mismatch"),{statusCode:502});
  }
  if(checkout.currency!==undefined&&String(checkout.currency)!==String(currency)){
    throw Object.assign(new Error("Payment provider checkout currency mismatch"),{statusCode:502});
  }
  return {...checkout,paymentReference,externalPaymentId,checkoutUrl};
}

async function lookupProviderCheckout({provider,request}){
  if(typeof provider.findCheckoutByReference!=="function")return null;
  const found=await provider.findCheckoutByReference(request);
  return found?normalizedCheckout({checkout:found,paymentReference:request.paymentReference,amount:request.amount,currency:request.currency}):null;
}

export async function createOrRecoverProviderCheckout({provider,payment,baseUrl}){
  const request={
    paymentReference:paymentReferenceFor(payment),
    providerIdempotencyKey:providerCheckoutIdempotencyKeyFor(payment),
    amount:Number(payment.amount),
    currency:String(payment.currency||"JOD"),
    baseUrl
  };

  const existing=await lookupProviderCheckout({provider,request});
  if(existing)return existing;

  try{
    const created=await provider.createCheckout(request);
    return normalizedCheckout({checkout:created,paymentReference:request.paymentReference,amount:request.amount,currency:request.currency});
  }catch(error){
    // A timeout/error can happen after the provider-side checkout was created.
    // Reference lookup recovers that ambiguous result where the adapter supports it.
    const recovered=await lookupProviderCheckout({provider,request});
    if(recovered)return recovered;
    throw error;
  }
}

async function persistCheckoutMapping({payment,checkout}){
  const placeholder=legacyPendingExternalPaymentId(payment);
  const conflict=await Payment.findOne({
    _id:{$ne:payment._id},
    provider:payment.provider,
    externalPaymentId:checkout.externalPaymentId
  }).select("_id");
  if(conflict){
    await Payment.updateOne({_id:payment._id,status:{$in:["created","pending"]}},{$set:{status:"needs_review"}});
    throw Object.assign(new Error("Payment checkout identity conflict"),{statusCode:409});
  }

  const updated=await Payment.findOneAndUpdate(
    {
      _id:payment._id,
      provider:payment.provider,
      status:{$in:["created","pending"]},
      $or:[
        {externalPaymentId:{$exists:false}},
        {externalPaymentId:null},
        {externalPaymentId:""},
        {externalPaymentId:placeholder},
        {externalPaymentId:checkout.externalPaymentId}
      ]
    },
    {$set:{externalPaymentId:checkout.externalPaymentId,checkoutUrl:checkout.checkoutUrl,status:"pending"}},
    {new:true}
  );
  if(updated)return updated;

  const current=await Payment.findById(payment._id);
  if(!current)throw Object.assign(new Error("Payment disappeared during checkout creation"),{statusCode:409});
  if(hasBoundExternalPaymentId(current)&&String(current.externalPaymentId)!==checkout.externalPaymentId){
    if(!isSuccessfulTerminalPaymentStatus(current.status)){
      await Payment.updateOne({_id:current._id},{$set:{status:"needs_review"}});
    }
    throw Object.assign(new Error("Payment checkout identity conflict"),{statusCode:409});
  }
  if(String(current.externalPaymentId||"")===checkout.externalPaymentId&&!current.checkoutUrl){
    await Payment.updateOne({_id:current._id,externalPaymentId:checkout.externalPaymentId},{$set:{checkoutUrl:checkout.checkoutUrl}});
    return Payment.findById(current._id);
  }
  // A webhook may have completed the financial transition while the checkout API
  // was persisting the provider result. Do not overwrite that terminal state.
  return current;
}

async function recordPaymentEventInSession({providerName,event,payment,session}){
  if(!session)throw new TypeError("PaymentEvent persistence requires a transaction session");
  const [record]=await PaymentEvent.create([{
    provider:providerName,
    eventId:event.eventId,
    externalPaymentId:event.externalPaymentId,
    paymentId:payment._id,
    eventStatus:event.status,
    amount:event.amount,
    currency:event.currency,
    raw:event.raw,
    processedAt:new Date()
  }],{session});
  return record;
}

async function claimPaymentEventInSession({providerName,event,payment,session}){
  const seen=await PaymentEvent.exists({provider:providerName,eventId:event.eventId}).session(session);
  if(seen)return {duplicate:true,backfilled:false};
  const legacyDuplicate=payment.lastEventId===event.eventId;
  await recordPaymentEventInSession({providerName,event,payment,session});
  return {duplicate:legacyDuplicate,backfilled:legacyDuplicate};
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
      const trip=await Trip.findOne(sellableTripFilter({_id:hold.tripId})).session(session).select("_id providerId");
      const provider=trip?await Provider.findOne({_id:trip.providerId,status:"approved"}).session(session).select("_id"):null;
      if(!departure||!trip||!provider){
        payment.status="needs_review";
        payment.lastEventId=event.eventId;
        payment.rawLastEvent=event.raw;
        await payment.save({session});
        // A successful gateway event cannot become a booking when current trip/provider
        // sales authority has been revoked. Release the still-active hold atomically so
        // paid-but-blocked inventory does not leak while Payment remains reviewable.
        if(!trip||!provider)await releaseHold(hold,"released",session);
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

async function holdInventoryIsSellable(hold) {
  const trip = await Trip.findOne(sellableTripFilter({ _id: hold.tripId })).select("_id providerId");
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
    const paymentId=new mongoose.Types.ObjectId();
    payment = await Payment.create({
      _id:paymentId,
      holdId: hold._id,
      customerId,
      provider: process.env.PAYMENT_PROVIDER || "mock",
      externalPaymentId:`pending_${paymentId}`,
      amount: hold.pricing.grossAmount,
      currency: hold.pricing.currency || "JOD"
    });
  }

  // The Mongo _id is the SeaGo-owned merchant reference. It is immutable, unique,
  // merchant-safe, and this Payment is durable before any provider side effect.
  // pending_<id> is only an internal unbound sentinel for the existing unique index.
  if(!CHECKOUT_MUTABLE_PAYMENT_STATUSES.has(payment.status))return payment;
  if(hasBoundExternalPaymentId(payment)&&payment.checkoutUrl)return payment;

  const provider = getPaymentProvider(payment.provider);
  const checkout = await createOrRecoverProviderCheckout({provider,payment,baseUrl});
  return persistCheckoutMapping({payment,checkout});
}

function canonicalPaymentReference(value){
  const reference=String(value||"").trim();
  if(!/^[a-f\d]{24}$/i.test(reference)||!mongoose.isValidObjectId(reference))return null;
  return String(new mongoose.Types.ObjectId(reference));
}

async function markCorrelationReview({payment,event,session}){
  if(!isSuccessfulTerminalPaymentStatus(payment.status))payment.status="needs_review";
  payment.lastEventId=event.eventId;
  payment.rawLastEvent=event.raw;
  await payment.save({session});
  return payment;
}

async function claimOrDuplicate({providerName,event,payment,session}){
  const claim=await claimPaymentEventInSession({providerName,event,payment,session});
  return claim.duplicate;
}

export async function processPaymentWebhook({ providerName, rawBody, signature }) {
  const provider = getPaymentProvider(providerName);
  provider.verifyWebhook({ rawBody, signature });
  const event = provider.parseWebhook(rawBody);
  const eventId=typeof event.eventId==="string"?event.eventId.trim():"";
  const allowedStatuses = new Set(["pending", "paid", "failed", "cancelled", "expired"]);
  const paymentReference=event.paymentReference?canonicalPaymentReference(event.paymentReference):null;
  if (!eventId || eventId.length>MAX_PROVIDER_EVENT_ID_LENGTH || !event.externalPaymentId || !allowedStatuses.has(event.status) ||
      !Number.isFinite(event.amount) || event.amount < 0 || (event.paymentReference && !paymentReference)) {
    throw Object.assign(new Error("Malformed payment event"), { statusCode: 400 });
  }
  event.eventId=eventId;

  const session = await mongoose.startSession();
  let result;
  let confirmationBookingId;
  try {
    try {
      await session.withTransaction(async () => {
        // MongoDB may retry this callback after a write conflict. Always reload
        // the state and reset post-commit side effects instead of using stale state.
        confirmationBookingId = null;
        const paymentByExternal=await Payment.findOne({
          provider:providerName,externalPaymentId:event.externalPaymentId
        }).session(session);
        let payment=paymentByExternal;

        if(paymentReference){
          const paymentByReference=await Payment.findOne({_id:paymentReference,provider:providerName}).session(session);
          if(!paymentByReference){
            if(paymentByExternal){
              if(await claimOrDuplicate({providerName,event,payment:paymentByExternal,session})){
                result={duplicate:true,payment:paymentByExternal};
                return;
              }
              await markCorrelationReview({payment:paymentByExternal,event,session});
              result={duplicate:false,payment:paymentByExternal};
              return;
            }
            throw Object.assign(new Error("Payment not found"),{statusCode:404});
          }
          payment=paymentByReference;
          if(paymentByExternal&&String(paymentByExternal._id)!==String(payment._id)){
            if(await claimOrDuplicate({providerName,event,payment,session})){
              result={duplicate:true,payment};
              return;
            }
            await markCorrelationReview({payment,event,session});
            result={duplicate:false,payment};
            return;
          }
          if(hasBoundExternalPaymentId(payment)&&String(payment.externalPaymentId)!==event.externalPaymentId){
            if(await claimOrDuplicate({providerName,event,payment,session})){
              result={duplicate:true,payment};
              return;
            }
            await markCorrelationReview({payment,event,session});
            result={duplicate:false,payment};
            return;
          }
        }

        if (!payment) throw Object.assign(new Error("Payment not found"), { statusCode: 404 });
        if(await claimOrDuplicate({providerName,event,payment,session})){
          result={duplicate:true,payment};
          return;
        }

        // Never resurrect a refunded payment or overwrite a successful result.
        // The authenticated provider event is already durably claimed in this
        // transaction, so ignored/reviewed events retain reconciliation evidence.
        if (isSuccessfulTerminalPaymentStatus(payment.status) || payment.status === "needs_review" ||
            (FAILURE_TERMINAL_PAYMENT_STATUSES.has(payment.status) && event.status !== "paid")) {
          result = { duplicate: false, payment };
          return;
        }

        const hold = await CheckoutHold.findById(payment.holdId).session(session);
        const moneyMatches=hold&&sameMoney(event.amount,payment.amount)&&event.currency===payment.currency;
        if (!moneyMatches) {
          payment.status = "needs_review";
        } else {
          // First binding after a crash/DB failure is allowed only after provider,
          // SeaGo reference, amount and currency have all matched in this transaction.
          if(paymentReference&&!hasBoundExternalPaymentId(payment))payment.externalPaymentId=event.externalPaymentId;

          if (event.status === "paid") {
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
        }
        payment.lastEventId = event.eventId;
        payment.rawLastEvent = event.raw;
        await payment.save({session});
        result = { duplicate: false, payment };
      });
    } catch (error) {
      if(error?.code!==11000)throw error;
      // A concurrent delivery can win the (provider,eventId) unique-key race.
      // Only acknowledge it as a safe duplicate after the winning durable event
      // is visible; unrelated duplicate-key failures remain retryable errors.
      const existing=await PaymentEvent.findOne({provider:providerName,eventId:event.eventId}).select("paymentId").lean();
      if(!existing)throw error;
      const payment=await Payment.findById(existing.paymentId);
      if(!payment)throw error;
      confirmationBookingId=null;
      result={duplicate:true,payment};
    }
  } finally {
    await session.endSession();
  }

  if (confirmationBookingId) {
    try { await sendBookingConfirmation(confirmationBookingId); }
    catch (err) { console.error("Booking confirmation notification failed", err); }
  }
  return result;
}
