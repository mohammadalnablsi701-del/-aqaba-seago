export const PLATFORM_STATUS = Object.freeze({ ALLOWED: "allowed", PAUSED: "paused" });

export function tripPlatformStatus(trip) {
  return trip?.platformStatus === PLATFORM_STATUS.PAUSED ? PLATFORM_STATUS.PAUSED : PLATFORM_STATUS.ALLOWED;
}

export function platformAllowsSales(trip) {
  return tripPlatformStatus(trip) === PLATFORM_STATUS.ALLOWED;
}

// Trip-level sales eligibility only. A real purchase still requires a
// scheduled, open, future departure with enough remaining capacity.
export function isTripSellable({ trip, provider }) {
  return Boolean(trip?.active === true && platformAllowsSales(trip) && provider?.status === "approved");
}

export function tripSalesSemantics({ trip, provider, hasSellableDeparture = false }) {
  const providerActive = trip?.active === true;
  const platformAllowed = platformAllowsSales(trip);
  const providerApproved = provider?.status === "approved";
  const salesEligible = isTripSellable({ trip, provider });
  const sellableNow = Boolean(salesEligible && hasSellableDeparture);

  let state = "no_sellable_departure";
  if (!providerApproved) state = "provider_blocked";
  else if (!providerActive) state = "provider_paused";
  else if (!platformAllowed) state = "platform_paused";
  else if (sellableNow) state = "sellable_now";

  return { providerActive, platformAllowed, providerApproved, salesEligible, sellableNow, state };
}

// Reporting/readiness definition for "sellable now": at least one customer
// can buy one seat now. Checkout remains authoritative for the requested
// party size and continues to apply its own atomic capacity gate.
export function sellableNowDepartureFilter(extra = {}, now = new Date()) {
  return {
    ...extra,
    status: "scheduled",
    salesClosed: { $ne: true },
    startsAt: { $gt: now },
    $expr: {
      $gt: [
        { $ifNull: ["$capacity", 0] },
        { $ifNull: ["$reservedSeats", 0] }
      ]
    }
  };
}

// $ne intentionally matches legacy documents where platformStatus is missing.
// That preserves pre-Task-7 commercial behavior without a production migration.
export function sellableTripFilter(extra = {}) {
  return { ...extra, active: true, platformStatus: { $ne: PLATFORM_STATUS.PAUSED } };
}
