# Render operational readiness

This document provides a non-runtime change for verifying the GitHub-to-Render deployment connection after adding Git deployment credentials.

## Required configuration

- Existing staging service: aqaba-seago-api-staging; branch: staging.
- Existing production service: aqaba-seago-api; branch: main.
- Auto-deploy: On Commit.
- Health check path: /health.
- Preserve service URLs and environment variables.

## Verification procedure

1. Open a pull request against staging and wait for every CI job to pass.
2. Merge the reviewed change into staging without bypassing checks.
3. Observe Render create a deployment for the exact merge commit automatically. Do not invoke a deploy API or manual deploy.
4. Record the Render deployment ID, trigger, commit, and final status.
5. Require /health to return HTTP 200 and identify the exact deployed merge commit. Run the existing read-only staging smoke checks.
6. Only after staging verification, promote through a CI-passing pull request to main and repeat automatic deployment verification and read-only production smoke checks.

The existing staging smoke workflow compares backend content, so it can pass for an older deployment with identical backend files. That alone is not evidence of automatic deployment: the Render deployment record and exact /health commit must also match the new merge commit.

Do not create or modify business records during these checks. Payment gateway selection and integration remain gated on completion of operational readiness.
