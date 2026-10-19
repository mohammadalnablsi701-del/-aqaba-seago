import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { build } from 'vite';
import { chromium } from 'playwright-core';

// Requires root and Customer lockfile installs plus system Chromium/Chrome.
// Static frontend only: no API server, database, .env or external requests.
test('Home hero exposes only the approved photograph while loading', { timeout: 60000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = resolve(root, 'node_modules/.cache/hero-loading');
  const executablePath = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/opt/google/chrome/chrome']
    .find(path => existsSync(path));
  assert.ok(executablePath, 'Install system Chromium/Chrome; this browser regression never skips');
  for (const [base, directory] of [['/', 'root'], ['/-aqaba-seago/', 'pages']]) {
    await build({ root, configFile: resolve(root, 'vite.config.js'), envDir: false, base, logLevel: 'error',
      define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('') },
      build: { outDir: resolve(output, directory), emptyOutDir: true } });
  }
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const pages = pathname.startsWith('/-aqaba-seago/');
    const directory = resolve(output, pages ? 'pages' : 'root');
    const relative = pages ? pathname.slice('/-aqaba-seago/'.length) : pathname.slice(1);
    const file = resolve(directory, relative || 'index.html');
    if (!file.startsWith(directory + sep)) { res.writeHead(403).end(); return; }
    try { const body = await readFile(file); res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' }); res.end(body); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update'] });
  t.after(() => browser.close());
  const screenshots = resolve(root, '../coverage/hero-loading');
  await mkdir(screenshots, { recursive: true });

  async function open({ width = 375, base = '/', decode = 'normal', broken = false, mobile = true } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: mobile ? 3 : 1,
      isMobile: mobile, hasTouch: mobile });
    t.after(() => context.close());
    await context.addInitScript(mode => {
      const original = HTMLImageElement.prototype.decode;
      const pending = [];
      let released = false;
      window.heroDecode = { calls: 0, release: () => { released = true; pending.splice(0).forEach(resolve => resolve()); } };
      if (mode === 'unsupported') HTMLImageElement.prototype.decode = undefined;
      if (mode === 'delayed' || mode === 'rejected') HTMLImageElement.prototype.decode = async function () {
        if (!this.src.endsWith('/aqaba-hero.jpg')) return original.call(this);
        window.heroDecode.calls++;
        if (mode === 'rejected') throw new DOMException('Synthetic decode failure', 'EncodingError');
        await original.call(this);
        if (!released) await new Promise(resolve => pending.push(resolve));
      };
    }, decode);
    let releaseImage;
    let imageRequested;
    const held = new Promise(resolve => { releaseImage = resolve; });
    const requested = new Promise(resolve => { imageRequested = resolve; });
    const external = [], errors = [], missing = [], heroUrls = [];
    // Routing disables HTTP cache; each fresh context starts without app storage.
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
        external.push(url.origin); return route.abort();
      }
      if (url.pathname.endsWith('/aqaba-hero.jpg')) {
        heroUrls.push(url.pathname); imageRequested(); await held;
        if (broken) return route.fulfill({ contentType: 'image/jpeg', body: 'invalid synthetic image' });
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) missing.push(response.url()); });
    await page.goto(origin + base, { waitUntil: 'domcontentloaded' });
    await page.locator('.hero-scene').waitFor();
    await requested;
    return { page, context, releaseImage, external, errors, missing, heroUrls, base };
  }

  async function stack(page) {
    return page.evaluate(() => {
      const hero = document.querySelector('.hero');
      const scene = hero.querySelector('.hero-scene');
      const image = scene.querySelector('img');
      const backgrounds = [...hero.querySelectorAll('*'), hero, hero.parentElement, document.querySelector('.app-shell'), document.body, document.documentElement]
        .flatMap(node => [null, '::before', '::after'].map(pseudo => getComputedStyle(node, pseudo).backgroundImage))
        .filter(value => value.includes('url('));
      const box = node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; };
      return { backgrounds, photos: backgrounds.reduce((sum, value) => sum + (value.match(/url\(/g) || []).length, 0) + scene.querySelectorAll('img').length,
        ready: image && getComputedStyle(image).opacity, color: getComputedStyle(scene).backgroundColor,
        imageBox: image && box(image),
        fit: image && getComputedStyle(image).objectFit, position: image && getComputedStyle(image).objectPosition,
        geometry: [hero, scene, hero.querySelector('.hero__top'), hero.querySelector('.hero__copy'), hero.querySelector('.search-card'), document.querySelector('.bottom-nav')].map(box) };
    });
  }

  for (const profile of [{ width: 375 }, { width: 390, base: '/-aqaba-seago/' }, { width: 430 }, { width: 1024, mobile: false }]) {
    await t.test(`cold first load, reload and Home remount at ${profile.width}px, base ${profile.base || '/'}`, async () => {
      const run = await open(profile);
      try {
        const before = await stack(run.page);
        assert.equal(before.photos, 1, 'The rendered hero must have one photographic source, including CSS layers');
        assert.deepEqual(before.backgrounds, []);
        assert.equal(before.ready, '0');
        assert.notEqual(before.color, 'rgba(0, 0, 0, 0)');
        assert.notEqual(before.color, 'rgb(255, 255, 255)');
        assert.equal(before.geometry[1].height, profile.width <= 480 ? 440 : 470);
        assert.deepEqual(before.imageBox, before.geometry[1]);
        assert.equal(before.fit, 'cover');
        assert.equal(before.position, profile.width <= 390 ? '50% 35%' : profile.width <= 480 ? '50% 36%' : '50% 42%');
        await run.page.screenshot({ path: resolve(screenshots, `loading-${profile.width}.png`) });
        run.releaseImage();
        await run.page.waitForFunction(() => getComputedStyle(document.querySelector('.hero-scene img')).opacity === '1');
        const after = await stack(run.page);
        assert.deepEqual(after.geometry, before.geometry, 'Image load must not move hero, header, copy, search or navigation');
        assert.deepEqual(run.heroUrls, [(profile.base || '/') + 'aqaba-hero.jpg']);
        await run.page.screenshot({ path: resolve(screenshots, `loaded-${profile.width}.png`) });
        await run.page.reload();
        await run.page.waitForFunction(() => getComputedStyle(document.querySelector('.hero-scene img')).opacity === '1');
        await run.page.locator('.bottom-nav button').nth(1).click();
        await run.page.locator('.bottom-nav button').first().click();
        await run.page.waitForFunction(() => getComputedStyle(document.querySelector('.hero-scene img')).opacity === '1');
        assert.equal((await stack(run.page)).photos, 1);
        assert.deepEqual(run.external, []); assert.deepEqual(run.errors, []); assert.deepEqual(run.missing, []);
      } finally { run.releaseImage(); await run.context.close(); }
    });
  }

  for (const decode of ['delayed', 'unsupported', 'rejected']) {
    await t.test(`image decode ${decode} is handled without exposing a second image`, async () => {
      const run = await open({ decode });
      try {
        run.releaseImage();
        if (decode === 'unsupported') {
          await run.page.waitForFunction(() => getComputedStyle(document.querySelector('.hero-scene img')).opacity === '1');
        } else {
          await run.page.waitForFunction(() => window.heroDecode.calls > 0);
          assert.equal((await stack(run.page)).ready, '0');
          if (decode === 'delayed') {
            await run.page.evaluate(() => window.heroDecode.release());
            await run.page.waitForFunction(() => getComputedStyle(document.querySelector('.hero-scene img')).opacity === '1');
          }
        }
        assert.equal((await stack(run.page)).photos, 1);
        assert.deepEqual(run.errors, []); assert.deepEqual(run.external, []); assert.deepEqual(run.missing, []);
      } finally { run.releaseImage(); await run.context.close(); }
    });
  }
  await t.test('failed image stays neutral without a broken-image or alternate photograph', async () => {
    const run = await open({ broken: true });
    try {
      run.releaseImage();
      await run.page.waitForFunction(() => document.querySelector('.hero-scene img').complete);
      assert.equal((await stack(run.page)).ready, '0');
      assert.equal((await stack(run.page)).photos, 1);
      assert.deepEqual(run.errors, []); assert.deepEqual(run.external, []);
    } finally { run.releaseImage(); await run.context.close(); }
  });
});
