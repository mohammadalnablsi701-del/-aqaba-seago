# Aqaba SeaGo — Staging to Production Promotion

## Branch roles

- `staging`: integration and validation branch. Railway Staging deploys only from this branch.
- `main`: production branch. Production deployment and GitHub Pages remain tied to `main`.

## Required flow

1. Make and review changes on `staging`.
2. Wait for GitHub Actions `CI` to pass on the exact `staging` commit.
3. Wait for GitHub Actions `Staging Smoke` to pass on the exact same commit.
   - `/ready` must return `ok: true`.
   - `/health` must report the exact commit SHA being tested.
   - `/api/trips` must remain reachable and return an array.
   - Staging must report `publicLaunch: false`.
4. Do not promote a commit while either workflow is pending, cancelled, or failed.
5. Merge the validated `staging` changes into `main`.
6. Production deploys from `main` only.
7. Wait for `Production Smoke` on `main` to pass before considering the release complete.

## Environment separation

Staging and production must never share database credentials. Staging currently uses its own Railway MongoDB single-node replica set so MongoDB transactions are available during booking/payment tests.

Staging safety settings:

- `NODE_ENV=staging`
- `PUBLIC_LAUNCH=false`
- `PAYMENT_PROVIDER=mock`
- `ENABLE_MOCK_CHECKOUT=true`
- `RUN_PILOT_E2E_ON_START=false`
- `SEED_DEMO_DATA=false`
- `CLEANUP_DEMO_ON_START=false`

Production must not inherit these Staging values.

## Release rule

A release is ready for production only when the exact commit intended for promotion has passed both `CI` and `Staging Smoke`. A green workflow from an older commit does not qualify.

## Emergency rule

If production needs an urgent hotfix, apply the fix to `main`, validate production, then bring that change back into `staging` before further feature work. This prevents long-term branch divergence.
