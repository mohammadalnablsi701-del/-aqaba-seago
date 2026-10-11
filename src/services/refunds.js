import crypto from "node:crypto";
import mongoose from "mongoose";
import Refund from "../models/Refund.js";
import Payment from "../models/Payment.js";
import PaymentEvent from "../models/PaymentEvent.js";
import Booking from "../models/Booking.js";
import { getPaymentProvider } from "../payments/index.js";

const REFUND_STATES = new Set(["requested", "pending", "succeeded", "failed", "needs_review"]);
const PROVIDER_RESULT_STATES = new Set(["pending", "succeeded", "failed"]);
const MONEY_EPSILON = 0.005;
const MAX_PROVIDER_EVENT_ID_LENGTH = 200;

export function refundMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) throw new TypeError("Refund amount is invalid");
  return Number(number.toFixed(2));
}

export function sameRefundMoney(a, b) {
  return Math.abs(refundMoney(a) - refundMoney(b)) <= MONEY_EPSILON;
}

function currencyOf(value) {
  return String(value || "JOD").trim().toUpperCase();
}

function canonicalIntentPart(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

export function refundReferenceFor({ paymentId, intentType, intentId }) {
  const payment = canonicalIntentPart(paymentId, "paymentId");
  const type = canonicalIntentPart(intentType, "intentType");
  const id = canonicalIntentPart(intentId, "intentId");
  const digest = crypto.createHash("sha256").update(`seago-refund-v1|${payment}|${type}|${id}`).digest("hex").slice(0, 32);
  return `rf_${digest}`;
}

export function providerRefundIdempotencyKeyFor(refund) {
  const reference = canonicalIntentPart(refund?.reference, "refund reference");
  return `refund:${reference}`;
}

export function customerRefundStatusForState(state) {
  if (state === "succeeded") return "processed";
  if (state === "failed") return "failed";
  if (state === "requested" || state === "pending" || state === "needs_review") return "pending";
  return "none";
}

function paymentStatusForRefundedAmount(paymentAmount, refundedAmount) {
  const total = refundMoney(paymentAmount);
  const refunded = refundMoney(refundedAmount);
  if (refunded <= MONEY_EPSILON) return "paid";
  if (refunded + MONEY_EPSILON >= total) return "refunded";
  return "partially_refunded";
}

async function syncBookingRefundStatus(refund, session) {
  if (!refund.bookingId) return;
  await Booking.updateOne(
    { _id: refund.bookingId, "cancellation.cancelledAt": { $ne: null } },
    { $set: { "cancellation.refundStatus": customerRefundStatusForState(refund.state) } },
    { session }
  );
}

async function reviewInSession({ refund, payment, reason, session }) {
  refund.state = "needs_review";
  refund.reviewReason = String(reason || "inconsistent_refund_state").slice(0, 80);
  refund.lastReconciledAt = new Date();
  await refund.save({ session });
  if (payment) {
    payment.status = "needs_review";
    await payment.save({ session });
  }
  await syncBookingRefundStatus(refund, session);
  return refund;
}

async function paymentHasOtherRefundReview(paymentId, refundId, session) {
  const row = await Refund.findOne({
    paymentId,
    _id: { $ne: refundId },
    state: "needs_review"
  }).session(session).select("_id");
  return Boolean(row);
}

function intentMatches(refund, { payment, bookingId, provider, amount, currency, intentType, intentId, reference, idempotencyKey }) {
  return String(refund.paymentId) === String(payment._id) &&
    String(refund.bookingId || "") === String(bookingId || "") &&
    refund.provider === provider &&
    sameRefundMoney(refund.amount, amount) &&
    refund.currency === currency &&
    refund.intentType === intentType &&
    refund.intentId === intentId &&
    refund.reference === reference &&
    refund.idempotencyKey === idempotencyKey;
}

export async function createRefundIntentInSession({
  payment,
  bookingId = null,
  amount,
  currency = null,
  intentType,
  intentId,
  session
}) {
  if (!session) throw new TypeError("Refund intent persistence requires a transaction session");
  if (!payment?._id) throw new TypeError("Payment is required");
  const normalizedAmount = refundMoney(amount);
  if (normalizedAmount <= 0) return null;
  const provider = canonicalIntentPart(payment.provider, "provider");
  const normalizedCurrency = currencyOf(currency || payment.currency);
  const paymentCurrency = currencyOf(payment.currency);
  const type = canonicalIntentPart(intentType, "intentType");
  const id = canonicalIntentPart(intentId, "intentId");
  const reference = refundReferenceFor({ paymentId: payment._id, intentType: type, intentId: id });
  const idempotencyKey = `refund:${reference}`;

  let existing = await Refund.findOne({ reference }).session(session);
  if (existing) {
    if (!intentMatches(existing, { payment, bookingId, provider, amount: normalizedAmount, currency: normalizedCurrency, intentType: type, intentId: id, reference, idempotencyKey })) {
      return reviewInSession({ refund: existing, payment, reason: "intent_mismatch", session });
    }
    return existing;
  }

  if (normalizedCurrency !== paymentCurrency) {
    [existing] = await Refund.create([{
      paymentId: payment._id, bookingId, provider, reference, idempotencyKey,
      intentType: type, intentId: id, amount: normalizedAmount, currency: normalizedCurrency,
      state: "needs_review", reviewReason: "currency_mismatch"
    }], { session });
    payment.status = "needs_review";
    await payment.save({ session });
    return existing;
  }

  const total = refundMoney(payment.amount);
  const refunded = refundMoney(payment.refundedAmount);
  const reserved = refundMoney(payment.refundReservedAmount);
  if (refunded + reserved + normalizedAmount > total + MONEY_EPSILON) {
    [existing] = await Refund.create([{
      paymentId: payment._id, bookingId, provider, reference, idempotencyKey,
      intentType: type, intentId: id, amount: normalizedAmount, currency: normalizedCurrency,
      state: "needs_review", reviewReason: "over_refund"
    }], { session });
    payment.status = "needs_review";
    await payment.save({ session });
    return existing;
  }

  payment.refundReservedAmount = refundMoney(reserved + normalizedAmount);
  await payment.save({ session });
  [existing] = await Refund.create([{
    paymentId: payment._id,
    bookingId,
    provider,
    reference,
    idempotencyKey,
    intentType: type,
    intentId: id,
    amount: normalizedAmount,
    currency: normalizedCurrency,
    state: "requested"
  }], { session });
  return existing;
}

export async function ensureRefundIntent({ paymentId, bookingId = null, amount, currency = null, intentType, intentId }) {
  const reference = refundReferenceFor({ paymentId, intentType, intentId });
  const session = await mongoose.startSession();
  try {
    let created;
    await session.withTransaction(async () => {
      const payment = await Payment.findById(paymentId).session(session);
      if (!payment) throw Object.assign(new Error("Payment not found"), { statusCode: 404 });
      created = await createRefundIntentInSession({ payment, bookingId, amount, currency, intentType, intentId, session });
    });
    return created;
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await Refund.findOne({ reference });
      if (existing) return existing;
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

function normalizeProviderResult(result, refund) {
  if (!result || typeof result !== "object") throw new Error("Refund provider returned an invalid result");
  const status = String(result.status || "").trim();
  if (!PROVIDER_RESULT_STATES.has(status)) throw new Error("Refund provider returned an invalid status");
  const returnedReference = result.refundReference == null ? refund.reference : String(result.refundReference).trim();
  const amount = result.amount == null ? refund.amount : refundMoney(result.amount);
  const currency = result.currency == null ? refund.currency : currencyOf(result.currency);
  const providerRefundId = result.providerRefundId == null ? null : String(result.providerRefundId).trim() || null;
  return { refundReference: returnedReference, providerRefundId, status, amount, currency };
}

async function applyResultInSession({ refund, providerName, result, session }) {
  const payment = await Payment.findById(refund.paymentId).session(session);
  if (!payment) return reviewInSession({ refund, payment: null, reason: "payment_missing", session });
  if (providerName !== refund.provider || payment.provider !== refund.provider || String(payment._id) !== String(refund.paymentId)) {
    return reviewInSession({ refund, payment, reason: "provider_or_payment_mismatch", session });
  }
  if (result.refundReference !== refund.reference) return reviewInSession({ refund, payment, reason: "reference_mismatch", session });
  if (!sameRefundMoney(result.amount, refund.amount)) return reviewInSession({ refund, payment, reason: "amount_mismatch", session });
  if (currencyOf(result.currency) !== refund.currency || currencyOf(payment.currency) !== refund.currency) {
    return reviewInSession({ refund, payment, reason: "currency_mismatch", session });
  }
  if (refund.providerRefundId && result.providerRefundId && refund.providerRefundId !== result.providerRefundId) {
    return reviewInSession({ refund, payment, reason: "provider_refund_id_conflict", session });
  }
  if (result.providerRefundId) {
    const collision = await Refund.findOne({
      _id: { $ne: refund._id }, provider: refund.provider, providerRefundId: result.providerRefundId
    }).session(session).select("_id");
    if (collision) return reviewInSession({ refund, payment, reason: "provider_refund_id_conflict", session });
  }

  if (refund.state === "succeeded") {
    if (result.status === "succeeded") {
      refund.lastReconciledAt = new Date();
      refund.providerStatus = result.status;
      if (result.providerRefundId && !refund.providerRefundId) refund.providerRefundId = result.providerRefundId;
      await refund.save({ session });
      return { refund, payment, duplicate: true };
    }
    return reviewInSession({ refund, payment, reason: "terminal_state_conflict", session });
  }
  if (refund.state === "failed") {
    if (result.status === "failed") return { refund, payment, duplicate: true };
    return reviewInSession({ refund, payment, reason: "terminal_state_conflict", session });
  }

  refund.providerRefundId ||= result.providerRefundId || undefined;
  refund.providerStatus = result.status;
  refund.lastReconciledAt = new Date();

  if (result.status === "pending") {
    refund.state = "pending";
    refund.reviewReason = undefined;
    await refund.save({ session });
    await syncBookingRefundStatus(refund, session);
    return { refund, payment, duplicate: false };
  }

  const reserved = refundMoney(payment.refundReservedAmount);
  if (reserved + MONEY_EPSILON < refund.amount) {
    return reviewInSession({ refund, payment, reason: "reservation_mismatch", session });
  }

  const preserveReview = payment.status === "needs_review" ||
    await paymentHasOtherRefundReview(payment._id, refund._id, session);

  if (result.status === "failed") {
    payment.refundReservedAmount = refundMoney(Math.max(0, reserved - refund.amount));
    if (!preserveReview) {
      payment.status = paymentStatusForRefundedAmount(payment.amount, payment.refundedAmount);
    }
    await payment.save({ session });
    refund.state = "failed";
    refund.reviewReason = undefined;
    refund.completedAt = new Date();
    await refund.save({ session });
    await syncBookingRefundStatus(refund, session);
    return { refund, payment, duplicate: false };
  }

  const nextRefunded = refundMoney(refundMoney(payment.refundedAmount) + refund.amount);
  if (nextRefunded > refundMoney(payment.amount) + MONEY_EPSILON) {
    return reviewInSession({ refund, payment, reason: "over_refund", session });
  }
  payment.refundedAmount = Math.min(refundMoney(payment.amount), nextRefunded);
  payment.refundReservedAmount = refundMoney(Math.max(0, reserved - refund.amount));
  payment.refundedAt = new Date();
  if (!preserveReview) {
    payment.status = paymentStatusForRefundedAmount(payment.amount, payment.refundedAmount);
  }
  await payment.save({ session });

  refund.state = "succeeded";
  refund.reviewReason = undefined;
  refund.completedAt = new Date();
  await refund.save({ session });
  await syncBookingRefundStatus(refund, session);
  return { refund, payment, duplicate: false };
}

export async function applyProviderRefundResult({ refundReference, providerName, result }) {
  const session = await mongoose.startSession();
  let output;
  try {
    await session.withTransaction(async () => {
      const refund = await Refund.findOne({ reference: String(refundReference || "").trim() }).session(session);
      if (!refund) throw Object.assign(new Error("Refund not found"), { statusCode: 404 });
      const normalized = normalizeProviderResult(result, refund);
      const applied = await applyResultInSession({ refund, providerName: String(providerName || refund.provider), result: normalized, session });
      output = applied?.refund ? applied : { refund: applied, payment: null, duplicate: false };
    });
    return output;
  } finally {
    await session.endSession();
  }
}

async function markState({ refundReference, state, reason = null }) {
  if (!REFUND_STATES.has(state)) throw new TypeError("Invalid refund state");
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const refund = await Refund.findOne({ reference: refundReference }).session(session);
      if (!refund) throw Object.assign(new Error("Refund not found"), { statusCode: 404 });
      if (refund.state === "succeeded" || refund.state === "failed") {
        result = refund;
        return;
      }
      const payment = await Payment.findById(refund.paymentId).session(session);
      if (state === "needs_review") {
        result = await reviewInSession({ refund, payment, reason, session });
        return;
      }
      refund.state = state;
      refund.reviewReason = reason || undefined;
      refund.lastReconciledAt = new Date();
      await refund.save({ session });
      await syncBookingRefundStatus(refund, session);
      result = refund;
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function providerLookup(provider, request) {
  if (typeof provider.findRefundByReference !== "function") return null;
  return provider.findRefundByReference(request);
}

function providerRequest(refund, payment) {
  return {
    refundReference: refund.reference,
    providerIdempotencyKey: refund.idempotencyKey,
    externalPaymentId: String(payment.externalPaymentId || ""),
    amount: refund.amount,
    currency: refund.currency
  };
}

export async function executeRefundIntent({ refundReference, providerOverride = null }) {
  let refund = await Refund.findOne({ reference: refundReference });
  if (!refund) throw Object.assign(new Error("Refund not found"), { statusCode: 404 });
  if (refund.state === "succeeded" || refund.state === "failed") return { refund, duplicate: true };
  const payment = await Payment.findById(refund.paymentId);
  if (!payment) {
    const reviewed = await markState({ refundReference, state: "needs_review", reason: "payment_missing" });
    return { refund: reviewed, duplicate: false };
  }

  let provider;
  try {
    provider = providerOverride || getPaymentProvider(refund.provider);
  } catch {
    const reviewed = await markState({ refundReference, state: "needs_review", reason: "provider_unavailable" });
    return { refund: reviewed, duplicate: false };
  }
  const request = providerRequest(refund, payment);

  try {
    const found = await providerLookup(provider, request);
    if (found) return applyProviderRefundResult({ refundReference, providerName: refund.provider, result: found });
  } catch {
    const reviewed = await markState({ refundReference, state: "needs_review", reason: "lookup_failed" });
    return { refund: reviewed, duplicate: false };
  }

  refund = await Refund.findOne({ reference: refundReference });
  if (refund.state === "pending" || refund.state === "needs_review") {
    return { refund, duplicate: true };
  }
  if (refund.state !== "requested") {
    const reviewed = await markState({ refundReference, state: "needs_review", reason: "inconsistent_refund_state" });
    return { refund: reviewed, duplicate: false };
  }
  if (typeof provider.refundPayment !== "function") {
    const reviewed = await markState({ refundReference, state: "needs_review", reason: "refund_capability_unavailable" });
    return { refund: reviewed, duplicate: false };
  }

  await Refund.updateOne({ _id: refund._id, state: "requested" }, { $inc: { attemptCount: 1 } });
  try {
    const providerResult = await provider.refundPayment(request);
    return applyProviderRefundResult({ refundReference, providerName: refund.provider, result: providerResult });
  } catch (error) {
    try {
      const recovered = await providerLookup(provider, request);
      if (recovered) return applyProviderRefundResult({ refundReference, providerName: refund.provider, result: recovered });
    } catch {
      const reviewed = await markState({ refundReference, state: "needs_review", reason: "lookup_failed" });
      return { refund: reviewed, duplicate: false };
    }
    if (error?.definite === true) {
      return applyProviderRefundResult({
        refundReference,
        providerName: refund.provider,
        result: { refundReference, status: "failed", amount: refund.amount, currency: refund.currency }
      });
    }
    const pending = await markState({ refundReference, state: "pending" });
    return { refund: pending, duplicate: false, ambiguous: true };
  }
}

export async function reconcileRefund({ refundReference, providerOverride = null }) {
  const refund = await Refund.findOne({ reference: refundReference });
  if (!refund) throw Object.assign(new Error("Refund not found"), { statusCode: 404 });
  if (refund.state === "succeeded" || refund.state === "failed") return { refund, duplicate: true };
  const payment = await Payment.findById(refund.paymentId);
  if (!payment) {
    const reviewed = await markState({ refundReference, state: "needs_review", reason: "payment_missing" });
    return { refund: reviewed, duplicate: false };
  }
  let provider;
  try {
    provider = providerOverride || getPaymentProvider(refund.provider);
  } catch {
    const reviewed = await markState({ refundReference, state: "needs_review", reason: "provider_unavailable" });
    return { refund: reviewed, duplicate: false };
  }
  if (typeof provider.findRefundByReference !== "function") {
    const reviewed = await markState({ refundReference, state: "needs_review", reason: "lookup_unavailable" });
    return { refund: reviewed, duplicate: false };
  }
  try {
    const found = await provider.findRefundByReference(providerRequest(refund, payment));
    if (!found) return { refund, duplicate: true, notFoundAtProvider: true };
    return applyProviderRefundResult({ refundReference, providerName: refund.provider, result: found });
  } catch {
    const reviewed = await markState({ refundReference, state: "needs_review", reason: "lookup_failed" });
    return { refund: reviewed, duplicate: false };
  }
}

export async function processRefundWebhook({ providerName, rawBody, signature }) {
  const provider = getPaymentProvider(providerName);
  provider.verifyWebhook({ rawBody, signature });
  if (typeof provider.parseRefundWebhook !== "function") {
    throw Object.assign(new Error("Refund webhook is unsupported"), { statusCode: 400 });
  }
  const event = provider.parseRefundWebhook(rawBody);
  const eventId = typeof event.eventId === "string" ? event.eventId.trim() : "";
  const reference = String(event.refundReference || "").trim();
  if (!eventId || eventId.length > MAX_PROVIDER_EVENT_ID_LENGTH || !/^rf_[a-f\d]{32}$/i.test(reference) ||
      !PROVIDER_RESULT_STATES.has(event.status) || !Number.isFinite(Number(event.amount)) ||
      Number(event.amount) < 0 || !String(event.currency || "").trim()) {
    throw Object.assign(new Error("Malformed refund event"), { statusCode: 400 });
  }

  const session = await mongoose.startSession();
  let output;
  try {
    try {
      await session.withTransaction(async () => {
        const refund = await Refund.findOne({ reference }).session(session);
        if (!refund) throw Object.assign(new Error("Refund not found"), { statusCode: 404 });
        const payment = await Payment.findById(refund.paymentId).session(session);
        if (!payment) {
          // A provider event cannot be durably correlated without its parent Payment.
          // Fail the whole transaction so neither event evidence nor Refund state lies
          // about successful processing; a later retry can succeed after data repair.
          throw Object.assign(new Error("Refund payment not found"), { statusCode: 409 });
        }

        const seen = await PaymentEvent.findOne({ provider: providerName, eventId }).session(session)
          .select("eventType refundId paymentId");
        if (seen) {
          if (seen.eventType === "refund" && String(seen.refundId || "") === String(refund._id)) {
            output = { refund, payment, duplicate: true };
            return;
          }
          throw Object.assign(new Error("Provider event identity conflict"), { statusCode: 409 });
        }

        const normalized = normalizeProviderResult({
          refundReference: reference,
          providerRefundId: event.providerRefundId || null,
          status: event.status,
          amount: Number(event.amount),
          currency: String(event.currency)
        }, refund);

        await PaymentEvent.create([{
          provider: providerName,
          eventId,
          externalPaymentId: String(payment.externalPaymentId),
          paymentId: payment._id,
          eventType: "refund",
          refundId: refund._id,
          eventStatus: `refund_${normalized.status}`,
          amount: normalized.amount,
          currency: normalized.currency,
          processedAt: new Date()
        }], { session });

        const applied = await applyResultInSession({ refund, providerName, result: normalized, session });
        output = applied?.refund ? applied : { refund: applied, payment: null, duplicate: false };
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const existing = await PaymentEvent.findOne({ provider: providerName, eventId })
        .select("eventType refundId paymentId").lean();
      if (!existing || existing.eventType !== "refund") throw error;
      const refund = await Refund.findById(existing.refundId);
      const payment = await Payment.findById(existing.paymentId);
      if (!refund || !payment || refund.reference !== reference) throw error;
      output = { refund, payment, duplicate: true };
    }
    return output;
  } finally {
    await session.endSession();
  }
}