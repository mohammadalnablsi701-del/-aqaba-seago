import test from "node:test";
import assert from "node:assert/strict";
import { deriveTicketLifecycle, ticketOperationalCutoff } from "../src/services/ticketLifecycle.js";
import { ticketPdfPresentation } from "../src/services/ticketPdf.js";
import { applyCustomerTicketState, deriveCustomerTicketState } from "../customer-app/src/ticketLifecycle.js";

const future = new Date("2030-01-01T12:00:00.000Z");
const baseNow = new Date("2030-01-01T10:00:00.000Z");

function booking({ status = "confirmed", departureStatus = "scheduled", startsAt = future, durationMinutes = 60, checkedInAt = null } = {}) {
  return {
    status,
    checkedInAt,
    tripId: durationMinutes === undefined ? {} : { durationMinutes },
    departureId: { status: departureStatus, startsAt }
  };
}

function customerBooking(input, now = baseNow) {
  const source = booking(input);
  return {
    ...source,
    ticketLifecycle: deriveTicketLifecycle(source, { now })
  };
}

test("confirmed + scheduled + future is ready and QR-usable", () => {
  const source = booking();
  const lifecycle = deriveTicketLifecycle(source, { now: baseNow });
  assert.deepEqual(lifecycle, { state: "ready", usable: true, used: false });
  const customer = deriveCustomerTicketState({ ticketLifecycle: lifecycle });
  assert.equal(customer.label, "Ready for check-in");
  assert.equal(customer.ready, true);
  assert.equal(customer.showQr, true);
  assert.equal(customer.clientStatus, "confirmed");
  assert.equal(ticketPdfPresentation(source, { now: baseNow }).activeQr, true);
});

test("scheduled departure remains operational after start while inside its planned duration", () => {
  const source = booking({ startsAt: new Date("2030-01-01T09:30:00.000Z"), durationMinutes: 60 });
  assert.deepEqual(deriveTicketLifecycle(source, { now: baseNow }), { state: "ready", usable: true, used: false });
});

test("scheduled departure expires exactly at startsAt + durationMinutes", () => {
  const source = booking({ startsAt: new Date("2030-01-01T09:00:00.000Z"), durationMinutes: 60 });
  assert.equal(ticketOperationalCutoff(source).toISOString(), "2030-01-01T10:00:00.000Z");

  assert.deepEqual(
    deriveTicketLifecycle(source, { now: new Date("2030-01-01T09:59:59.999Z") }),
    { state: "ready", usable: true, used: false }
  );
  assert.deepEqual(
    deriveTicketLifecycle(source, { now: new Date("2030-01-01T10:00:00.000Z") }),
    { state: "departure_expired", usable: false, used: false }
  );
  assert.deepEqual(
    deriveTicketLifecycle(source, { now: new Date("2030-01-01T10:00:00.001Z") }),
    { state: "departure_expired", usable: false, used: false }
  );
});

test("UTC ISO instants drive comparison without Jordan display arithmetic", () => {
  const source = booking({ startsAt: "2030-06-01T08:00:00.000Z", durationMinutes: 60 });
  assert.equal(deriveTicketLifecycle(source, { now: "2030-06-01T08:59:59.999Z" }).state, "ready");
  assert.equal(deriveTicketLifecycle(source, { now: "2030-06-01T09:00:00.000Z" }).state, "departure_expired");
});

test("checked-in truth wins over later departure completion or expiry", () => {
  const checkedInAt = new Date("2030-01-01T09:30:00.000Z");
  const completed = deriveTicketLifecycle(booking({ departureStatus: "completed", checkedInAt }), { now: baseNow });
  assert.deepEqual(completed, { state: "checked_in", usable: false, used: true });

  const expired = deriveTicketLifecycle(booking({ startsAt: new Date("2030-01-01T08:00:00.000Z"), checkedInAt }), { now: baseNow });
  assert.deepEqual(expired, { state: "checked_in", usable: false, used: true });
  const customer = deriveCustomerTicketState({ ticketLifecycle: expired });
  assert.equal(customer.label, "Checked in");
  assert.equal(customer.showQr, false);
});

test("cancelled booking is historical and never ready", () => {
  const lifecycle = deriveTicketLifecycle(booking({ status: "cancelled" }), { now: baseNow });
  assert.equal(lifecycle.state, "booking_cancelled");
  assert.equal(lifecycle.usable, false);
  const customer = deriveCustomerTicketState({ ticketLifecycle: lifecycle });
  assert.equal(customer.label, "Booking cancelled");
  assert.equal(customer.showQr, false);
});

test("refunded booking is historical and never ready", () => {
  const lifecycle = deriveTicketLifecycle(booking({ status: "refunded" }), { now: baseNow });
  assert.equal(lifecycle.state, "refunded");
  assert.equal(lifecycle.usable, false);
  assert.equal(deriveCustomerTicketState({ ticketLifecycle: lifecycle }).label, "Refunded");
});

test("confirmed booking on cancelled departure is not ready", () => {
  const source = booking({ departureStatus: "cancelled" });
  const lifecycle = deriveTicketLifecycle(source, { now: baseNow });
  assert.deepEqual(lifecycle, { state: "departure_cancelled", usable: false, used: false });
  const adapted = applyCustomerTicketState({ status: "confirmed", ticketLifecycle: lifecycle });
  assert.equal(adapted.bookingStatus, "confirmed");
  assert.equal(adapted.status, "Departure_cancelled");
  assert.equal(adapted.ticketPresentation.label, "Departure cancelled");
  assert.notEqual(adapted.status, "confirmed");
  assert.equal(adapted.ticketPresentation.showQr, false);
  assert.equal(ticketPdfPresentation(source, { now: baseNow }).activeQr, false);
});

test("confirmed booking on completed departure becomes trip completed", () => {
  const source = booking({ departureStatus: "completed" });
  const lifecycle = deriveTicketLifecycle(source, { now: baseNow });
  assert.deepEqual(lifecycle, { state: "trip_completed", usable: false, used: false });
  const adapted = applyCustomerTicketState({ status: "confirmed", ticketLifecycle: lifecycle });
  assert.equal(adapted.status, "Trip_completed");
  assert.equal(adapted.ticketPresentation.label, "Trip completed");
  assert.equal(adapted.ticketPresentation.showQr, false);
  assert.equal(ticketPdfPresentation(source, { now: baseNow }).activeQr, false);
});

test("stale scheduled departure is expired in API, customer presentation, and PDF", () => {
  const source = booking({ startsAt: new Date("2030-01-01T08:00:00.000Z"), durationMinutes: 60 });
  const lifecycle = deriveTicketLifecycle(source, { now: baseNow });
  assert.deepEqual(lifecycle, { state: "departure_expired", usable: false, used: false });
  const customer = deriveCustomerTicketState({ ticketLifecycle: lifecycle });
  assert.equal(customer.label, "Trip ended");
  assert.equal(customer.ready, false);
  assert.equal(customer.showQr, false);
  assert.equal(ticketPdfPresentation(source, { now: baseNow }).activeQr, false);
});

test("missing or invalid startsAt fails closed", () => {
  const missing = booking({ startsAt: undefined });
  missing.departureId = { status: "scheduled" };
  assert.deepEqual(deriveTicketLifecycle(missing, { now: baseNow }), {
    state: "unavailable", usable: false, used: false
  });

  const invalid = booking({ startsAt: "not-a-date" });
  assert.deepEqual(deriveTicketLifecycle(invalid, { now: baseNow }), {
    state: "unavailable", usable: false, used: false
  });
});

test("missing or invalid trip duration fails closed instead of creating an infinite window", () => {
  const missing = booking({ durationMinutes: undefined });
  assert.equal(deriveTicketLifecycle(missing, { now: baseNow }).state, "unavailable");
  const invalid = booking({ durationMinutes: "not-a-number" });
  assert.equal(deriveTicketLifecycle(invalid, { now: baseNow }).state, "unavailable");
});

test("missing or unknown departure lifecycle fails closed", () => {
  assert.deepEqual(deriveTicketLifecycle({ status: "confirmed", checkedInAt: null, tripId: { durationMinutes: 60 } }, { now: baseNow }), {
    state: "unavailable", usable: false, used: false
  });
  const customer = deriveCustomerTicketState({ ticketLifecycle: { state: "ready", usable: false, used: false } });
  assert.equal(customer.state, "unavailable");
  assert.equal(customer.showQr, false);
});

test("frontend presentation never maps backend-rejected lifecycle states to confirmed", () => {
  const rejected = [
    customerBooking({ status: "cancelled" }),
    customerBooking({ status: "refunded" }),
    customerBooking({ departureStatus: "cancelled" }),
    customerBooking({ departureStatus: "completed" }),
    customerBooking({ startsAt: new Date("2030-01-01T08:00:00.000Z") }),
    customerBooking({ checkedInAt: new Date() }),
    { status: "confirmed", ticketLifecycle: { state: "unavailable", usable: false, used: false } }
  ];
  for (const row of rejected) {
    const adapted = applyCustomerTicketState(row);
    assert.notEqual(adapted.status, "confirmed");
    assert.equal(adapted.ticketPresentation.showQr, false);
  }
});

test("missing customer lifecycle DTO fails closed instead of inferring from booking status", () => {
  const adapted = applyCustomerTicketState({ status: "confirmed", departureId: { status: "scheduled" } });
  assert.equal(adapted.bookingStatus, "confirmed");
  assert.equal(adapted.status, "Ticket_unavailable");
  assert.equal(adapted.ticketPresentation.ready, false);
  assert.equal(adapted.ticketPresentation.showQr, false);
});
