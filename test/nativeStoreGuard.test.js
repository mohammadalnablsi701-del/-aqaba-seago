import test from "node:test";
import assert from "node:assert/strict";
import { NATIVE_STORE_AUTH_COPY, syncNativeStorePanel } from "../customer-app/src/nativeStoreGuard.js";

function makePanel(initialCopy = "Continue with Google or email") {
  let copyValue = initialCopy;
  let copyWrites = 0;
  const google = { style: { display: "" } };
  const divider = { style: { display: "" } };
  const copy = {
    get textContent() { return copyValue; },
    set textContent(value) { copyWrites += 1; copyValue = value; }
  };
  const panel = {
    querySelector(selector) {
      if (selector === ".google-auth-wrap") return google;
      if (selector === ".auth-divider") return divider;
      if (selector === ".auth-panel__head p") return copy;
      return null;
    }
  };
  return { panel, google, divider, copy, get copyWrites() { return copyWrites; } };
}

test("native store auth-panel sync is idempotent after the first mutation", () => {
  const fixture = makePanel();
  syncNativeStorePanel(fixture.panel);
  assert.equal(fixture.copy.textContent, NATIVE_STORE_AUTH_COPY);
  assert.equal(fixture.copyWrites, 1);
  assert.equal(fixture.google.style.display, "none");
  assert.equal(fixture.divider.style.display, "none");

  syncNativeStorePanel(fixture.panel);
  assert.equal(fixture.copyWrites, 1, "stable copy must not be rewritten and retrigger the observer");
});

test("native store auth-panel sync performs no text mutation when copy is already correct", () => {
  const fixture = makePanel(NATIVE_STORE_AUTH_COPY);
  syncNativeStorePanel(fixture.panel);
  assert.equal(fixture.copyWrites, 0);
});
