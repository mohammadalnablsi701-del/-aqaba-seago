import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAuthorityRegistry, childEnvironment, cleanupAll, reject } from './policy.mjs';
import { databaseTests, unitTests } from './manifest.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const lane = process.argv[2];
const requested = process.argv.slice(3);
const approved = lane === 'db' ? databaseTests : lane === 'unit' ? unitTests : lane === 'safety' ? ['test/test-safety.test.js'] : [];
if (!approved.length || requested.some(file => !approved.includes(file))) reject();
const files = requested.length ? requested : approved;
let total = 0, passed = 0, failed = 0, skipped = 0;
let current;
let registry;
let replica;
let directory;
let interrupted = false;
const environment = childEnvironment(process.env);
// MongoMemoryReplSet also spawns native children. Scrub the runner before
// importing it, so neither those children nor MONGOMS_* overrides inherit live
// credentials or an externally selected executable/topology configuration.
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, environment);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true; current?.kill(); });

async function execute(file) {
  if (interrupted) reject();
  const args = lane === 'db'
    ? [join(root, 'scripts/test-safety/db-child.mjs'), resolve(root, file)]
    : ['--import', pathToFileURL(join(root, 'scripts/test-safety/unit-gate.mjs')).href, '--test', resolve(root, file)];
  const child = spawn(process.execPath, args, { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe', ...(lane === 'db' ? ['ipc'] : [])] });
  current = child;
  let output = '';
  const collect = bytes => {
    const chunk = bytes.toString(); output += chunk;
    if (chunk.includes('Disposable fixture verified:')) console.log('Disposable fixture verified before test import: runner authority, unique owned database, reserved-name guard, scrubbed environment');
  };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  let claimed = false;
  if (lane === 'db') child.on('message', message => {
    if (message?.kind !== 'seago-fixture') return;
    try {
      let value;
      if (message.operation === 'claim') {
        if (claimed) reject();
        value = registry.issue(child.pid); claimed = true;
      } else {
        registry.validate(child.pid, message.token);
        if (message.operation === 'allocate') value = registry.allocate(child.pid, message.token);
        else if (message.operation === 'check') { registry.validate(child.pid, message.token, message.name); value = true; }
        else if (message.operation === 'dropped') { registry.dropped(child.pid, message.token, message.name); value = true; }
        else reject();
      }
      if (child.connected) child.send({ kind: 'seago-fixture-result', id: message.id, ok: true, value });
    } catch { if (child.connected) child.send({ kind: 'seago-fixture-result', id: message.id, ok: false }); }
  });
  const timeout = setTimeout(() => child.kill(), 120_000);
  let code;
  try { code = await new Promise((done, fail) => { child.once('error', fail); child.once('close', done); }); }
  finally { clearTimeout(timeout); registry?.revoke(child.pid); current = undefined; }
  const count = key => Number([...output.matchAll(new RegExp(`^# ${key} (\\d+)`, 'gm'))].at(-1)?.[1] || 0);
  total += count('tests'); passed += count('pass'); failed += count('fail'); skipped += count('skipped');
  console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${file}: tests=${count('tests')} pass=${count('pass')} fail=${count('fail')} skipped=${count('skipped')}`);
  if (code !== 0) {
    // Never emit raw driver errors, URIs, provider credentials or environment.
    for (const line of output.split('\n').filter(line => /^(not ok|\s*(?:error:|code:|operator:|location:|failureType:))/.test(line))) {
      console.error(line.replace(/mongodb(?:\+srv)?:\/\/[^\s'"<>]+/gi, '[redacted database endpoint]'));
    }
    process.exitCode = 1;
  }
}
try {
  if (lane === 'db') {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    directory = await mkdtemp(join(tmpdir(), 'seago-disposable-'));
    replica = new MongoMemoryReplSet({ instanceOpts: [{ dbPath: directory, ip: '127.0.0.1' }], replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger' } });
    await replica.start(); await replica.waitUntilRunning();
    const port = replica.servers[0].instanceInfo?.port;
    registry = createAuthorityRegistry({ port });
    console.log('Runner-created isolated MongoMemoryReplSet ready; child environment allowlist active; live configuration excluded');
  }
  for (const file of files) await execute(file);
} catch {
  console.error('Test runner failed closed (configuration, fixture or execution failure)'); process.exitCode = 1;
} finally {
  try { await cleanupAll([
    async () => { if (current) { const child = current; child.kill(); await new Promise(done => child.once('close', done)); } },
    async () => { if (replica) await replica.stop(); },
    async () => {
      if (!directory) return;
      const target = resolve(directory);
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('seago-disposable-')) reject();
      await rm(target, { recursive: true, force: true });
    }
  ]); } catch (error) { console.error(error.message); process.exitCode = 1; }
  if (interrupted) process.exitCode = 1;
  console.log(`TOTAL lane=${lane} tests=${total} pass=${passed} fail=${failed} skipped=${skipped}`);
}
