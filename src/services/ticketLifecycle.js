export const CUSTOMER_TICKET_STATES = Object.freeze({
  READY: "ready",
  CHECKED_IN: "checked_in",
  BOOKING_CANCELLED: "booking_cancelled",
  REFUNDED: "refunded",
  DEPARTURE_CANCELLED: "departure_cancelled",
  TRIP_COMPLETED: "trip_completed",
  UNAVAILABLE: "unavailable"
});

/**
 * Derive ticket usability from the same persisted Booking + Departure facts that
 * the validator/check-in flow uses. startsAt is intentionally not considered:
 * the current backend contract treats any scheduled departure as open for
 * check-in regardless of whether its startsAt timestamp has passed.
 */
export function deriveTicketLifecycle(booking) {
  const bookingStatus = String(booking?.status || "");
  const departureStatus = String(booking?.departureId?.status || booking?.departure?.status || "");
  const used = Boolean(booking?.checkedInAt);

  if (bookingStatus === "refunded") {
    return { state: CUSTOMER_TICKET_STATES.REFUNDED, usable: false, used };
  }

  if (bookingStatus === "cancelled") {
    return { state: CUSTOMER_TICKET_STATES.BOOKING_CANCELLED, usable: false, used };
  }

  if (bookingStatus !== "confirmed") {
    return { state: CUSTOMER_TICKET_STATES.UNAVAILABLE, usable: false, used };
  }

  // Preserve historical check-in truth even if the departure is completed later.
  if (used) {
    return { state: CUSTOMER_TICKET_STATES.CHECKED_IN, usable: false, used: true };
  }

  if (departureStatus === "cancelled") {
    return { state: CUSTOMER_TICKET_STATES.DEPARTURE_CANCELLED, usable: false, used: false };
  }

  if (departureStatus === "completed") {
    return { state: CUSTOMER_TICKET_STATES.TRIP_COMPLETED, usable: false, used: false };
  }

  if (departureStatus === "scheduled") {
    return { state: CUSTOMER_TICKET_STATES.READY, usable: true, used: false };
  }

  return { state: CUSTOMER_TICKET_STATES.UNAVAILABLE, usable: false, used: false };
}

export function isTicketUsable(booking) {
  return deriveTicketLifecycle(booking).usable;
}
