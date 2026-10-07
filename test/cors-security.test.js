import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

async function withEnv(overrides, run) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('production does not allow arbitrary browser origins when allowlist is empty', async () => {
  await withEnv({ NODE_ENV: 'production', ALLOWED_ORIGINS: '' }, async () => {
    await withServer(createApp(), async base => {
      const response = await fetch(`${base}/health`, {
        headers: { Origin: 'https://evil.example' }
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    });
  });
});

test('production allows an explicitly configured origin', async () => {
  const allowedOrigin = 'https://app.example.com';
  await withEnv({ NODE_ENV: 'production', ALLOWED_ORIGINS: allowedOrigin }, async () => {
    await withServer(createApp(), async base => {
      const response = await fetch(`${base}/health`, {
        headers: { Origin: allowedOrigin }
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
    });
  });
});

test('non-production keeps the empty-allowlist development fallback', async () => {
  await withEnv({ NODE_ENV: 'staging', ALLOWED_ORIGINS: '' }, async () => {
    await withServer(createApp(), async base => {
      const origin = 'https://local-preview.example';
      const response = await fetch(`${base}/health`, { headers: { Origin: origin } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
    });
  });
});
