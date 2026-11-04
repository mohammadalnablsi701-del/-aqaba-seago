import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const bootstrap = html.match(/<script id="seago-splash-bootstrap">([\s\S]*?)<\/script>/)?.[1];
assert.ok(bootstrap, "The recovery clock must run independently of the React bundle");

function emitter(target = {}) {
  const listeners = new Map();
  target.addEventListener = (name, callback) => {
    const callbacks = listeners.get(name) || [];
    callbacks.push(callback);
    listeners.set(name, callbacks);
  };
  target.emit = (name, event = {}) => {
    for (const callback of listeners.get(name) || []) callback(event);
  };
  return target;
}

function element() {
  const attributes = new Map();
  return emitter({
    dataset: {}, hidden: false, textContent: "", style: {setProperty() {}},
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    hasAttribute: name => attributes.has(name)
  });
}

function launchHarness({ native = false, hidden = false, imageLoaded = true } = {}) {
  let now = 0, nextTimer = 1;
  const timers = new Map();
  const setTimeout = (callback, delay = 0) => {
    const id = nextTimer++;
    timers.set(id, {at: now + Math.max(0, delay), callback});
    return id;
  };
  const advance = delta => {
    const end = now + delta;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = end;
  };
  const root = element(), splash = element(), page = element(), status = element();
  root.setAttribute("inert", "");
  root.setAttribute("aria-hidden", "true");
  page.dataset.seagoLaunch = "pending";
  const logo = emitter({complete: imageLoaded, decode: () => Promise.resolve()});
  splash.querySelector = selector => selector === "img" ? logo : status;
  const document = emitter({
    visibilityState: hidden ? "hidden" : "visible", documentElement: page,
    getElementById: id => id === "root" ? root : splash
  });
  const window = emitter({Capacitor: {isNativePlatform: () => native}});
  vm.runInNewContext(bootstrap, {
    window, document, performance: {now: () => now},
    setTimeout, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => setTimeout(callback, 16)
  });
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const paint = async () => { await settle(); advance(32); await settle(); };
  return {window, document, root, splash, page, status, logo, advance, paint, settle, launch: window.__seagoLaunch};
}

test("the visible artwork clock includes the exit and removes all interaction blockers at exactly 3000ms", async () => {
  const h = launchHarness();
  h.launch.ready();
  await h.paint();
  assert.equal(h.launch.startedAt, 32);
  assert.equal(h.splash.dataset.started, "true");
  h.advance(2699);
  assert.notEqual(h.splash.dataset.state, "exiting");
  assert.equal(h.splash.hidden, false);
  h.advance(1);
  assert.equal(h.splash.dataset.state, "exiting");
  assert.equal(h.page.dataset.seagoLaunch, "exiting");
  h.advance(299);
  assert.equal(h.splash.hidden, false);
  assert.equal(h.root.hasAttribute("inert"), true);
  h.advance(1);
  assert.equal(h.splash.hidden, true);
  assert.equal(h.root.hasAttribute("inert"), false);
  assert.equal(h.root.hasAttribute("aria-hidden"), false);
});

test("a partially populated React root never bypasses readiness or hides boot recovery", async () => {
  const h = launchHarness();
  h.root.childElementCount = 2;
  await h.paint();
  h.advance(10000);
  assert.equal(h.splash.hidden, false);
  assert.equal(h.root.hasAttribute("inert"), true);
  assert.notEqual(h.page.dataset.seagoLaunch, "exiting");
  h.launch.ready();
  assert.equal(h.splash.hidden, true, "A late, successfully committed app is revealed immediately");
});

test("readiness late in the timeline uses only the remaining exit time", async () => {
  const h = launchHarness();
  await h.paint();
  h.advance(2850);
  h.launch.ready();
  h.advance(0);
  assert.equal(h.splash.dataset.state, "exiting");
  h.advance(149);
  assert.equal(h.splash.hidden, false);
  h.advance(1);
  assert.equal(h.splash.hidden, true);
});

test("StrictMode, rerenders and navigation cannot restart the document launch clock", async () => {
  const h = launchHarness();
  h.launch.ready();
  await h.paint();
  const startedAt = h.launch.startedAt;
  h.advance(1000);
  h.launch.ready();
  await h.paint();
  assert.equal(h.launch.startedAt, startedAt);
  h.advance(1968);
  assert.equal(h.splash.hidden, true);
  h.launch.ready();
  h.document.emit("visibilitychange");
  await h.paint();
  assert.equal(h.launch.startedAt, startedAt);
  assert.equal(h.splash.hidden, true);
});

test("a hidden document starts its clock only after it becomes visible", async () => {
  const h = launchHarness({hidden: true});
  h.launch.ready();
  await h.paint();
  h.advance(5000);
  assert.equal(h.launch.startedAt, null);
  assert.equal(h.splash.hidden, false);
  h.document.visibilityState = "visible";
  h.document.emit("visibilitychange");
  await h.paint();
  const startedAt = h.launch.startedAt;
  assert.equal(startedAt, 5064);
  h.advance(2999);
  assert.equal(h.splash.hidden, false);
  h.advance(1);
  assert.equal(h.splash.hidden, true);
});

test("slow artwork loading does not consume the three-second visible experience", async () => {
  const h = launchHarness({imageLoaded: false});
  h.launch.ready();
  await h.paint();
  h.advance(1500);
  assert.equal(h.launch.startedAt, null);
  h.logo.emit("load");
  await h.paint();
  const startedAt = h.launch.startedAt;
  assert.equal(startedAt, 1564);
  h.advance(2999);
  assert.equal(h.splash.hidden, false);
  h.advance(1);
  assert.equal(h.splash.hidden, true);
});

test("native launch waits for the native-to-web handoff, then plays once", async () => {
  const h = launchHarness({native: true});
  h.launch.ready();
  await h.paint();
  assert.equal(h.launch.startedAt, null);
  h.launch.releaseNative();
  await h.paint();
  assert.equal(h.launch.startedAt, 64);
  h.advance(3000);
  assert.equal(h.splash.hidden, true);
});

test("bounded native auto-hide also starts visible recovery if the app module fails to load", async () => {
  const h = launchHarness({native: true});
  await h.settle();
  h.advance(1100);
  await h.paint();
  assert.equal(h.launch.startedAt, 1132);
  h.advance(5000);
  assert.equal(h.splash.hidden, false);
});

test("a React initialization failure cancels exit and keeps a visible retry state", async () => {
  const h = launchHarness();
  h.launch.ready();
  await h.paint();
  h.advance(2750);
  h.launch.fail();
  h.advance(10000);
  assert.equal(h.splash.hidden, false);
  assert.equal(h.splash.dataset.state, "error");
  assert.equal(h.page.dataset.seagoLaunch, "error");
  assert.equal(h.root.hasAttribute("inert"), true);
  assert.match(h.status.textContent, /could not open.*reload/i);
  h.launch.ready();
  assert.equal(h.splash.hidden, false, "a stale readiness callback must not hide the error");
});

test("script errors and rejected startup imports expose recovery rather than an endless splash", async () => {
  for (const failure of ["script", "rejection"]) {
    const h = launchHarness();
    await h.paint();
    if (failure === "script") h.window.emit("error", {target: {tagName: "SCRIPT"}});
    else h.window.emit("unhandledrejection");
    h.advance(5000);
    assert.equal(h.splash.hidden, false);
    assert.equal(h.splash.dataset.state, "error");
    assert.match(h.status.textContent, /reload/i);
  }
});

test("recoverable asset errors do not misreport application initialization failure", async () => {
  const h = launchHarness();
  h.window.emit("error", {target: {tagName: "IMG"}});
  h.launch.ready();
  await h.paint();
  h.advance(3000);
  assert.equal(h.splash.hidden, true);
});

test("motion phases and safe-area layout use the approved base-aware asset", () => {
  assert.match(html, /src="%BASE_URL%app-customer\.svg"/);
  assert.match(html, /launch-logo 500ms/);
  assert.match(html, /launch-settle 700ms[^;]*500ms/);
  assert.match(html, /strong\{animation:launch-copy 600ms[^;]*500ms/);
  assert.match(html, /launch-tagline\{animation:launch-copy 600ms[^;]*1200ms/);
  assert.match(html, /launch-wave 1000ms[^;]*1200ms/);
  for (const inset of ["top", "right", "bottom", "left"]) assert.ok(html.includes(`env(safe-area-inset-${inset})`));
  assert.match(html, /prefers-reduced-motion:reduce/);
  assert.match(html, /pointer-events:none/);
});

test("a stalled logo request falls back to visible branding after the bounded artwork wait", async () => {
  const h = launchHarness({imageLoaded: false});
  h.launch.ready();
  await h.settle();
  h.advance(1999);
  await h.settle();
  assert.equal(h.launch.startedAt, null);
  h.advance(1);
  await h.paint();
  assert.equal(h.launch.startedAt, 2032);
  h.advance(3000);
  assert.equal(h.splash.hidden, true, "a stalled asset must not hold a ready application forever");
});

test("an optional script failure after application readiness does not replace the usable app with boot recovery", async () => {
  const h = launchHarness();
  h.launch.ready();
  await h.paint();
  h.window.emit("error", {target: {tagName: "SCRIPT"}});
  h.window.emit("unhandledrejection");
  assert.notEqual(h.splash.dataset.state, "error");
  h.advance(3000);
  assert.equal(h.splash.hidden, true);
});
