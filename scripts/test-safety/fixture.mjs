import mongoose from 'mongoose';
import { Server } from 'node:net';
import { assertEndpoint, assertName, assertConnectionIdentity, cleanupAll, reject, SafetyError } from './policy.mjs';

let authority;
let sequence = 0;
const owned = new Map();
const disposed = new Set();
const clients = new WeakSet();
const pending = new Map();
const originalEnvironment = { ...process.env };
const extraCleanup = [];
const servers = new Set();

function rpc(operation, fields = {}) {
  if (!process.send || !process.connected) return Promise.reject(new SafetyError());
  const id = ++sequence;
  return new Promise((resolve, fail) => {
    const timer = setTimeout(() => { pending.delete(id); fail(new SafetyError()); }, 5000);
    pending.set(id, { resolve, fail, timer });
    process.send({ kind: 'seago-fixture', id, operation, token: authority?.token, ...fields });
  });
}
process.on('message', message => {
  if (message?.kind !== 'seago-fixture-result') return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id); clearTimeout(request.timer);
  if (message.ok) request.resolve(message.value); else request.fail(new SafetyError());
});
process.channel?.unref();

export async function initializeFixture() {
  if (authority || process.env.SEAGO_TEST_MONGODB_URI || process.env.MONGODB_URI) reject();
  authority = Object.freeze(await rpc('claim'));
  if (!authority || !/^[a-f0-9]{64}$/.test(authority.token) || !Number.isFinite(authority.expires) || authority.expires <= Date.now()) reject();
  await allocateDatabase();
  installDriverGate();
}
export function requireFixture() {
  if (!authority || authority.expires <= Date.now() || !process.connected || !owned.size) reject();
  return [...owned.values()][0];
}
export async function allocateDatabase() {
  const fixture = await rpc('allocate');
  assertName(fixture?.name); assertEndpoint(fixture?.uri);
  if (owned.has(fixture.name)) reject();
  const identity = Object.freeze({ name: fixture.name, uri: fixture.uri });
  owned.set(identity.name, identity);
  return identity;
}
function assertClient(client, name, connected = true) {
  requireFixture(); assertName(name);
  const fixture = owned.get(name);
  if (!fixture || disposed.has(name)) reject();
  assertConnectionIdentity(client?.options, fixture.uri, !connected || clients.has(client));
}
async function check(client, name, connected = true) {
  assertClient(client, name, connected);
  await rpc('check', { name });
  assertClient(client, name, connected);
}
function installDriverGate() {
  const listen = Server.prototype.listen;
  Server.prototype.listen = function (...args) { servers.add(this); return listen.apply(this, args); };
  const { MongoClient, Db, Collection } = mongoose.mongo;
  const connect = MongoClient.prototype.connect;
  MongoClient.prototype.connect = async function (...args) {
    await check(this, this.options.dbName, false);
    const result = await connect.apply(this, args);
    clients.add(this); return result;
  };
  const db = MongoClient.prototype.db;
  MongoClient.prototype.db = function (name, ...args) {
    assertClient(this, name ?? this.options.dbName, false);
    return db.call(this, name, ...args);
  };
  // Guard native driver operations as well as Mongoose, including destructive
  // operations reached inside business services and backup/restore helpers.
  for (const [prototype, methods, target] of [
    [Db.prototype, ['command', 'createCollection', 'dropDatabase', 'dropCollection'], value => [value.client, value.databaseName]],
    [Collection.prototype, ['drop', 'dropIndex', 'dropIndexes', 'deleteOne', 'deleteMany', 'findOneAndDelete',
      'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'bulkWrite',
      'insertOne', 'insertMany', 'createIndex', 'createIndexes', 'rename'], value => [value.client, value.dbName]]
  ]) for (const method of methods) {
    const original = prototype[method];
    prototype[method] = async function (...args) {
      const [client, name] = target(this); await check(client, name);
      return original.apply(this, args);
    };
  }
}
export async function connectFixture(options = {}, separate = false) {
  const fixture = requireFixture();
  await rpc('check', { name: fixture.name });
  if (separate) return mongoose.createConnection(fixture.uri, { ...options, dbName: fixture.name }).asPromise();
  return mongoose.connect(fixture.uri, { ...options, dbName: fixture.name });
}
export async function guardedDrop(connection) {
  const client = connection.getClient();
  const name = connection.name;
  await check(client, name);
  await connection.dropDatabase();
  await rpc('dropped', { name }); disposed.add(name);
}
export function addCleanup(step) { extraCleanup.push(step); }
export async function cleanupFixtures() {
  if (!authority) return;
  await cleanupAll([
    ...[...servers].map(server => () => server.listening ? new Promise((done, fail) => server.close(error => error ? fail(error) : done())) : undefined),
    ...extraCleanup,
    ...[...owned.values()].map(fixture => async () => {
      if (disposed.has(fixture.name)) return;
      const client = new mongoose.mongo.MongoClient(fixture.uri);
      await client.connect();
      try {
        await client.db(fixture.name).dropDatabase();
        await rpc('dropped', { name: fixture.name }); disposed.add(fixture.name);
      } finally { await client.close(); }
    }),
    () => mongoose.disconnect(),
    () => { for (const key of Object.keys(process.env)) if (!(key in originalEnvironment)) delete process.env[key]; Object.assign(process.env, originalEnvironment); },
    () => { process.disconnect?.(); }
  ]);
}
