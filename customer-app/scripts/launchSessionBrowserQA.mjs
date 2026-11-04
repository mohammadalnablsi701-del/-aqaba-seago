// Start Vite with VITE_API_BASE_URL=http://127.0.0.1:4176/__qa_api on port 4176.
// All API responses below are mocked; this test never contacts a backend.
import assert from "node:assert/strict";
const { chromium, devices } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.SPLASH_AUTH_TEST_URL || "http://127.0.0.1:4176/";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});
try {
  for (const status of [200, 401, 503]) {
    const context = await browser.newContext(devices["iPhone 13"]);
    try {
      await context.addInitScript(() => {
        localStorage.setItem("seago_auth", JSON.stringify({
          token: "qa-session", user: { name: "PRIVATE QA", email: "private@example.test" }
        }));
        sessionStorage.setItem("seago_active_screen", "profile");
      });
      let release;
      const held = new Promise(resolve => { release = resolve; });
      let checks = 0;
      await context.route("**/__qa_api/api/**", async route => {
        assert.equal(route.request().method(), "GET", "Startup checks are read-only");
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/notifications")) {
          checks++;
          if (checks === 1) await held;
          await route.fulfill({ status, json: status === 200 ? { unread: 0, items: [] } : { error: "QA session check" } });
        } else {
          await route.fulfill({ json: url.pathname.endsWith("/trips") ? [] : { enabled: false } });
        }
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(base, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__seagoLaunch?.startedAt != null);
      await page.waitForTimeout(3150);
      assert.equal(checks, 1, "StrictMode must share the startup session request");
      assert.equal(await page.locator("#root").evaluate(el => el.childElementCount), 0);
      assert.equal(await page.locator("#seago-boot-recovery").isVisible(), true);
      assert.equal(await page.getByText("PRIVATE QA", { exact: true }).count(), 0);
      release();
      if (status === 503) {
        await page.waitForFunction(() => document.getElementById("seago-boot-recovery").dataset.state === "error");
        assert.equal(await page.locator("#root").evaluate(el => el.childElementCount), 0);
        assert.equal(await page.getByRole("link", { name: /Reload Aqaba SeaGo/ }).isVisible(), true);
      } else {
        await page.locator("#seago-boot-recovery").waitFor({ state: "hidden" });
        if (status === 200) {
          assert.equal(await page.getByText("PRIVATE QA", { exact: true }).isVisible(), true);
        } else {
          assert.equal(await page.getByText("PRIVATE QA", { exact: true }).count(), 0);
          assert.equal(await page.evaluate(() => localStorage.getItem("seago_auth")), null);
          assert.equal(await page.getByRole("heading", { name: "Sign in to book" }).isVisible(), true);
        }
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ test: "startup-session", status, protectedContentWaited: true }));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
