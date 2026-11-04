// Optional browser QA, matching the existing brand-logo diagnostic's Playwright setup.
// Install Playwright in an isolated tools directory; no application dependency is required.
// SPLASH_TEST_URL=http://localhost:4173/ PLAYWRIGHT_MODULE=/tools/node_modules/playwright/index.mjs node scripts/launchSplashBrowserQA.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium, devices } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.SPLASH_TEST_URL || "http://127.0.0.1:4173/";
const output = process.env.SPLASH_QA_OUTPUT || "/tmp/seago-splash-evidence";
await mkdir(output, {recursive:true});
const browser = await chromium.launch({
  headless:true,
  ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}),
  args:["--no-sandbox", "--disable-dev-shm-usage"]
});
const entryScript = /\/(?:src\/main\.jsx|assets\/index-[^/]+\.js)(?:\?.*)?$/;
const emit = (name, facts) => console.log(JSON.stringify({test:name, ...facts}));
const contextFor = async options => {
  const context = await browser.newContext(options);
  // The app's existing optional Google Fonts import is unrelated to launch.
  // Keep QA independent of external font availability and proxy certificates.
  await context.route(/^https:\/\/fonts\.googleapis\.com\//, route => route.fulfill({
    contentType: "text/css", body: "/* Use system font fallbacks in isolated QA. */"
  }));
  await context.addInitScript(() => {
    window.__splashUnhandledRejections = [];
    window.addEventListener("unhandledrejection", event => {
      window.__splashUnhandledRejections.push(String(event.reason));
    });
    const observer = new MutationObserver(() => {
      if (document.getElementById("seago-boot-recovery")?.hidden && window.__seagoLaunch?.startedAt != null) {
        window.__splashMeasuredDuration = performance.now() - window.__seagoLaunch.startedAt;
        observer.disconnect();
      }
    });
    observer.observe(document, {subtree:true, attributes:true, attributeFilter:["hidden"]});
  });
  return context;
};
try {
  if (!process.env.SPLASH_QA_FAILURES_ONLY) {
    for (const [name, options] of [
      ["iphone", devices["iPhone 13"]], ["android", devices["Pixel 7"]],
      ["desktop", {viewport:{width:1440,height:1000}}],
      ["reduced-motion", {...devices["iPhone 13"], reducedMotion:"reduce"}]
    ]) {
      const context = await contextFor(options);
      try {
        const page = await context.newPage();
        const errors=[];page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        await page.goto(base, {waitUntil:"domcontentloaded"});
        const splash = page.locator("#seago-boot-recovery");
        assert.equal(await splash.isVisible(), true);
        assert.equal(await splash.evaluate(el => getComputedStyle(el).backgroundColor), "rgb(7, 31, 51)");
        await page.waitForTimeout(1300);
        await page.screenshot({path:`${output}/${name}-splash.png`});
        await splash.waitFor({state:"hidden"});
        const duration = await page.evaluate(() => window.__splashMeasuredDuration);
        assert.ok(duration >= 2975 && duration <= 3075, `actual visible duration ${duration}ms`);
        assert.equal(await page.locator("#root").evaluate(el => el.inert), false);
        await page.screenshot({path:`${output}/${name}-home.png`});
        await page.locator(".bottom-nav button").filter({hasText:"Trips"}).click();
        assert.equal(await splash.isVisible(), false);
        await page.locator(".bottom-nav button").filter({hasText:"Profile"}).click();
        assert.equal(await splash.isVisible(), false);
        assert.deepEqual(errors, []);
        assert.deepEqual(await page.evaluate(() => window.__splashUnhandledRejections), []);
        emit(name, {durationMs:duration, navigationNoReplay:true});
      } finally { await context.close(); }
    }
  }
  // Failed app module must expose an immediate recovery state, even in short landscape.
  {
    const context = await contextFor({viewport:{width:844,height:320},isMobile:true,hasTouch:true});
    try {
      const page = await context.newPage();
      await page.route(entryScript, route => route.abort("failed"));
      await page.goto(base, {waitUntil:"domcontentloaded"});
      await page.waitForFunction(() => document.getElementById("seago-boot-recovery")?.dataset.state === "error");
      assert.equal(await page.locator("#seago-boot-recovery").isVisible(), true);
      const retry = page.getByRole("link", {name:/Reload Aqaba SeaGo/});
      assert.equal(await retry.isVisible(), true);
      const rect = await retry.boundingBox();
      assert.ok(rect.y >= 0 && rect.y + rect.height <= 320, "Retry is inside the short landscape viewport");
      await page.screenshot({path:`${output}/blocked-module-landscape.png`});
      emit("blocked-module-landscape", {retryVisible:true, retryBounds:rect});
    } finally { await context.close(); }
  }
  // Throw inside App's initial render; the error boundary must retain static recovery.
  {
    const context = await contextFor(devices["iPhone 13"]);
    try {
      await context.addInitScript(() => {
        const read=Storage.prototype.getItem;
        Storage.prototype.getItem=function(key) {
          if (this===sessionStorage && key==="seago_active_screen") throw new Error("QA simulated initialization failure");
          return read.call(this,key);
        };
      });
      const page = await context.newPage();
      await page.goto(base, {waitUntil:"domcontentloaded"});
      await page.waitForFunction(() => document.getElementById("seago-boot-recovery")?.dataset.state === "error");
      await page.waitForTimeout(3200);
      assert.equal(await page.locator("#seago-boot-recovery").isVisible(), true);
      assert.equal(await page.getByRole("link", {name:/Reload Aqaba SeaGo/}).isVisible(), true);
      assert.equal(await page.locator("#root").evaluate(el => el.inert), true);
      await page.screenshot({path:`${output}/react-initialization-error.png`});
      emit("react-initialization-error", {recoveryRemains:true});
    } finally { await context.close(); }
  }
  // Hold the entry module beyond 3 seconds: never reveal a blank/partial root.
  {
    const context = await contextFor(devices["iPhone 13"]);
    try {
      let release;
      const held = new Promise(resolve => {release=resolve;});
      const page = await context.newPage();
      await page.route(entryScript, async route => {await held; await route.continue();});
      await page.goto(base, {waitUntil:"commit"});
      await page.waitForFunction(() => window.__seagoLaunch?.startedAt != null);
      await page.waitForTimeout(3150);
      assert.equal(await page.locator("#seago-boot-recovery").isVisible(), true);
      assert.equal(await page.locator("#root").evaluate(el => el.inert), true);
      release();
      await page.locator("#seago-boot-recovery").waitFor({state:"hidden"});
      assert.ok(await page.locator("#root").evaluate(el => el.childElementCount > 0));
      emit("slow-entry-module", {recoveryBeforeReady:true, appRevealedAfterReady:true});
    } finally { await context.close(); }
  }
  // Full reload is a new document launch, while preserving query parameters.
  {
    const context = await contextFor(devices["iPhone 13"]);
    try {
      const page = await context.newPage();
      const url = new URL(base);url.searchParams.set("qa", "splash");
      await page.goto(url.href, {waitUntil:"domcontentloaded"});
      await page.locator("#seago-boot-recovery").waitFor({state:"hidden"});
      await page.reload({waitUntil:"domcontentloaded"});
      assert.equal(await page.locator("#seago-boot-recovery").isVisible(), true);
      assert.equal(new URL(page.url()).searchParams.get("qa"), "splash");
      await page.locator("#seago-boot-recovery").waitFor({state:"hidden"});
      emit("full-reload", {replayed:true, queryPreserved:true});
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
