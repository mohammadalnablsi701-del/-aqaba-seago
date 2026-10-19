# Aqaba SeaGo working rules

## Architecture and runtime

- Backend: Node/Express ES modules in `src/`; Mongoose models in `src/models/`, HTTP routes in `src/routes/`, business rules in `src/services/`. Preserve server-side pricing, commission, authorization, inventory and payment authority.
- Apps: `customer-app/` (React/Vite and Capacitor), `provider-app/` (React/Vite), `admin-app/` (React/Vite). Shared native push context is in `shared/`. Generated native trees and build outputs are not source.
- Use backend Node **20.20.2**, as pinned in `package.json`. Customer/mobile requires Node **>=22**, with **22** used by CI. Provider/Admin CI uses Node **20**; use a current compatible Node 20 patch (20.20.2 satisfies the current Vite requirement). Use each lockfile with `npm ci`; do not regenerate dependencies incidentally.
- Read current code and workflows before relying on older notes. Render URLs/hooks in the repository do not prove hosted configuration; some older promotion notes still mention Railway.

## Branches, review and deployment

- Fetch remote GitHub state and verify the requested baseline. Start a fresh task branch from the authorized `staging` commit; do not reuse an old local branch or local uncommitted work.
- Never push directly to `main` or `staging`, force-push them, or merge without authorization. Push only the task branch when authorized. Open a PR only when requested; target `staging` for implementation work.
- Require CI/review on the exact proposed commit, then staging validation after an authorized merge. A successful smoke check proves only its covered behavior. Current staging smoke permits equivalent backend content for documentation-only commits.
- Production promotion is a separately authorized PR/release from validated staging to `main`, with reviewed environment-specific artifacts, backup/rollback readiness and post-release verification. Never follow an older note suggesting a direct-main hotfix.
- Do not deploy, dispatch deployment/mobile/smoke workflows, change hosted settings, contact Production, or mutate Staging unless explicitly authorized for that task. Pages, Production Smoke and mobile release workflows have main/dispatch triggers; inspect triggers before any push or PR.
- Keep `PUBLIC_LAUNCH=false` for a controlled mock pilot. Never enable public launch until real payments and all launch requirements have evidence. The current flag checks alone do not prove readiness.

## Database and test safety

- Never use live business data for destructive tests. Do not create/delete bookings, payments, users, providers, trips, departures, tickets, QR/check-in records or other business data as incidental validation.
- Never load a live `.env`, start `src/server.js`, run legacy pilot/demo/migration helpers, or run backup/restore commands as test setup. Server startup and even departure/quote GET routes can release holds and mutate data.
- Follow `docs/TEST_SAFETY.md` and the explicit manifests in `scripts/test-safety/manifest.mjs`:
  - `npm run test:safety`: database-free safety regressions.
  - `npm run test:unit`: database-independent files, connection APIs blocked.
  - `npm run test:db`: only the Phase 1 runner-created local `MongoMemoryReplSet`; optional file arguments must be manifest entries.
  - `npm test`: all three lanes, when appropriate to the change and runtime capabilities.
- Never run database test files directly or bypass fixture gates. A localhost URI, test-looking database name, environment variable or external replica set does not grant disposable authority. Do not weaken scrubbing, IPC authority, ownership checks, reserved-name guards or cleanup.
- Database test writes/deletions are allowed only within that runner's owned disposable fixtures. For read-only/documentation tasks, prefer repository checks and database-free lanes; do not run live smoke checks.
- Run checks relevant to the change. Report actual counts, skipped/failed checks and environment limitations; distinguish executed evidence from tests merely present in source.

## Secrets and business safeguards

- Never commit secrets, service-account files, signing keys, tokens, database dumps or live customer data. Refer to configuration variable names only.
- Preserve provider ownership/capability checks, suspended-provider sales exclusions, audit trails, payment/refund idempotency and immutable financial snapshots. Treat Aladdin as unavailable until an explicitly authorized business confirmation and activation review; generic admin reactivation is not that confirmation.
- Treat pilot inventory, credentials, hosted backups, mail receipt, real payment movement and physical-device readiness as unverified until supported by task-authorized evidence. Record unresolved dependencies instead of inventing a pass.
