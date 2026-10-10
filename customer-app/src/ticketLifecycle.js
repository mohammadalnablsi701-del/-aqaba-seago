const PRESENTATION = Object.freeze({
  ready: { label: "Ready for check-in", clientStatus: "confirmed", tone: "ready" },
  checked_in: { label: "Checked in", clientStatus: "used", tone: "used" },
  booking_cancelled: { label: "Booking cancelled", clientStatus: "cancelled", tone: "cancelled" },
  refunded: { label: "Refunded", clientStatus: "refunded", tone: "refunded" },
  departure_cancelled: { label: "Departure cancelled", clientStatus: "Departure_cancelled", tone: "cancelled" },
  trip_completed: { label: "Trip completed", clientStatus: "Trip_completed", tone: "past" },
  unavailable: { label: "Ticket unavailable", clientStatus: "Ticket_unavailable", tone: "unavailable" }
});

export function deriveCustomerTicketState(booking) {
  const lifecycle = booking?.ticketLifecycle || {};
  const requestedState = String(lifecycle.state || "unavailable");
  const known = Object.hasOwn(PRESENTATION, requestedState) ? requestedState : "unavailable";
  const ready = known === "ready" && lifecycle.usable === true && lifecycle.used !== true;
  const state = ready ? "ready" : known === "ready" ? "unavailable" : known;
  const presentation = PRESENTATION[state];
  const used = lifecycle.used === true || state === "checked_in";

  return {
    state,
    label: presentation.label,
    clientStatus: presentation.clientStatus,
    tone: presentation.tone,
    ready,
    used,
    showQr: ready
  };
}

// App.jsx still consumes the legacy booking.status display field. Adapt only the
// customer-side copy of the DTO while preserving the persisted booking status in
// bookingStatus. A non-ready lifecycle never maps to "confirmed", so the existing
// Ready/QR branches fail closed without duplicating backend eligibility rules.
export function applyCustomerTicketState(booking) {
  const presentation = deriveCustomerTicketState(booking);
  return {
    ...booking,
    bookingStatus: booking?.status,
    status: presentation.clientStatus,
    ticketPresentation: presentation
  };
}
