export const PLATFORM_STATUS = Object.freeze({ ALLOWED: "allowed", PAUSED: "paused" });

export function tripPlatformStatus(trip) {
  return trip?.platformStatus === PLATFORM_STATUS.PAUSED ? PLATFORM_STATUS.PAUSED : PLATFORM_STATUS.ALLOWED;
}

export function platformAllowsSales(trip) {
  return tripPlatformStatus(trip) === PLATFORM_STATUS.ALLOWED;
}

export function isTripSellable({ trip, provider }) {
  return Boolean(trip?.active === true && platformAllowsSales(trip) && provider?.status === "approved");
}

// $ne intentionally matches legacy documents where platformStatus is missing.
// That preserves pre-Task-7 commercial behavior without a production migration.
export function sellableTripFilter(extra = {}) {
  return { ...extra, active: true, platformStatus: { $ne: PLATFORM_STATUS.PAUSED } };
}
