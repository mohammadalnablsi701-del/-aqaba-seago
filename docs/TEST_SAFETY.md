# Disposable test contract

Use the backend Node version declared in package.json, then `npm ci`.

- `npm run test:safety`: database-free negative safety regressions.
- `npm run test:unit`: explicit database-independent manifest; connection APIs are blocked.
- `npm run test:db`: runner-created local MongoMemoryReplSet only. Optional arguments are explicit manifest paths, for example `npm run test:db -- test/checkout-capacity.integration.test.js`.
- `npm test`: safety, unit, then disposable database lanes.

Database files cannot run directly. Missing fixture authority fails at module
loading; no environment URI grants authority and database tests never silently skip.
The runner owns an isolated temporary data directory and MongoDB process. A private
IPC channel binds each child PID to an expiring cryptographic token and independently
generated database identities. The parent checks ownership on every authorization.
Tokens and endpoints are never printed or stored in environment variables.

The driver gate validates every client before connection, restricts database handles
to allocated names, disables topology discovery through direct connections, and
checks the owned connection and parent authority immediately before database,
collection, index and document deletion. Cleanup refuses unknown, mismatched,
expired or already-disposed targets. Reserved names include aqaba-seago,
aqaba-seago-staging, admin, config and local. A localhost string or name prefix
alone never grants permission. Application code and the repository runner are
trusted code; this protects against configuration mistakes, not malicious code
rewriting the test gate itself.

Teardown attempts HTTP shutdown, guarded drops, connection closure, environment
restoration and temporary-file cleanup independently. The runner stops its replica
set and removes its directory even after failures, and reports cleanup failures.
Hard process termination can prevent JavaScript finalizers; CI uses disposable
runners and local leftover directories must never be interpreted as new authority.

CI uses this same runner. Runner and child environments allow only OS executable/temp settings
plus fixed test mode. Database, restore, Firebase, payment, delivery and unrelated
credentials, NODE_OPTIONS and NODE_PATH are excluded. Never start src/server.js,
load dotenv, or run live smoke/deployment workflows as test setup.

Production smoke contains only read checks. Password-reset mutation validation is
excluded; any future live mutation check requires a separately authorized workflow.
