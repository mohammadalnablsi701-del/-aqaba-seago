import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

async function withServer(run) {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('rejects Mongo operator keys in JSON bodies', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: { $ne: null }, password: 'password123' })
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid request field' });
  });
});

test('rejects dotted and prototype-pollution style keys', async () => {
  await withServer(async base => {
    for (const body of [
      { 'profile.name': 'x' },
      { constructor: { prototype: { isAdmin: true } } }
    ]) {
      const response = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      assert.equal(response.status, 400);
    }
  });
});

test('rejects operator-shaped query keys', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/trips?filter%5B%24ne%5D=x`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid request field' });
  });
});

test('allows dollar signs in values because only keys are blocked', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user+$test@example.com', password: 'password123' })
    });
    assert.notEqual(response.status, 400);
  });
});
