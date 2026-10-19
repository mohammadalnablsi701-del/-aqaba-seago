import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createQuoteRequestGate, quoteMatchesSelection, pricingViewFromQuote } from "../customer-app/src/pricingTruth.js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const customer = read("customer-app/src/App.jsx");
const booking = customer.slice(customer.indexOf("function BookingScreen"), customer.indexOf("function FavouritesScreen"));
// Execute the production hooks and checkout handler without a DOM or app build.
// The button expression and input callbacks also come from the actual JSX.
const setup = booking.slice(0, booking.indexOf("  const holdRemaining="));
const stateNames = [...setup.matchAll(/const\s*\[([^,]+),[^\]]+\]\s*=\s*useState/g)].map(match => match[1].trim());
const disabled = booking.match(/className="primary-button booking-confirm"[^\n]*?disabled=\{(.*?)\}>/)[1];
const radioChange = booking.match(/type="radio" name="partyType"[^\n]*?onChange=\{([^}]+)\}/)[1];
const acknowledgementChange = booking.match(/type="checkbox" name="partyPolicyConfirmed"[^\n]*?onChange=\{([^}]+)\}/)[1];
const renderBooking = new vm.Script(`${setup}\nreturn {confirm,partyType,partyPolicyConfirmed,partyConfirmed,quote,disabled:(${disabled}),selectParty:(${radioChange}),acknowledge:(${acknowledgementChange})};\n} BookingScreen(props)`);

function harness(overrides = {}) {
  const departure = { id: "departure-1", availableSeats: 10, startsAt: "2099-01-01T12:00:00.000Z" };
  const quote = {
    departureId: departure.id, adults: 2, children: 0, mealPlan: "without_buffet",
    pricing: { currency: "JOD", adultUnitPrice: 15, childUnitPrice: 10, adultSubtotal: 30, childSubtotal: 0, grossAmount: 30 }
  };
  const initial = { selected: departure, departures: [departure], quote, loading: false, ...overrides };
  const states = new Map();
  const refs = [];
  const calls = [];
  let stateIndex = 0;
  let refIndex = 0;
  let key = 0;
  const context = vm.createContext({
    props: { trip: { apiId: "trip-1" }, auth: { token: "synthetic-token", user: { phone: "+962790000000" } } },
    useState: value => {
      const name = stateNames[stateIndex++];
      if (!states.has(name)) states.set(name, Object.hasOwn(initial, name) ? initial[name] : typeof value === "function" ? value() : value);
      return [states.get(name), next => states.set(name, typeof next === "function" ? next(states.get(name)) : next)];
    },
    useRef: value => refs[refIndex++] ||= { current: value },
    useEffect: () => {},
    hasApi: () => true,
    createQuoteRequestGate, quoteMatchesSelection, pricingViewFromQuote,
    crypto: { randomUUID: () => `synthetic-checkout-${++key}` },
    createPaymentCheckout: async payload => {
      calls.push(payload);
      // Keep the form visible and exercise retry keys without a payment handoff.
      throw new Error("Synthetic retryable checkout failure");
    }
  });
  return {
    calls, states, quote,
    render: () => { stateIndex = 0; refIndex = 0; return renderBooking.runInContext(context); }
  };
}

test("booking form starts unselected and presents the required policy acknowledgement", () => {
  const view = harness().render();
  assert.equal(view.partyType, "");
  assert.equal(view.partyPolicyConfirmed, false);
  assert.equal(view.disabled, true);
  for (const partyType of ["family", "couple"]) {
    assert.match(booking, new RegExp(`type="radio" name="partyType" value="${partyType}"[^\\n]*required`));
  }
  assert.match(booking, /type="checkbox" name="partyPolicyConfirmed"[^\n]*required/);
  assert.match(booking, /I confirm that this booking is for a family or couple and complies with the trip policy\./);
});

test("actual checkout button and direct handler both reject incomplete or nonliteral confirmation", async () => {
  for (const [partyType, partyPolicyConfirmed] of [["", false], ["", true], ["family", false], ["couple", false], ["friends", true], ["family", "true"], ["couple", 1]]) {
    const h = harness({ partyType, partyPolicyConfirmed });
    const view = h.render();
    assert.equal(view.disabled, true, `${partyType}/${partyPolicyConfirmed}`);
    await view.confirm();
    assert.equal(h.calls.length, 0, "calling a disabled button handler cannot start checkout");
    assert.match(h.states.get("error"), /Choose Family or Couple and confirm the trip policy/);
  }
});

for (const partyType of ["family", "couple"]) {
  test(`${partyType} selection and acknowledgement enable checkout and send explicit policy fields`, async () => {
    const h = harness();
    h.render().selectParty({ target: { value: partyType } });
    assert.equal(h.render().disabled, true);
    h.render().acknowledge({ target: { checked: true } });
    const view = h.render();
    assert.equal(view.disabled, false);
    assert.equal(view.quote, h.quote, "party selection preserves the authoritative price quote");
    await view.confirm();
    assert.equal(h.calls.length, 1);
    const payload = h.calls[0];
    assert.equal(payload.partyType, partyType);
    assert.equal(payload.partyPolicyConfirmed, true);
    assert.equal(payload.departureId, "departure-1");
    assert.equal(payload.adults, 2);
    assert.equal(payload.children, 0);
    assert.equal(payload.mealPlan, "without_buffet");
    assert.equal(Object.hasOwn(payload, "amount"), false);
    h.render().acknowledge({ target: { checked: false } });
    assert.equal(h.render().disabled, true);
    await h.render().confirm();
    assert.equal(h.calls.length, 1, "unchecking acknowledgement blocks subsequent checkout");
  });
}

test("retry keeps its idempotency key while changing booking type creates a new attempt", async () => {
  const h = harness({ partyType: "family", partyPolicyConfirmed: true });
  await h.render().confirm();
  await h.render().confirm();
  assert.equal(h.calls[0].idempotencyKey, h.calls[1].idempotencyKey);
  h.render().selectParty({ target: { value: "couple" } });
  await h.render().confirm();
  assert.notEqual(h.calls[1].idempotencyKey, h.calls[2].idempotencyKey);
  assert.equal(h.calls[2].partyType, "couple");
});

test("customer API serializes the selected booking type and literal acknowledgement", async () => {
  const api = read("customer-app/src/api.js");
  const start = api.indexOf("export async function createPaymentCheckout(");
  const end = api.indexOf("\nexport ", start + 1);
  const source = api.slice(start, end === -1 ? undefined : end).replace(/^export /, "");
  const requests = [];
  const context = vm.createContext({ request: async (path, options) => requests.push({ path, options }) });
  const createCheckout = new vm.Script(`${source}\ncreatePaymentCheckout`).runInContext(context);
  for (const partyType of ["family", "couple"]) {
    await createCheckout({ departureId: "departure-1", adults: 2, partyType, partyPolicyConfirmed: true, token: "synthetic-token", idempotencyKey: "synthetic-key" });
    const request = requests.at(-1);
    assert.equal(request.path, "/api/payments/checkout");
    assert.deepEqual(JSON.parse(request.options.body), { departureId: "departure-1", adults: 2, children: 0, mealPlan: "without_buffet", partyType, partyPolicyConfirmed: true });
  }
});

for (const [name, path, variable] of [["Provider", "provider-app/src/App.jsx", "data"], ["Admin", "admin-app/src/BookingSupport.jsx", "booking"]]) {
  test(`${name} booking detail evaluates Family, Couple and historical Not recorded labels`, () => {
    const source = read(path);
    const expression = source.match(new RegExp(`\\{(${variable}\\.partyType==="family"\\?"Family":${variable}\\.partyType==="couple"\\?"Couple":"Not recorded")\\}`))?.[1];
    assert.ok(expression, `${name} must show the booking's authoritative partyType`);
    assert.match(source, /Booking type/);
    for (const [partyType, expected] of [["family", "Family"], ["couple", "Couple"], [undefined, "Not recorded"], [null, "Not recorded"]]) {
      assert.equal(vm.runInNewContext(expression, { [variable]: { partyType } }), expected);
    }
  });
}
