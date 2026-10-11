export const CUSTOMER_TICKET_STATES = Object.freeze({
  READY: "ready",
  CHECKED_IN: "checked_in",
  BOOKING_CANCELLED: "booking_cancelled",
  REFUNDED: "refunded",
  DEPARTURE_CANCELLED: "departure_cancelled",
  DEPARTURE_EXPIRED: "departure_expired",
  TRIP_COMPLETED: "trip_completed",
  UNAVAILABLE: "unavailable"
});

function validDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function plannedDurationMs(booking) {
  const raw = booking?.tripId?.durationMinutes ?? booking?.trip?.durationMinutes;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return minutes * 60 * 1000;
}

/**
 * Return the latest instant at which a scheduled departure can still be
 * operationally boardable. Aqaba SeaGo has no separate boarding grace policy,
 * so the least-surprising existing business boundary is the trip's own planned
 * end: startsAt + Trip.durationMinutes.
 *
 * Missing/malformed departure time or duration cannot prove time validity and
 * therefore returns null so callers fail closed without mutating historical data.
 */
export function ticketOperationalCutoff(booking) {
  const departure = booking?.departureId || booking?.departure;
  const startsAt = validDate(departure?.startsAt);
  const durationMs = plannedDurationMs(booking);
  if (!startsAt || durationMs === null) return null;
  return new Date(startsAt.getTime() + durationMs);
}

/**
 * Derive live ticket usability from persisted Booking + Departure + Trip facts.
 * `now` is injectable for deterministic boundary tests; production callers use
 * server time. A ticket may remain visible before/after its boarding window, but
 * `usable` only means it is currently boardable.
 */
export function deriveTicketLifecycle(booking, { now = new Date() } = {}) {
  const bookingStatus = String(booking?.status || "");
  const departure = booking?.departureId || booking?.departure;
  const departureStatus = String(departure?.status || "");
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

  // Preserve historical check-in truth even if the departure later completes,
  // is cancelled, or crosses its operational cutoff.
  if (used) {
    return { state: CUSTOMER_TICKET_STATES.CHECKED_IN, usable: false, used: true };
  }

  if (departureStatus === "cancelled") {
    return { state: CUSTOMER_TICKET_STATES.DEPARTURE_CANCELLED, usable: false, used: false };
  }

  if (departureStatus === "completed") {
    return { state: CUSTOMER_TICKET_STATES.TRIP_COMPLETED, usable: false, used: false };
  }

  if (departureStatus !== "scheduled") {
    return { state: CUSTOMER_TICKET_STATES.UNAVAILABLE, usable: false, used: false };
  }

  const currentTime = validDate(now);
  const cutoff = ticketOperationalCutoff(booking);
  if (!currentTime || !cutoff) {
    return { state: CUSTOMER_TICKET_STATES.UNAVAILABLE, usable: false, used: false };
  }

  // Exact planned-end boundary is closed: one millisecond before is valid,
  // the boundary itself and every instant after it are expired.
  if (currentTime.getTime() >= cutoff.getTime()) {
    return { state: CUSTOMER_TICKET_STATES.DEPARTURE_EXPIRED, usable: false, used: false };
  }

  return { state: CUSTOMER_TICKET_STATES.READY, usable: true, used: false };
}

export function isTicketUsable(booking, options) {
  return deriveTicketLifecycle(booking, options).usable;
}
