import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTripImageDataUrl } from '../src/services/media.js';

function dataUrl(mime, bytes) {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

test('accepts declared JPG, PNG and WebP when file signatures match', () => {
  const jpeg = validateTripImageDataUrl(dataUrl('image/jpeg', [0xff,0xd8,0xff,0x00]));
  assert.equal(jpeg.mime, 'image/jpeg');

  const png = validateTripImageDataUrl(dataUrl('image/png', [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  assert.equal(png.mime, 'image/png');

  const webp = validateTripImageDataUrl(dataUrl('image/webp', Buffer.from('RIFFxxxxWEBP', 'ascii')));
  assert.equal(webp.mime, 'image/webp');
});

test('rejects executable/text content disguised as an allowed image MIME', () => {
  assert.throws(
    () => validateTripImageDataUrl(dataUrl('image/jpeg', Buffer.from('<script>alert(1)</script>'))),
    /does not match its declared type/
  );
});

test('rejects a MIME/signature mismatch', () => {
  const pngBytes = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
  assert.throws(
    () => validateTripImageDataUrl(dataUrl('image/jpeg', pngBytes)),
    /does not match its declared type/
  );
});

test('rejects SVG and malformed base64 payloads', () => {
  assert.throws(
    () => validateTripImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='),
    /Invalid image payload/
  );
  assert.throws(
    () => validateTripImageDataUrl('data:image/png;base64,not_base64!'),
    /Invalid image payload/
  );
});

test('rejects oversized image payloads before cloud upload', () => {
  const oversized = `data:image/jpeg;base64,${'A'.repeat(4_000_004)}`;
  assert.throws(() => validateTripImageDataUrl(oversized), /Image is too large/);
});
