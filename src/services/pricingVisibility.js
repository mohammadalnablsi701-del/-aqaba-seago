// Only sale prices belong in public/customer responses. New financial fields
// remain private unless they are explicitly added to this allowlist.
const SALE_FIELDS = [
  "currency", "pricePerPerson", "adultPrice", "childPrice",
  "buffetEnabled", "buffetAdultPrice", "buffetChildPrice", "buffetDescription",
  "unitPrice", "adultUnitPrice", "childUnitPrice", "adultSubtotal",
  "childSubtotal", "grossAmount"
];

export function salePricing(pricing = {}) {
  const source = pricing?.toObject ? pricing.toObject() : (pricing || {});
  return Object.fromEntries(SALE_FIELDS
    .filter(key => source[key] !== undefined)
    .map(key => [key, source[key]]));
}

export function tripForAudience(trip, { viewFinance = false } = {}) {
  const obj = trip?.toObject ? trip.toObject() : { ...trip };
  return { ...obj, pricing: viewFinance ? obj.pricing : salePricing(obj.pricing) };
}
