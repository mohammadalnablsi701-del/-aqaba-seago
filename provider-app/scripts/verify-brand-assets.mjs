import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");

const expected = [
  { file: "public/provider-icon-512.png", kind: "png", width: 512, height: 512 },
  { file: "public/provider-apple-touch-icon.png", kind: "png", width: 180, height: 180 },
  { file: "public/provider-icon-192.webp", kind: "webp", width: 192, height: 192 },
];

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function verifyPng(buffer, expectedWidth, expectedHeight, label) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) throw new Error(`${label}: invalid PNG signature`);

  let offset = 8;
  let width, height, bitDepth, colorType, interlace;
  const idat = [];
  let sawIend = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    const next = crcOffset + 4;
    if (next > buffer.length) throw new Error(`${label}: truncated PNG chunk`);

    const type = buffer.subarray(typeStart, dataStart).toString("ascii");
    const data = buffer.subarray(dataStart, dataEnd);
    const storedCrc = buffer.readUInt32BE(crcOffset);
    const actualCrc = crc32(buffer.subarray(typeStart, dataEnd));
    if (storedCrc !== actualCrc) throw new Error(`${label}: bad CRC in ${type}`);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      sawIend = true;
      if (next !== buffer.length) throw new Error(`${label}: trailing bytes after IEND`);
      break;
    }
    offset = next;
  }

  if (!sawIend || !width || !height || idat.length === 0) throw new Error(`${label}: incomplete PNG`);
  if (width !== expectedWidth || height !== expectedHeight) throw new Error(`${label}: expected ${expectedWidth}x${expectedHeight}, got ${width}x${height}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (interlace === 0) {
    const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
    if (!channels) throw new Error(`${label}: unsupported PNG color type ${colorType}`);
    const rowBytes = Math.ceil(width * channels * bitDepth / 8);
    const expectedRawLength = (rowBytes + 1) * height;
    if (raw.length !== expectedRawLength) throw new Error(`${label}: decoded PNG length ${raw.length} != ${expectedRawLength}`);
  }
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function verifyWebp(buffer, expectedWidth, expectedHeight, label) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") throw new Error(`${label}: invalid WebP RIFF header`);
  const declaredSize = buffer.readUInt32LE(4) + 8;
  if (declaredSize !== buffer.length) throw new Error(`${label}: WebP RIFF size mismatch`);

  let offset = 12;
  let width, height;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > buffer.length) throw new Error(`${label}: truncated ${type} chunk`);

    if (type === "VP8X") {
      width = readUInt24LE(buffer, data + 4) + 1;
      height = readUInt24LE(buffer, data + 7) + 1;
      break;
    }
    if (type === "VP8 ") {
      if (buffer[data + 3] !== 0x9d || buffer[data + 4] !== 0x01 || buffer[data + 5] !== 0x2a) throw new Error(`${label}: invalid VP8 frame header`);
      width = buffer.readUInt16LE(data + 6) & 0x3fff;
      height = buffer.readUInt16LE(data + 8) & 0x3fff;
      break;
    }
    if (type === "VP8L") {
      if (buffer[data] !== 0x2f) throw new Error(`${label}: invalid VP8L signature`);
      const bits = buffer.readUInt32LE(data + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      break;
    }
    offset = data + size + (size & 1);
  }

  if (!width || !height) throw new Error(`${label}: no supported WebP image chunk`);
  if (width !== expectedWidth || height !== expectedHeight) throw new Error(`${label}: expected ${expectedWidth}x${expectedHeight}, got ${width}x${height}`);
}

for (const asset of expected) {
  const fullPath = path.join(root, asset.file);
  const buffer = fs.readFileSync(fullPath);
  if (asset.kind === "png") verifyPng(buffer, asset.width, asset.height, asset.file);
  else verifyWebp(buffer, asset.width, asset.height, asset.file);
  console.log(`brand asset OK: ${asset.file} (${asset.width}x${asset.height})`);
}
