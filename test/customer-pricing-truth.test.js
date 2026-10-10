import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pricingViewFromQuote, formatServerMoney, createQuoteRequestGate, quoteMatchesSelection } from "../customer-app/src/pricingTruth.js";
import { salePricing } from "../src/services/pricingVisibility.js";

function quote(overrides = {}) {
  return {
    departureId: "dep-1",
    adults: 2,
    children: 1,
    mealPlan: "without_buffet",
    pricing: {
      currency: "JOD",
      adultUnitPrice: 15,
      childUnitPrice: 10,
      adultSubtotal: 30,
      childSubtotal: 10,
      grossAmount: 40,
      ...overrides.pricing
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "pricing"))
  };
}

test("A: adult-only display model is server quote truth", () => {
  const view = pricingViewFromQuote(quote({ children: 0, pricing: { childSubtotal: 0, grossAmount: 30 } }));
  assert.equal(view.adultUnitPrice, 15);
  assert.equal(view.adultSubtotal, 30);
  assert.equal(view.grossAmount, 30);
});

test("B/H: adult + child line items and total are the server response fields", () => {
  const view = pricingViewFromQuote(quote());
  assert.deepEqual(view, {
    currency: "JOD", adultUnitPrice: 15, childUnitPrice: 10,
    adultSubtotal: 30, childSubtotal: 10, grossAmount: 40,
    mealPlan: "without_buffet"
  });
  assert.equal(view.adultSubtotal + view.childSubtotal, view.grossAmount);
});

test("C/D: buffet semantics use the quoted package prices and no stale add-on", () => {
  const buffet = pricingViewFromQuote(quote({
    mealPlan: "with_buffet",
    pricing: { adultUnitPrice: 20, childUnitPrice: 14, adultSubtotal: 40, childSubtotal: 14, grossAmount: 54 }
  }));
  assert.equal(buffet.mealPlan, "with_buffet");
  assert.equal(buffet.adultUnitPrice, 20);
  assert.equal(buffet.childUnitPrice, 14);
  assert.equal(buffet.grossAmount, 54);
  const noBuffet = pricingViewFromQuote(quote());
  assert.equal(noBuffet.mealPlan, "without_buffet");
  assert.equal(noBuffet.adultUnitPrice, 15);
});

test("E: currency is taken from the server quote", () => {
  const view = pricingViewFromQuote(quote({ pricing: { currency: "USD" } }));
  assert.equal(formatServerMoney(view.grossAmount, view.currency), "40.00 USD");
});

test("F/G: critical BookingScreen no longer reconstructs quote pricing from Trip snapshot", () => {
  const source = fs.readFileSync(new URL("../customer-app/src/App.jsx", import.meta.url), "utf8");
  const booking = source.slice(source.indexOf("function BookingScreen"), source.indexOf("function FavouritesScreen"));
  for (const forbidden of ["baseAdultPrice", "baseChildPrice", "buffetAdultAddOn", "buffetChildAddOn", "buffetAddOnSubtotal", "baseTripSubtotal"])
    assert.equal(booking.includes(forbidden), false, `BookingScreen still contains ${forbidden}`);
  assert.match(booking, /pricingViewFromQuote\(currentQuote\)/);
  assert.match(booking, /formatServerMoney\(/);
});

test("I/J: rapid quote changes explicitly abort and invalidate stale requests", () => {
  const gate = createQuoteRequestGate();
  const first = gate.begin();
  assert.equal(first.isCurrent(), true);
  const second = gate.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  gate.invalidate();
  assert.equal(second.signal.aborted, true);
  assert.equal(second.isCurrent(), false);
});

test("K: invalid/missing quote money never becomes a fake zero total", () => {
  assert.equal(pricingViewFromQuote({ pricing: { currency: "JOD" } }), null);
  assert.equal(formatServerMoney(undefined, "JOD"), "—");
  assert.equal(formatServerMoney(20, ""), "—");
});

test("selection matching prevents an old quote being rendered for new choices", () => {
  const q = quote();
  assert.equal(quoteMatchesSelection(q, { departureId: "dep-1", adults: 2, children: 1, mealPlan: "without_buffet" }), true);
  assert.equal(quoteMatchesSelection(q, { departureId: "dep-1", adults: 3, children: 0, mealPlan: "without_buffet" }), false);
});

test("O: public pricing allowlist does not expose commission or provider net", () => {
  const publicPricing = salePricing({
    currency: "JOD", adultUnitPrice: 15, childUnitPrice: 10,
    adultSubtotal: 30, childSubtotal: 10, grossAmount: 40,
    commissionAmount: 8, providerNetAmount: 32, commissionType: "percentage"
  });
  assert.deepEqual(publicPricing, {
    currency: "JOD", adultUnitPrice: 15, childUnitPrice: 10,
    adultSubtotal: 30, childSubtotal: 10, grossAmount: 40
  });
});

test("P: valid zero-valued quoted prices survive without truthy fallbacks", () => {
  const view = pricingViewFromQuote(quote({
    adults: 1, children: 1,
    pricing: { adultUnitPrice: 10, childUnitPrice: 0, adultSubtotal: 10, childSubtotal: 0, grossAmount: 10 }
  }));
  assert.equal(view.childUnitPrice, 0);
  assert.equal(view.childSubtotal, 0);
  assert.equal(formatServerMoney(view.childSubtotal, view.currency), "0.00 JOD");
});
