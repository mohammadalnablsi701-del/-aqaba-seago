import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createAuthorityRegistry, assertName, assertEndpoint, assertConnectionIdentity, childEnvironment, cleanupAll, SafetyError } from '../scripts/test-safety/policy.mjs';
import { requireFixture, guardedDrop } from '../scripts/test-safety/fixture.mjs';
import { databaseTests, unitTests } from '../scripts/test-safety/manifest.mjs';

function registryFixture() {
  let clock = 100;
  const registry = createAuthorityRegistry({ port: 27017, now: () => clock, lifetimeMs: 10 });
  const authority = registry.issue(123);
  const fixture = registry.allocate(123, authority.token);
  return { registry, authority, fixture, expire: () => { clock = 110; } };
}
test('missing authority rejects before connection or cleanup', async () => {
  assert.throws(requireFixture, SafetyError);
  let drops = 0;
  await assert.rejects(guardedDrop({ getClient: () => ({}), name: 'aqaba-seago', dropDatabase: () => { drops++; } }), SafetyError);
  assert.equal(drops, 0);
});
test('forged authority and different owner cannot authorize', () => {
  const { registry, authority, fixture } = registryFixture();
  for (const token of [undefined, null, {}, 'forged', authority.token + '0']) assert.throws(() => registry.validate(123, token, fixture.name), SafetyError);
  assert.throws(() => registry.validate(124, authority.token, fixture.name), SafetyError);
});
test('different fixture registry rejects otherwise valid authority', () => {
  const first = registryFixture(), second = registryFixture();
  assert.throws(() => second.registry.validate(123, first.authority.token, first.fixture.name), SafetyError);
});
test('unknown database name rejects even with valid authority', () => {
  const { registry, authority } = registryFixture();
  assert.throws(() => registry.validate(123, authority.token, `seago_fixture_${'a'.repeat(16)}_${'b'.repeat(32)}`), SafetyError);
});
for (const name of ['aqaba-seago', 'aqaba-seago-staging', 'admin', 'config', 'local']) test(`reserved database ${name} is denied`, () => {
  assert.throws(() => assertName(name), SafetyError);
  const { registry, authority } = registryFixture();
  assert.throws(() => registry.validate(123, authority.token, name), SafetyError);
});
test('malformed database identities are denied', () => {
  for (const name of [undefined, null, {}, '', 'seago_fixture_fake', 'ADMIN']) assert.throws(() => assertName(name), SafetyError);
});
test('external, authenticated, SRV and multi-host endpoints are denied', () => {
  for (const uri of [undefined, {}, '', 'mongodb://remote.example:27017/test', 'mongodb+srv://remote.example/test',
    'mongodb://127.0.0.1:27017,remote.example:27017/test?directConnection=true', 'mongodb://user:password@127.0.0.1:27017/test?directConnection=true',
    'mongodb://127.0.0.1:27017/test?replicaSet=external', 'mongodb://127.0.0.1:70000/test?directConnection=true']) assert.throws(() => assertEndpoint(uri), SafetyError);
});
test('connection identity rejects mismatched endpoint, topology and unregistered client', () => {
  const options = { hosts: [{ host: '127.0.0.1', port: 27017 }], directConnection: true };
  const endpoint = 'mongodb://127.0.0.1:27017/test?directConnection=true';
  assert.doesNotThrow(() => assertConnectionIdentity(options, endpoint, true));
  assert.throws(() => assertConnectionIdentity(options, endpoint, false), SafetyError);
  for (const override of [{ directConnection: false }, { hosts: [{ host: '127.0.0.1', port: 27018 }] },
    { hosts: [{ host: 'remote.example', port: 27017 }] }, { hosts: [...options.hosts, ...options.hosts] }, { credentials: {} }, { srvHost: 'remote.example' }]) {
    assert.throws(() => assertConnectionIdentity({ ...options, ...override }, endpoint, true), SafetyError);
  }
});
test('expired, revoked and already-dropped fixture identities cannot be reused', () => {
  const first = registryFixture(); first.expire();
  assert.throws(() => first.registry.validate(123, first.authority.token, first.fixture.name), SafetyError);
  const second = registryFixture(); second.registry.dropped(123, second.authority.token, second.fixture.name);
  assert.throws(() => second.registry.validate(123, second.authority.token, second.fixture.name), SafetyError);
  const third = registryFixture(); third.registry.revoke(123);
  assert.throws(() => third.registry.validate(123, third.authority.token, third.fixture.name), SafetyError);
  assert.throws(() => second.registry.issue(123), SafetyError);
});
test('each allocation has an independent cryptographic identity', () => {
  const { registry, authority, fixture } = registryFixture();
  const another = registry.allocate(123, authority.token);
  assert.notEqual(fixture.name, another.name);
  assert.notEqual(fixture.uri, another.uri);
  assert.ok(fixture.name.length <= 63);
});
test('cleanup failures preserve later cleanup attempts and report all failures safely', async () => {
  const steps = [];
  await assert.rejects(cleanupAll([
    () => { steps.push('server'); throw new Error('private detail'); },
    () => { steps.push('drop'); throw new Error('private detail'); },
    () => steps.push('connection'), () => steps.push('environment'), () => steps.push('files'), () => steps.push('replica')
  ]), error => error instanceof AggregateError && error.errors.length === 2 && !JSON.stringify(error).includes('private detail'));
  assert.deepEqual(steps, ['server', 'drop', 'connection', 'environment', 'files', 'replica']);
});
test('child environment allowlist excludes every live database and credential class', () => {
  const forbidden = ['MONGODB_URI', 'SEAGO_TEST_MONGODB_URI', 'RESTORE_MONGODB_URI', 'DB_BACKUP_DATABASE', 'RESTORE_DATABASE',
    'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_PROJECT_ID', 'RESEND_API_KEY', 'JWT_SECRET', 'MOCK_PAYMENT_WEBHOOK_SECRET', 'NODE_OPTIONS', 'NODE_PATH'];
  const env = childEnvironment(Object.fromEntries([...forbidden.map(key => [key, 'private']), ['PATH', 'bin']]));
  assert.deepEqual(env, { PATH: 'bin', NODE_ENV: 'test', PUBLIC_LAUNCH: 'false' });
});
test('all 31 database files require authority and cannot skip on missing URI', () => {
  assert.equal(databaseTests.length, 31);
  assert.equal(new Set([...databaseTests, ...unitTests]).size, 80);
  for (const file of databaseTests) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /requireFixture\(\)/);
    assert.doesNotMatch(source, /skip:|process\.env\.SEAGO_TEST_MONGODB_URI|dropDatabase\(|mongoose\.connect\(/);
  }
});
test('direct database entry fails without authority even with an inherited URI', () => {
  const child = spawnSync(process.execPath, ['test/android-fcm.integration.test.js'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8',
    env: { ...childEnvironment(process.env), SEAGO_TEST_MONGODB_URI: 'mongodb://remote.invalid:27017/aqaba-seago' }
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /Disposable test safety gate rejected/);
  assert.doesNotMatch(child.stderr, /remote\.invalid/);
});
