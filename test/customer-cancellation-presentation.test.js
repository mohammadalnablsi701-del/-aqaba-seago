import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  cancellationDialogModel,
  cancellationErrorCopy,
  isSelfServiceCancellationEligible,
  normalizeCancellationPolicy,
  refundStatusPresentation
} from "../customer-app/src/cancellationPresentation.js";

const eligibleBooking = {
  _id: "68e91b8faabbccddeeff0011",
  bookingStatus: "confirmed",
  ticketPresentation: { state: "ready", ready: true, showQr: true },
  tripId: { titleEn: "Sea Breeze Cruise" },
  departureId: { startsAt: "2026-10-12T13:00:00.000Z", status: "scheduled" },
  pricing: { grossAmount: 9999, currency: "JOD" }
};

const serverPolicy = {
  refundPercentage: 75,
  refundAmount: 30,
  hoursBeforeDeparture: 18,
  currency: "JOD",
  rules: [{ label: "Server rule", refundPercentage: 75 }]
};

test("only backend-ready customer ticket truth enables self-service cancellation", () => {
  assert.equal(isSelfServiceCancellationEligible(eligibleBooking), true);
  for (const booking of [
    { ...eligibleBooking, bookingStatus: "cancelled" },
    { ...eligibleBooking, ticketPresentation: { state: "checked_in", ready: false, showQr: false } },
    { ...eligibleBooking, ticketPresentation: { state: "departure_cancelled", ready: false, showQr: false } },
    { ...eligibleBooking, ticketPresentation: { state: "trip_completed", ready: false, showQr: false } },
    { ...eligibleBooking, ticketPresentation: { state: "ready", ready: false, showQr: false } }
  ]) assert.equal(isSelfServiceCancellationEligible(booking), false);
});

test("policy preview preserves authoritative server percentage and amount", () => {
  assert.deepEqual(normalizeCancellationPolicy(serverPolicy), serverPolicy);
  const model = cancellationDialogModel(eligibleBooking, serverPolicy);
  assert.equal(model.tripTitle, "Sea Breeze Cruise");
  assert.equal(model.departureAt, eligibleBooking.departureId.startsAt);
  assert.equal(model.refundPercentage, 75);
  assert.equal(model.refundAmount, 30);
  assert.equal(model.currency, "JOD");
  assert.equal(model.refundAmount, serverPolicy.refundAmount, "frontend must use the server refund amount, not booking gross pricing");
});

test("invalid or incomplete financial preview fails closed", () => {
  assert.equal(normalizeCancellationPolicy(null), null);
  assert.equal(normalizeCancellationPolicy({ refundPercentage: 50, currency: "JOD" }), null);
  assert.equal(normalizeCancellationPolicy({ ...serverPolicy, refundAmount: -1 }), null);
  assert.equal(normalizeCancellationPolicy({ ...serverPolicy, refundPercentage: 101 }), null);
  assert.equal(cancellationDialogModel(eligibleBooking, null), null);
});

test("customer-facing cancellation errors do not expose backend internals", () => {
  assert.equal(cancellationErrorCopy({ status: 404, message: "Booking not found" }), "This booking can no longer be cancelled.");
  assert.equal(cancellationErrorCopy({ status: 409, message: "Checked-in bookings cannot be cancelled" }), "This booking has already been used and can no longer be cancelled.");
  assert.equal(cancellationErrorCopy({ status: 409, message: "Payment requires reconciliation before cancellation" }), "Unable to cancel right now. Please contact support.");
  assert.equal(cancellationErrorCopy({ status: 500, message: "MongoServerError: secret internal detail" }), "Unable to cancel right now. Please try again.");
});

test("refund wording distinguishes cancellation success from refund state", () => {
  assert.equal(refundStatusPresentation("pending").label, "Refund pending");
  assert.equal(refundStatusPresentation("processed").label, "Refund completed");
  assert.equal(refundStatusPresentation("failed").label, "Refund failed");
  assert.equal(refundStatusPresentation("none").label, "No refund due");
});

test("cancellation UI has no browser confirm and no authoritative local refund calculation", () => {
  const source = fs.readFileSync(new URL("../customer-app/src/cancellationUi.js", import.meta.url), "utf8");
  assert.equal(source.includes("window.confirm"), false);
  assert.equal(source.includes("window.alert"), false);
  assert.equal(/grossAmount\s*[*\/]/.test(source), false);
  assert.equal(/refundPercentage\s*\/\s*100/.test(source), false);
  assert.match(source, /getCancellationPolicy\(booking\._id, auth\.token\)/);
  assert.match(source, /cancelBooking\(booking\._id, undefined, auth\.token\)/);
  assert.match(source, /The final refund is rechecked by SeaGo when you confirm cancellation/);
  assert.match(source, /Open My Tickets and choose Cancel booking when the booking is eligible/);
});
