import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const argument = process.argv.find(value => value.startsWith("--dist="));
if (!argument) throw new Error("Usage: node scripts/verify-pages-icon-paths.mjs --dist=<assembled Pages directory>");
const dist = path.resolve(argument.slice("--dist=".length));
function verifyReviewImagesExcluded(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) verifyReviewImagesExcluded(path.join(directory, entry.name));
    else assert.ok(!/^admin-direction-a-(proposal|master-1024)\.png$/.test(entry.name),
      `Documentation review image leaked into the website: ${entry.name}`);
  }
}
verifyReviewImagesExcluded(dist);
const base = "/-aqaba-seago/";
const apps = [
  { role: "provider", prefix: `${base}provider/` },
  { role: "admin", prefix: `${base}admin/` },
  { role: "customer", prefix: base },
];
const types = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".webmanifest": "application/manifest+json", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

function pathname(url) {
  return path.posix.normalize(decodeURIComponent(url.pathname));
}

function owner(url) {
  return apps.find(app => pathname(url).startsWith(app.prefix))?.role;
}

const server = http.createServer((request, response) => {
  try {
    const parsed = new URL(request.url, "http://localhost");
    const requested = pathname(parsed);
    if (!requested.startsWith(base)) throw new Error("outside Pages base");
    let target = path.resolve(dist, requested.slice(base.length));
    if (!target.startsWith(dist + path.sep) && target !== dist) throw new Error("outside artifact");
    if (fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
    const body = fs.readFileSync(target);
    response.writeHead(200, {
      "Content-Type": types[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    // Deliberately no SPA fallback: missing icons must be a real failure.
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Missing preview artifact file");
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
let checked = 0;

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([^\s=/>]+)\s*=\s*(["'])(.*?)\2/gs)]
    .map(match => [match[1].toLowerCase(), match[3]]));
}

async function get(url, app, expectedType) {
  assert.equal(url.origin, origin, `${app.role} reference points outside the preview: ${url}`);
  assert.equal(owner(url), app.role, `${app.role} reference crosses an app prefix: ${url.pathname}`);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `Missing ${app.role} artifact URL: ${url.pathname}`);
  const contentType = response.headers.get("content-type").split(";")[0];
  if (expectedType) assert.equal(contentType, expectedType, `Wrong MIME type at ${url.pathname}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (contentType === "image/png") {
    assert.equal(body.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `PNG URL returned another file: ${url.pathname}`);
  } else if (contentType === "image/svg+xml") {
    assert.match(body.toString(), /<svg(?:\s|>)/, `SVG URL returned another file: ${url.pathname}`);
  }
  checked++;
  return body;
}

function assertPublicCopy(body, url, app) {
  const relative = pathname(url).slice(app.prefix.length);
  const source = path.join(root, `${app.role}-app/public`, relative);
  assert.ok(fs.existsSync(source), `No ${app.role} public source for ${url.pathname}`);
  assert.ok(body.equals(fs.readFileSync(source)), `Packaged file differs from ${app.role} source: ${url.pathname}`);
}

try {
  for (const app of apps) {
    const pageURL = new URL(app.prefix, origin);
    const html = (await get(pageURL, app, "text/html")).toString();
    const baseTag = html.match(/<base\b[^>]*>/i)?.[0];
    const htmlBase = baseTag ? new URL(attributes(baseTag).href, pageURL) : pageURL;
    assert.equal(owner(htmlBase), app.role, `${app.role} HTML base crosses app prefixes`);
    const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => attributes(match[0]));
    const manifests = links.filter(link => link.rel?.split(/\s+/).includes("manifest"));
    assert.equal(manifests.length, 1, `${app.role} needs exactly one manifest link`);
    const iconLinks = links.filter(link => link.rel?.split(/\s+/).some(rel => ["icon", "apple-touch-icon"].includes(rel)));
    assert.ok(iconLinks.some(link => link.rel.split(/\s+/).includes("icon")), `${app.role} favicon missing`);
    if (app.role === "customer") {
      // PR #234 documented an iPhone install failure with an explicit Apple Touch link.
      assert.ok(!iconLinks.some(link => link.rel.split(/\s+/).includes("apple-touch-icon")),
        "Customer must install through manifest 'any' PNG instead of Apple Touch link");
    } else {
      assert.ok(iconLinks.some(link => link.rel.split(/\s+/).includes("apple-touch-icon")),
        `${app.role} Apple Touch icon missing`);
    }
    for (const link of iconLinks) {
      const url = new URL(link.href, htmlBase);
      const type = link.type || types[path.extname(url.pathname)];
      assert.ok(type?.startsWith("image/"), `Unsupported icon reference: ${url}`);
      assertPublicCopy(await get(url, app, type), url, app);
    }
    if (app.role === "customer") {
      // Customer's RGB180 remains a notification asset even when Safari does not link it.
      const notificationURL = new URL("./customer-apple-touch-icon-a-v1.png?v=direction-a-v1", pageURL);
      assertPublicCopy(await get(notificationURL, app, "image/png"), notificationURL, app);
    }
    const manifestURL = new URL(manifests[0].href, htmlBase);
    const manifestBody = await get(manifestURL, app, "application/manifest+json");
    assertPublicCopy(manifestBody, manifestURL, app);
    const compatibilityURL = new URL("./manifest.webmanifest", pageURL);
    const compatibilityBody = await get(compatibilityURL, app, "application/manifest+json");
    assertPublicCopy(compatibilityBody, compatibilityURL, app);
    assert.ok(manifestBody.equals(compatibilityBody), `${app.role} compatibility manifest differs from active version`);
    const manifest = JSON.parse(manifestBody.toString());
    for (const field of ["scope", "start_url"]) {
      assert.equal(typeof manifest[field], "string", `${app.role} manifest ${field} missing`);
      const resolved = new URL(manifest[field], manifestURL);
      assert.equal(resolved.origin, origin, `${app.role} manifest ${field} leaves preview origin`);
      assert.equal(pathname(resolved), app.prefix, `${app.role} manifest ${field} resolves to another entry`);
    }
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length, `${app.role} manifest icons missing`);
    for (const icon of manifest.icons) {
      const url = new URL(icon.src, manifestURL);
      assertPublicCopy(await get(url, app, icon.type), url, app);
    }
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map(match => attributes(match[0]));
    const scriptRefs = scripts.filter(script => script.src).map(script => script.src);
    const styles = links.filter(link => link.rel?.split(/\s+/).includes("stylesheet"));
    assert.ok(scriptRefs.length && styles.length, `${app.role} built JS/CSS references missing`);
    for (const reference of scriptRefs) await get(new URL(reference, htmlBase), app, "text/javascript");
    for (const style of styles) await get(new URL(style.href, htmlBase), app, "text/css");
    for (const link of links.filter(link => link.href && !styles.includes(link))) {
      const url = new URL(link.href, htmlBase);
      if ([".js", ".css"].includes(path.extname(url.pathname))) {
        await get(url, app, types[path.extname(url.pathname)]);
      }
    }
    console.log(`Pages HTTP paths verified: ${app.role} at ${app.prefix}`);
  }
  console.log(`Verified ${checked} HTTP responses from the final assembled artifact; no deployment performed`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
