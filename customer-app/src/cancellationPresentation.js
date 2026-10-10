export function isSelfServiceCancellationEligible(booking) {
  return booking?.bookingStatus === "confirmed"
    && booking?.ticketPresentation?.state === "ready"
    && booking?.ticketPresentation?.ready === true
    && booking?.ticketPresentation?.showQr === true;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeCancellationPolicy(payload) {
  if (!payload || typeof payload !== "object") return null;
  const refundPercentage = finiteNumber(payload.refundPercentage);
  const refundAmount = finiteNumber(payload.refundAmount);
  const hoursBeforeDeparture = finiteNumber(payload.hoursBeforeDeparture);
  const currency = typeof payload.currency === "string" ? payload.currency.trim() : "";
  if (refundPercentage === null || refundPercentage < 0 || refundPercentage > 100
    || refundAmount === null || refundAmount < 0 || hoursBeforeDeparture === null || !currency) return null;

  const rules = Array.isArray(payload.rules)
    ? payload.rules.flatMap(rule => {
        const percentage = finiteNumber(rule?.refundPercentage);
        const label = typeof rule?.label === "string" ? rule.label.trim() : "";
        return label && percentage !== null && percentage >= 0 && percentage <= 100
          ? [{ label, refundPercentage: percentage }]
          : [];
      })
    : [];

  return { refundPercentage, refundAmount, hoursBeforeDeparture, currency, rules };
}

export function cancellationDialogModel(booking, policy) {
  const normalized = normalizeCancellationPolicy(policy);
  if (!booking || !normalized) return null;
  const trip = booking.tripId || {};
  return {
    bookingId: booking._id || null,
    tripTitle: trip.titleEn || trip.titleAr || "Aqaba Sea Experience",
    departureAt: booking.departureId?.startsAt || null,
    refundPercentage: normalized.refundPercentage,
    refundAmount: normalized.refundAmount,
    currency: normalized.currency,
    rules: normalized.rules
  };
}

export function cancellationErrorCopy(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || "").toLowerCase();
  if (status === 401) return "Please sign in again to manage this booking.";
  if (status === 404) return "This booking can no longer be cancelled.";
  if (status === 409 && message.includes("checked-in")) return "This booking has already been used and can no longer be cancelled.";
  if (status === 409 && (message.includes("can no longer") || message.includes("requires cancellation review"))) {
    return "This booking can no longer be cancelled.";
  }
  if (status === 409 && (message.includes("reconciliation") || message.includes("reserved seats"))) {
    return "Unable to cancel right now. Please contact support.";
  }
  return "Unable to cancel right now. Please try again.";
}

export function refundStatusPresentation(status) {
  switch (String(status || "none")) {
    case "pending": return { label: "Refund pending", copy: "Your cancellation is complete. The refund is pending processing." };
    case "processed": return { label: "Refund completed", copy: "Your cancellation and refund were processed successfully." };
    case "failed": return { label: "Refund failed", copy: "Your booking is cancelled, but the refund needs support review." };
    default: return { label: "No refund due", copy: "Your booking is cancelled. No refund is due under the cancellation policy." };
  }
}
