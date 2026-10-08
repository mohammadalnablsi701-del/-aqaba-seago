import test from "node:test";
import assert from "node:assert/strict";
import Trip from "../src/models/Trip.js";

test("Trip exposes vesselName as a trimmed bounded string", () => {
  const path = Trip.schema.path("vesselName");
  assert.ok(path, "vesselName path should exist");
  assert.equal(path.instance, "String");
  assert.equal(path.options.trim, true);
  assert.equal(path.options.maxlength, 120);
});

test("vesselName remains optional while pilot trips are being backfilled", () => {
  const path = Trip.schema.path("vesselName");
  assert.notEqual(path.options.required, true);
});
