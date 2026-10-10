import fs from "node:fs";
import path from "node:path";

function arg(name) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || "";
}

const expected = arg("expected").replace(/\/$/, "");
const forbidden = arg("forbidden").replace(/\/$/, "");
const rawBase = arg("base") || "/";
const base = rawBase.startsWith("/") ? rawBase : `/${rawBase}`;
const normalizedBase = base.endsWith("/") ? base : `${base}/`;
const dist = path.resolve("dist");
const indexPath = path.join(dist, "index.html");

function fail(message) {
  console.error(`Provider build verification failed: ${message}`);
  process.exit(1);
}

if (!expected) fail("missing --expected API URL");
if (!forbidden) fail("missing --forbidden API URL");
if (!fs.existsSync(indexPath)) fail("dist/index.html is missing");

const index = fs.readFileSync(indexPath, "utf8");
if (!/<!doctype html/i.test(index)) fail("dist/index.html does not contain a doctype");
if (!/id=["']root["']/i.test(index)) fail("dist/index.html does not contain the React root");

const refs = [...index.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
  .map(match => match[1])
  .filter(ref => !/^(?:https?:|data:|#)/i.test(ref));

if (!refs.some(ref => /assets\/.+\.js(?:[?#]|$)/.test(ref))) fail("index.html does not reference a JS asset");
if (!refs.some(ref => /assets\/.+\.css(?:[?#]|$)/.test(ref))) fail("index.html does not reference a CSS asset");

for (const ref of refs) {
  const clean = ref.split(/[?#]/, 1)[0];
  let relative = clean;
  if (relative.startsWith(normalizedBase)) relative = relative.slice(normalizedBase.length);
  else if (relative.startsWith("/")) relative = relative.slice(1);
  else relative = relative.replace(/^\.\//, "");
  if (!relative) continue;
  const file = path.join(dist, relative);
  if (!fs.existsSync(file)) fail(`referenced asset is missing: ${ref}`);
}

for (const required of ["manifest.webmanifest", "sw.js"]) {
  if (!fs.existsSync(path.join(dist, required))) fail(`${required} is missing`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(dist, "manifest.webmanifest"), "utf8"));
if (manifest.start_url !== "./" || manifest.scope !== "./") {
  fail("PWA manifest must keep relative start_url and scope");
}

const textExtensions = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".svg"]);
const text = [];

function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (textExtensions.has(path.extname(entry.name)) || entry.name.endsWith(".webmanifest")) {
      text.push(fs.readFileSync(full, "utf8"));
    }
  }
}

collect(dist);
const output = text.join("\n");

if (!output.includes(expected)) fail(`expected API URL not found in build output: ${expected}`);
if (output.includes(forbidden)) fail(`forbidden API URL found in build output: ${forbidden}`);

console.log(`Provider build verified: base=${normalizedBase} api=${expected}`);
