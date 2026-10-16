import { randomBytes, randomUUID } from 'node:crypto';

export class SafetyError extends Error {
  constructor() { super('Disposable test safety gate rejected the operation'); this.code = 'TEST_SAFETY_REJECTED'; }
}
export const reject = () => { throw new SafetyError(); };
const reserved = new Set(['aqaba-seago', 'aqaba-seago-staging', 'admin', 'config', 'local']);
export function assertName(name) {
  if (typeof name !== 'string' || reserved.has(name.toLowerCase()) || !/^seago_fixture_[a-f0-9]{16}_[a-f0-9]{32}$/.test(name)) reject();
  return name;
}
export function assertEndpoint(uri) {
  if (typeof uri !== 'string' || !/^mongodb:\/\/127\.0\.0\.1:[1-9][0-9]*\/[A-Za-z0-9_]+\?directConnection=true$/.test(uri)) reject();
  let url;
  try { url = new URL(uri); } catch { reject(); }
  if (Number(url.port) > 65535 || url.username || url.password) reject();
  return url;
}
export function assertConnectionIdentity(options, endpoint, registered) {
  const expected = assertEndpoint(endpoint);
  if (!registered || !options || options.srvHost || options.credentials || options.directConnection !== true || options.hosts?.length !== 1 ||
      options.hosts[0].host !== '127.0.0.1' || options.hosts[0].port !== Number(expected.port)) reject();
}
export function childEnvironment(parent) {
  const result = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR']) {
    if (typeof parent[key] === 'string') result[key] = parent[key];
  }
  result.NODE_ENV = 'test';
  result.PUBLIC_LAUNCH = 'false';
  return result;
}
export async function cleanupAll(steps) {
  const failures = [];
  for (const [index, step] of steps.entries()) {
    try { await step(); } catch { failures.push(Object.assign(new SafetyError(), { step: index + 1 })); }
  }
  if (failures.length) throw new AggregateError(failures, `Test cleanup failed in step(s): ${failures.map(error => error.step).join(', ')}`);
}

// Only the runner holds this registry. A child cannot authorize itself by
// manufacturing environment variables, database names or an authority object.
export function createAuthorityRegistry({ port, now = Date.now, lifetimeMs = 30 * 60_000 }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) reject();
  const runId = randomBytes(8).toString('hex');
  const owners = new Map();
  function issue(pid) {
    if (!Number.isInteger(pid) || pid < 1 || owners.has(pid)) reject();
    const owner = { token: randomBytes(32).toString('hex'), expires: now() + lifetimeMs, names: new Set(), dropped: new Set() };
    owners.set(pid, owner);
    return { token: owner.token, expires: owner.expires };
  }
  function validate(pid, token, name) {
    const owner = owners.get(pid);
    if (!owner || typeof token !== 'string' || token !== owner.token || now() >= owner.expires) reject();
    if (name !== undefined && (!owner.names.has(assertName(name)) || owner.dropped.has(name))) reject();
    return owner;
  }
  function allocate(pid, token) {
    const owner = validate(pid, token);
    const name = assertName(`seago_fixture_${runId}_${randomUUID().replaceAll('-', '')}`);
    owner.names.add(name);
    return { name, uri: `mongodb://127.0.0.1:${port}/${name}?directConnection=true` };
  }
  return { issue, allocate, validate, revoke(pid) { owners.delete(pid); },
    dropped(pid, token, name) { validate(pid, token, name).dropped.add(name); } };
}
