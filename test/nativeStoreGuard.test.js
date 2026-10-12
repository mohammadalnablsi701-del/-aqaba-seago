import test from "node:test";
import assert from "node:assert/strict";
import { NATIVE_STORE_AUTH_COPY, syncNativeStorePanel } from "../customer-app/src/nativeStoreGuard.js";

function trackedStyle(initial = "") {
  let display = initial;
  let writes = 0;
  return {
    style: {
      get display() { return display; },
      set display(value) { writes += 1; display = value; }
    },
    get writes() { return writes; }
  };
}

function makePanel({
  initialCopy = "Continue with Google or email",
  googleDisplay = "",
  dividerDisplay = ""
} = {}) {
  let copyValue = initialCopy;
  let copyWrites = 0;
  const googleState = trackedStyle(googleDisplay);
  const dividerState = trackedStyle(dividerDisplay);
  const copy = {
    get textContent() { return copyValue; },
    set textContent(value) { copyWrites += 1; copyValue = value; }
  };
  const panel = {
    querySelector(selector) {
      if (selector === ".google-auth-wrap") return googleState.style;
      if (selector === ".auth-divider") return dividerState.style;
      if (selector === ".auth-panel__head p") return copy;
      return null;
    }
  };
  return {
    panel,
    google: googleState.style,
    divider: dividerState.style,
    copy,
    get copyWrites() { return copyWrites; },
    get googleDisplayWrites() { return googleState.writes; },
    get dividerDisplayWrites() { return dividerState.writes; },
    get totalWrites() { return copyWrites + googleState.writes + dividerState.writes; }
  };
}

test("native store auth-panel sync is fully idempotent after the first mutation", () => {
  const fixture = makePanel();
  syncNativeStorePanel(fixture.panel);
  assert.equal(fixture.copy.textContent, NATIVE_STORE_AUTH_COPY);
  assert.equal(fixture.google.display, "none");
  assert.equal(fixture.divider.display, "none");
  assert.equal(fixture.copyWrites, 1);
  assert.equal(fixture.googleDisplayWrites, 1);
  assert.equal(fixture.dividerDisplayWrites, 1);

  syncNativeStorePanel(fixture.panel);
  assert.equal(fixture.copyWrites, 1, "stable copy must not be rewritten");
  assert.equal(fixture.googleDisplayWrites, 1, "stable Google display must not be rewritten");
  assert.equal(fixture.dividerDisplayWrites, 1, "stable divider display must not be rewritten");
});

test("observer-driven synchronization converges after its own first DOM updates", () => {
  const fixture = makePanel();
  let callbackPasses = 0;
  let generatedMutations = 0;
  do {
    const before = fixture.totalWrites;
    syncNativeStorePanel(fixture.panel);
    callbackPasses += 1;
    generatedMutations = fixture.totalWrites - before;
  } while (generatedMutations > 0 && callbackPasses < 5);

  assert.equal(callbackPasses, 2, "one mutating pass plus one observer callback must converge");
  assert.equal(generatedMutations, 0, "the callback caused by the first pass must not create another mutation");
  assert.equal(fixture.totalWrites, 3);
});

test("already-correct native auth panel produces no DOM assignments", () => {
  const fixture = makePanel({
    initialCopy: NATIVE_STORE_AUTH_COPY,
    googleDisplay: "none",
    dividerDisplay: "none"
  });
  syncNativeStorePanel(fixture.panel);
  assert.equal(fixture.copyWrites, 0);
  assert.equal(fixture.googleDisplayWrites, 0);
  assert.equal(fixture.dividerDisplayWrites, 0);
  assert.equal(fixture.totalWrites, 0);
});
