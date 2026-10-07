# Aqaba SeaGo — Monitoring & Operational Alerts Runbook

This runbook describes the monitoring controls currently implemented for Aqaba SeaGo and the remaining escalation gaps that must be closed before broad public real-money launch.

## 1. Production uptime monitor

GitHub Actions workflow: `.github/workflows/uptime-monitor.yml`

Schedule: every 15 minutes, plus manual workflow dispatch.

The workflow checks the real production surfaces, not mocks:

- API `/ready` returns HTTP 200, `ok: true`, and a connected/healthy database state.
- API `/health` returns HTTP 200 and `ok: true`.
- Public `/api/trips` returns a JSON array.
- Customer web app is reachable.
- Provider web app is reachable.
- Admin web app is reachable.

Each check retries up to three times with network timeouts to reduce false positives from transient failures. A persistent failure fails the GitHub Actions run and emits an Actions error annotation.

### Persistent incident escalation

If a scheduled uptime run still fails after retries, the workflow creates a repository issue titled `[Uptime] Production availability incident`. If that incident is already open, later failures add a timestamped comment instead of creating duplicate issues. When all uptime checks recover, the workflow comments on the open incident and closes it automatically.

This gives the project a durable, searchable incident record even if an individual Actions failure is missed. Delivery of push/email notifications for that GitHub issue still depends on the account's GitHub notification settings; Slack, Discord, PagerDuty or another independent escalation channel is not configured yet.

### Uptime incident response

When the uptime workflow or automated incident reports a failure:

1. Confirm which exact check failed in the workflow log.
2. If the API failed, inspect Render deployment status, recent events and application/request logs.
3. Check `/health` and `/ready` independently.
4. Confirm the deployed commit matches the expected `main` release.
5. If only GitHub Pages failed, inspect the Pages workflow and deployed `version.json`.
6. Do not redeploy blindly if there is evidence of a database, payment or data-integrity incident.
7. Record the incident cause and resolution. The automated issue remains the primary incident timeline for uptime failures.

## 2. Admin operations queue

Protected endpoint: `GET /api/admin/operations`

Access: authenticated `admin` role only.

It exposes bounded operational counts and queues for:

- Payments in `needs_review`.
- Notification failures created in the last 24 hours.
- Open or in-progress support requests.

The response intentionally selects a limited set of payment/notification fields. Notification error text is truncated. The endpoint is covered by an integration test that verifies unauthenticated users receive 401, non-admin customers receive 403, and admins receive the expected counts.

### `needs_review` response

Treat every `needs_review` payment as requiring human reconciliation before any manual financial correction:

1. Identify the payment and related booking/hold.
2. Confirm gateway/provider status using the provider transaction reference when a real gateway is integrated.
3. Confirm whether inventory was reserved/released and whether a booking exists.
4. Do not create a second booking or manually mark a payment paid without reconciling the original event history.
5. Record the resolution and any refund/recovery action.

## 3. Notification failures

`NotificationLog` already records sent/failed/skipped notification attempts. The operations queue reports failed notifications from the last 24 hours.

Until a production email sender/domain is configured, email alert thresholds remain incomplete. After sender configuration, define an escalation threshold based on real traffic, for example repeated failures within a rolling window rather than a single isolated failure.

## 4. Payment webhook failures

Webhook processing failures emit a bounded structured application log only when the route provider matches the configured payment provider. The log contains:

- event: `payment_webhook_failure`
- provider
- HTTP/status code
- bounded error message
- timestamp

The raw webhook body, payment signature and secrets are not intentionally logged by this monitoring event.

A repeated-failure threshold and external escalation channel must be added after the real payment gateway is selected because the final retry/signature/error semantics depend on that gateway.

## 5. Log handling

Current rules for new operational monitoring code:

- Do not log raw payment webhook bodies.
- Do not log webhook signatures or secrets.
- Keep error messages bounded.
- Keep admin operational queues authenticated and role-restricted.

A complete production log-retention policy and repository-wide PII/logging review are still required before broad public launch.

## 6. Current monitoring status

Implemented and validated in code/Staging:

- Health/readiness endpoints.
- Commit identity in `/health`.
- Release-time Production Smoke.
- Scheduled 15-minute production uptime checks.
- Persistent GitHub incident issue creation/update/recovery closure for uptime failures.
- Protected admin operations queue for `needs_review`, notification failures and support workload.
- Structured payment-webhook failure logging with no raw webhook payload/signature.
- Integration tests for operations-queue authorization and counts.

Still open:

- Verify the first scheduled production uptime execution after the incident-escalation workflow is promoted to `main`.
- Optional independent escalation channel outside GitHub if required operationally.
- Repeated payment-webhook failure threshold/alert after the real gateway is integrated.
- Email-delivery failure threshold/alert after the production sender is configured.
- Formal log-retention period.
- Full PII/logging review.
