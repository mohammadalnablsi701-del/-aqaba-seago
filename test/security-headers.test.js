import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('public HTTP responses include baseline security headers', async t => {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);

  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-dns-prefetch-control'), 'off');
  assert.equal(response.headers.get('x-download-options'), 'noopen');
  assert.equal(response.headers.get('x-permitted-cross-domain-policies'), 'none');
});
