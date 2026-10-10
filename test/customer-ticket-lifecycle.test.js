import test from "node:test";
import assert from "node:assert/strict";
import { deriveTicketLifecycle } from "../src/services/ticketLifecycle.js";
import { ticketPdfPresentation } from "../src/services/ticketPdf.js";
import { applyCustomerTicketState, deriveCustomerTicketState } from "../customer-app/src/ticketLifecycle.js";

const future = new Date(Date.now() + 86400000);
const past = new Date(Date.now() - 86400000);

function booking({ status = "confirmed", departureStatus = "scheduled", startsAt = future, checkedInAt = null } = {}) {
  return {
    status,
    checkedInAt,
    departureId: { status: departureStatus, startsAt }
  };
}

function customerBooking(input) {
  const source = booking(input);
  return {
    ...source,
    ticketLifecycle: deriveTicketLifecycle(source)
  };
}

test("confirmed + scheduled + unused is ready and QR-usable", () => {
  const source = booking();
  const lifecycle = deriveTicketLifecycle(source);
  assert.deepEqual(lifecycle, { state: "ready", usable: true, used: false });
  const customer = deriveCustomerTicketState({ ticketLifecycle: lifecycle });
  assert.equal(customer.ready, true);
  assert.equal(customer.showQr, true);
  assert.equal(customer.clientStatus, "confirmed");
  assert.equal(ticketPdfPresentation(source).activeQr, true);
});

test("checked-in truth wins over later departure completion", () => {
  const checkedInAt = new Date();
  const lifecycle = deriveTicketLifecycle(booking({ departureStatus: "completed", checkedInAt }));
  assert.deepEqual(lifecycle, { state: "checked_in", usable: false, used: true });
  const customer = deriveCustomerTicketState({ ticketLifecycle: lifecycle });
  assert.equal(customer.label, "Checked in");
  assert.equal(customer.showQr, false);
});

test("cancelled booking is historical and never ready", () => {
  const lifecycle = deriveTicketLifecycle(booking({ status: "cancelled" }));
  assert.equal(lifecycle.state, "booking_cancelled");
  assert.equal(lifecycle.usable, false);
  const customer = deriveCustomerTicketState({ ticketLifecycle: lifecycle });
  assert.equal(customer.label, "Booking cancelled");
  assert.equal(customer.showQr, false);
});

test("refunded booking is historical and never ready", () => {
  const lifecycle = deriveTicketLifecycle(booking({ status: "refunded" }));
  assert.equal(lifecycle.state, "refunded");
  assert.equal(lifecycle.usable, false);
  assert.equal(deriveCustomerTicketState({ ticketLifecycle: lifecycle }).label, "Refunded");
});

test("confirmed booking on cancelled departure is not ready", () => {
  const source = booking({ departureStatus: "cancelled" });
  const lifecycle = deriveTicketLifecycle(source);
  assert.deepEqual(lifecycle, { state: "departure_cancelled", usable: false, used: false });
  const adapted = applyCustomerTicketState({ status: "confirmed", ticketLifecycle: lifecycle });
  assert.equal(adapted.bookingStatus, "confirmed");
  assert.equal(adapted.status, "Departure_cancelled");
  assert.notEqual(adapted.status, "confirmed");
  assert.equal(adapted.ticketPresentation.showQr, false);
  assert.equal(ticketPdfPresentation(source).activeQr, false);
});

test("confirmed booking on completed departure becomes trip completed", () => {
  const source = booking({ departureStatus: "completed" });
  const lifecycle = deriveTicketLifecycle(source);
  assert.deepEqual(lifecycle, { state: "trip_completed", usable: false, used: false });
  const adapted = applyCustomerTicketState({ status: "confirmed", ticketLifecycle: lifecycle });
  assert.equal(adapted.status, "Trip_completed");
  assert.equal(adapted.ticketPresentation.label, "Trip completed");
  assert.equal(adapted.ticketPresentation.showQr, false);
  assert.equal(ticketPdfPresentation(source).activeQr, false);
});

test("current backend contract does not invalidate scheduled tickets by startsAt time", () => {
  const futureLifecycle = deriveTicketLifecycle(booking({ startsAt: future }));
  const pastLifecycle = deriveTicketLifecycle(booking({ startsAt: past }));
  assert.deepEqual(pastLifecycle, futureLifecycle);
  assert.equal(pastLifecycle.state, "ready");
  assert.equal(pastLifecycle.usable, true);
});

test("missing or unknown departure lifecycle fails closed", () => {
  assert.deepEqual(deriveTicketLifecycle({ status: "confirmed", checkedInAt: null }), {
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
