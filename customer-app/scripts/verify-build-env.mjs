import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const values = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    values[key] = rest.join("=");
  }
  return values;
}

const args = parseArgs(process.argv.slice(2));
const expected = String(args.expected || "").replace(/\/$/, "");
const forbidden = String(args.forbidden || "").replace(/\/$/, "");
const expectedBase = String(args.base || "/");
const label = String(args.label || "Customer");
const distDir = path.resolve(process.cwd(), args.dist || "dist");

function fail(message) {
  console.error(`Customer build verification failed (${label}): ${message}`);
  process.exit(1);
}

if (!expected) fail("--expected API is required");
if (!forbidden) fail("--forbidden API is required");
if (expected === forbidden) fail("expected and forbidden APIs must differ");
if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
  fail(`artifact directory not found: ${distDir}`);
}

const indexPath = path.join(distDir, "index.html");
if (!fs.existsSync(indexPath)) fail("index.html is missing from Customer artifact");
const indexHtml = fs.readFileSync(indexPath, "utf8");
if (!/<!doctype html/i.test(indexHtml)) fail("index.html is not a valid HTML document");
if (!/id=["']root["']/.test(indexHtml)) fail("Customer root mount is missing from index.html");

const base = expectedBase.endsWith("/") ? expectedBase : `${expectedBase}/`;
const assetRefs = [...indexHtml.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)].map((m) => m[1]);
if (!assetRefs.length) fail("no JS/CSS assets referenced by index.html");
for (const ref of assetRefs) {
  let relative = ref;
  if (relative.startsWith(base)) relative = relative.slice(base.length);
  else if (relative.startsWith("/")) relative = relative.slice(1);
  relative = relative.replace(/^\.\//, "").split(/[?#]/, 1)[0];
  const target = path.join(distDir, relative);
  if (!fs.existsSync(target)) fail(`referenced asset is missing: ${ref}`);
}

for (const required of ["manifest.webmanifest", "sw.js"]) {
  if (!fs.existsSync(path.join(distDir, required))) fail(`${required} is missing from Customer artifact`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(distDir, "manifest.webmanifest"), "utf8"));
if (manifest.start_url !== "./" || manifest.scope !== "./") {
  fail("manifest start_url/scope must remain relative");
}

const textExtensions = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".svg", ".txt", ".map"]);
const files = [];
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (textExtensions.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
}
collect(distDir);
const combined = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");

if (!combined.includes(expected)) {
  fail(`Expected API not found in Customer artifact: ${expected}`);
}
if (combined.includes(forbidden)) {
  fail(`Forbidden API found in Customer artifact: ${forbidden}`);
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:API|GATEWAY|WEBHOOK|CLIENT|ADMIN|STRIPE|PAYTABS|MYFATOORAH|TAP)[_-]?(?:SECRET|PRIVATE_KEY)\b\s*[:=]/i,
  /\bADMIN[_-]?TOKEN\b\s*[:=]/i,
  /\bsk_live_[A-Za-z0-9_-]{12,}\b/
];
for (const pattern of secretPatterns) {
  if (pattern.test(combined)) fail(`possible frontend secret detected by pattern ${pattern}`);
}

console.log(`Customer build verification passed (${label})`);
console.log(`Artifact: ${distDir}`);
console.log(`Expected API: ${expected}`);
console.log(`Forbidden API absent: ${forbidden}`);
console.log(`Text files scanned: ${files.length}`);
