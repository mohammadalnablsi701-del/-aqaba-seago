import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const app = read("customer-app/src/App.jsx");
const api = read("customer-app/src/api.js");
const main = read("customer-app/src/main.jsx");
const tripsRoute = read("src/routes/trips.js");
const bookingsRoute = read("src/routes/bookings.js");

test("customer vessel contract is first-class data from Trip and Booking DTOs", () => {
  assert.match(tripsRoute, /vesselName/);
  assert.match(bookingsRoute, /select:\s*"[^"]*vesselName/);
  assert.match(bookingsRoute, /tripId:\s*source\.tripId\s*\?\s*tripForAudience\(source\.tripId\)/);
  assert.match(app, /vesselName:\s*String\(raw\.vesselName\s*\|\|\s*""\)\.trim\(\)/);
});

test("trip card, details, checkout and ticket render vesselName through React", () => {
  assert.match(app, /<VesselName value=\{trip\.vesselName\} className="seago-vessel-card"\/>/);
  assert.match(app, /<VesselName value=\{trip\.vesselName\} className="seago-vessel-detail"\/>/);
  assert.match(app, /<VesselName value=\{trip\.vesselName\} className="seago-vessel-booking"\/>/);
  assert.match(app, /<VesselName value=\{trip\.vesselName\} className="seago-vessel-ticket"\/>/);
});

test("missing vessel values render nothing instead of undefined or null", () => {
  assert.match(app, /const vesselName=String\(value\|\|""\)\.trim\(\);/);
  assert.match(app, /if\(!vesselName\)return null;/);
  assert.doesNotMatch(app, /Unknown vessel/);
});

test("async trip loading keeps vesselName in React state without vessel DOM observation", () => {
  assert.match(app, /const normalized=rows\.map\(normalizeTrip\);/);
  assert.match(app, /setTripList\(enriched\);/);
  assert.doesNotMatch(app, /MutationObserver/);
  assert.doesNotMatch(app, /document\.querySelector(?:All)?\([^)]*vessel/i);
  assert.doesNotMatch(app, /(?:vesselName|Vessel)[^\n]{0,120}textContent\s*=/i);
});

test("navigation history preserves the React trip object used for vessel rendering", () => {
  assert.match(app, /const snapshot=\{seago:\{active,detail,booking:Boolean\(booking&&detail\)\}\};/);
  assert.match(app, /setDetail\(nav\.detail\|\|null\);/);
});

test("vessel DOM polish bridge, observer and 500ms poll are removed", () => {
  assert.equal(fs.existsSync(new URL("../customer-app/src/vesselUiPolish.js", import.meta.url)), false);
  assert.doesNotMatch(main, /vesselUiPolish|enableVesselUiPolish/);
  assert.doesNotMatch(api, /__seagoVesselStore|seago:vessels-updated|publishVessels|indexTrip/);
  const customerBusinessSource = `${app}\n${api}\n${main}`;
  assert.doesNotMatch(customerBusinessSource, /setInterval\s*\(\s*polish\s*,\s*500\s*\)/);
  assert.doesNotMatch(customerBusinessSource, /vessel[\s\S]{0,120}(?:textContent\s*=|innerHTML\s*=|appendChild|insertAdjacent)/i);
});

test("Vessel names remain ordinary escaped JSX text", () => {
  assert.match(app, />Vessel · \{vesselName\}<\/span>/);
  assert.doesNotMatch(app, /dangerouslySetInnerHTML/);
});
