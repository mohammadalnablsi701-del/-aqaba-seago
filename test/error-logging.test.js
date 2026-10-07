import test from 'node:test';
import assert from 'node:assert/strict';
import { productionErrorMetadata, logRequestError } from '../src/utils/errorLogging.js';

test('production error metadata excludes message, stack and arbitrary sensitive properties', () => {
  const err = new Error('user@example.com token=super-secret');
  err.statusCode = 500;
  err.code = 'DB_TIMEOUT';
  err.customerPhone = '+962799999999';
  err.stack = 'STACK super-secret';

  const metadata = productionErrorMetadata(err);
  const serialized = JSON.stringify(metadata);

  assert.equal(metadata.event, 'request_error');
  assert.equal(metadata.statusCode, 500);
  assert.equal(metadata.errorName, 'Error');
  assert.equal(metadata.code, 'DB_TIMEOUT');
  assert.equal('message' in metadata, false);
  assert.equal('stack' in metadata, false);
  assert.equal('customerPhone' in metadata, false);
  assert.doesNotMatch(serialized, /user@example\.com|super-secret|962799999999/);
});

test('unsafe or unbounded error codes are omitted from production metadata', () => {
  const metadata = productionErrorMetadata({
    statusCode: 400,
    name: 'ValidationError',
    code: 'bad code with spaces and secret@example.com'
  });
  assert.equal(metadata.statusCode, 400);
  assert.equal(metadata.errorName, 'ValidationError');
  assert.equal('code' in metadata, false);
});

test('production logger emits structured metadata only', () => {
  const previousEnv = process.env.NODE_ENV;
  const previousConsoleError = console.error;
  const calls = [];
  process.env.NODE_ENV = 'production';
  console.error = value => calls.push(String(value));

  try {
    const err = new Error('private payload: secret@example.com');
    err.statusCode = 500;
    err.requestBody = { email: 'secret@example.com', token: 'abc123' };
    logRequestError(err);
  } finally {
    console.error = previousConsoleError;
    if (previousEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }

  assert.equal(calls.length, 1);
  const logged = JSON.parse(calls[0]);
  assert.equal(logged.event, 'request_error');
  assert.equal(logged.statusCode, 500);
  assert.doesNotMatch(calls[0], /secret@example\.com|abc123|private payload/);
});
