function finiteMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function quoteMatchesSelection(quote, { departureId, adults, children, mealPlan }) {
  if (!quote || departureId === null || departureId === undefined) return false;
  return String(quote.departureId) === String(departureId)
    && Number(quote.adults) === Number(adults)
    && Number(quote.children) === Number(children)
    && quote.mealPlan === mealPlan;
}

export function pricingViewFromQuote(quote) {
  const pricing = quote?.pricing;
  if (!pricing || typeof pricing !== "object") return null;

  const currency = typeof pricing.currency === "string" ? pricing.currency.trim() : "";
  const adultUnitPrice = finiteMoney(pricing.adultUnitPrice);
  const childUnitPrice = finiteMoney(pricing.childUnitPrice);
  const adultSubtotal = finiteMoney(pricing.adultSubtotal);
  const childSubtotal = finiteMoney(pricing.childSubtotal);
  const grossAmount = finiteMoney(pricing.grossAmount);

  if (!currency || adultUnitPrice === null || childUnitPrice === null
    || adultSubtotal === null || childSubtotal === null || grossAmount === null) return null;

  return {
    currency,
    adultUnitPrice,
    childUnitPrice,
    adultSubtotal,
    childSubtotal,
    grossAmount,
    mealPlan: quote.mealPlan
  };
}

export function formatServerMoney(amount, currency) {
  const value = finiteMoney(amount);
  const code = typeof currency === "string" ? currency.trim() : "";
  if (value === null || !code) return "—";
  return `${value.toFixed(2)} ${code}`;
}

export function createQuoteRequestGate() {
  let sequence = 0;
  let activeController = null;

  return {
    begin() {
      sequence += 1;
      activeController?.abort();
      const requestSequence = sequence;
      const controller = new AbortController();
      activeController = controller;
      return {
        signal: controller.signal,
        isCurrent: () => requestSequence === sequence && !controller.signal.aborted,
        abort: () => controller.abort()
      };
    },
    invalidate() {
      sequence += 1;
      activeController?.abort();
      activeController = null;
    }
  };
}
