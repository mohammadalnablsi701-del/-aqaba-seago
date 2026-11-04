import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Fully decode the delivered RGB/RGBA PNG format: dimensions alone missed the
// historical corrupt IDAT payloads. No image package or platform tool is needed.
export function readPng(path, size, channels = 3) {
  const bytes = readFileSync(path);
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `PNG signature: ${path}`);
  let offset = 8, header, ended = false;
  const compressed = [];
  while (offset < bytes.length) {
    assert(offset + 12 <= bytes.length, `Truncated PNG chunk: ${path}`);
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    assert(end <= bytes.length, `Truncated PNG data: ${path}`);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, end - 4);
    assert.equal(crc32(bytes.subarray(offset + 4, end - 4)), bytes.readUInt32BE(end - 4), `PNG ${type} CRC: ${path}`);
    if (!header) assert.equal(type, "IHDR", `First PNG chunk: ${path}`);
    if (type === "IHDR") {
      assert(!header && length === 13, `PNG header: ${path}`);
      header = data;
    }
    if (type === "IDAT") compressed.push(data);
    offset = end;
    if (type === "IEND") { assert.equal(length, 0); ended = true; break; }
  }
  assert(ended && offset === bytes.length && compressed.length, `PNG termination/data: ${path}`);
  assert.equal(header.readUInt32BE(0), size, `PNG width: ${path}`);
  assert.equal(header.readUInt32BE(4), size, `PNG height: ${path}`);
  assert.equal(header[8], 8, `PNG depth: ${path}`);
  assert.equal(header[9], channels === 4 ? 6 : 2, `PNG RGB/RGBA format: ${path}`);
  assert(header.subarray(10).equals(Buffer.from([0, 0, 0])), `Unsupported PNG compression/filter/interlace: ${path}`);
  const stride = size * channels;
  const filtered = inflateSync(Buffer.concat(compressed), { maxOutputLength: size * (stride + 1) });
  assert.equal(filtered.length, size * (stride + 1), `PNG raster length: ${path}`);
  const pixels = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    const filter = filtered[y * (stride + 1)];
    assert(filter <= 4, `PNG filter: ${path}`);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= channels ? pixels[i - channels] : 0;
      const b = y ? pixels[i - stride] : 0;
      const c = y && x >= channels ? pixels[i - stride - channels] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      pixels[i] = (filtered[y * (stride + 1) + 1 + x] + predictor) & 255;
    }
  }
  return pixels;
}

function safeCircle(pixels, size, background, radius) {
  const channels = background ? 3 : 4;
  let visible = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * channels;
    const marked = background ? background.some((value, c) => pixels[i + c] !== value) : pixels[i + 3] > 0;
    if (marked) {
      visible++;
      assert(Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= radius, "Essential artwork exceeds icon safe circle");
    }
  }
  assert(visible, "Icon artwork is empty");
}

export function verify(app) {
  assert(["customer", "provider"].includes(app), "Usage: node scripts/verify-launcher-icons.mjs <customer|provider>");
  const publicDir = resolve(root, `${app}-app/public`);
  const local = (href) => {
    assert(href.startsWith("./") && !href.includes("#"), `Relative icon reference required: ${href}`);
    const path = resolve(publicDir, href.split("?")[0]);
    assert(path.startsWith(publicDir + sep), `Icon path outside public directory: ${href}`);
    return path;
  };
  const background = app === "customer" ? [250, 247, 240] : [7, 31, 51];
  const manifest = JSON.parse(readFileSync(resolve(publicDir, "manifest.webmanifest"), "utf8"));
  for (const purpose of ["any", "maskable"]) for (const size of [192, 512]) {
    const icon = manifest.icons.find((item) => item.type === "image/png" && item.sizes === `${size}x${size}` && item.purpose === purpose);
    assert(icon, `Missing ${app} ${purpose} PNG ${size}`);
    const pixels = readPng(local(icon.src), size);
    safeCircle(pixels, size, background, size * (purpose === "maskable" ? 0.4 : 0.5));
  }
  const html = readFileSync(resolve(root, `${app}-app/index.html`), "utf8");
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map(([tag]) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));
  const touch = links.find((link) => link.rel === "apple-touch-icon");
  if (app === "customer") {
    // Staging iPhone test PR #234: manifest-only icon avoids Cannot Add Page regression.
    assert(!touch, "Customer must use manifest PNG for Safari Add to Home Screen");
    readPng(resolve(publicDir, "customer-apple-touch-icon-a-v1.png"), 180);
  } else {
    assert(touch && touch.sizes === "180x180", "Missing Apple touch icon");
    readPng(local(touch.href), 180);
  }
  for (const icon of manifest.icons.filter((item) => item.type === "image/svg+xml")) assert(readFileSync(local(icon.src), "utf8").includes("<svg"));
  const favicon = links.find((link) => link.rel === "icon" && link.type === "image/svg+xml");
  assert(favicon && readFileSync(local(favicon.href), "utf8").includes("<svg"), "Missing SVG favicon");
  if (app === "customer") {
    const assets = resolve(root, "customer-app/assets");
    const master = readPng(resolve(assets, "icon-master-1024.png"), 1024);
    safeCircle(master, 1024, background, 512);
    const foreground = readPng(resolve(assets, "android-adaptive-foreground-432.png"), 432, 4);
    safeCircle(foreground, 432, null, 132);
    const layer = readPng(resolve(assets, "android-adaptive-background-432.png"), 432);
    for (let i = 0; i < layer.length; i++) assert.equal(layer[i], background[i % 3], "Unexpected adaptive background");
    assert(readFileSync(resolve(assets, "logo.svg")).equals(readFileSync(local(favicon.href))), "Customer native/web SVGs differ");
    const sw = readFileSync(resolve(publicDir, "sw.js"), "utf8");
    const pushIcon = sw.match(/icon:\s*"([^"]+)"/)?.[1];
    assert.equal(local(pushIcon || ""), resolve(publicDir, "customer-apple-touch-icon-a-v1.png"), "Stale Customer push icon");
  }
  console.log(`${app}: launcher PNG decode/CRC, dimensions, alpha, safe zones and references PASS`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  verify(process.argv[2]);
}
