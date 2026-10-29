import { cleanupFixtures, requireFixture, connectFixture, addCleanup } from "../scripts/test-safety/fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import NotificationLog from "../src/models/NotificationLog.js";
import {
  assertApplySafety,
  assertCleanupTargetKnown,
  classifyDatabaseName,
  runLegacyNotificationLogCleanup
} from "../src/services/notificationLogPrivacyCleanup.js";

requireFixture();
test.after(cleanupFixtures);

function stableSnapshot(rows) {
  return JSON.stringify(rows.map(row => ({ ...row, _id: String(row._id) })));
}

test("cleanup target and apply guards fail closed", () => {
  assert.equal(classifyDatabaseName("aqaba-seago"), "production");
  assert.equal(classifyDatabaseName("aqaba-seago-staging"), "staging");
  assert.equal(classifyDatabaseName("aqaba-seago-task10a-test"), "test");
  assert.equal(classifyDatabaseName("unrelated"), "ambiguous");
  assert.throws(() => assertCleanupTargetKnown("unrelated"), /ambiguous/);
  assert.throws(
    () => assertApplySafety({ environment: "production", confirmation: undefined, declaredTarget: "production" }),
    /CONFIRM_NOTIFICATION_LOG_PRIVACY_CLEANUP=YES/
  );
  assert.throws(
    () => assertApplySafety({ environment: "production", confirmation: "YES", declaredTarget: "staging" }),
    /exactly match/
  );
  assert.doesNotThrow(() => assertApplySafety({ environment: "test", confirmation: "YES", declaredTarget: "test" }));
});

test("legacy NotificationLog cleanup is dry-run safe, bounded, auditable and idempotent on a disposable DB", {}, async () => {
  const connection = await connectFixture({ autoIndex: false }, true);

  addCleanup(() => connection.close());
  {

    const collection = connection.collection("notificationlogs");
    const createdAt = new Date("2026-09-01T10:00:00.000Z");
    const updatedAt = new Date("2026-09-01T10:05:00.000Z");
    const sentAt = new Date("2026-09-01T10:04:00.000Z");

    await collection.insertMany([
      { key: "fixture-a", type: "legacy", recipient: "legacy-a@example.test", status: "skipped", provider: "resend", createdAt, updatedAt },
      { key: "fixture-b", type: "legacy", recipient: "legacy-b@example.test", externalId: "resend_01HSAFE123", status: "sent", provider: "resend", createdAt, updatedAt, sentAt },
      { key: "fixture-c", type: "legacy", recipient: "legacy-c@example.test", error: "provider rejected legacy-c@example.test", status: "failed", provider: "resend", createdAt, updatedAt },
      { key: "fixture-d", type: "legacy", error: "raw provider failure", status: "failed", provider: "resend", createdAt, updatedAt },
      { key: "fixture-e", type: "modern", recipientHint: "m***@example.test", recipientFingerprint: "0123456789abcdef", errorCode: "email_delivery_rejected", status: "failed", provider: "resend", createdAt, updatedAt },
      { key: "fixture-f", type: "modern", providerMessageId: "resend_current_safe", status: "sent", provider: "resend", createdAt, updatedAt, sentAt },
      { key: "fixture-g", type: "legacy", metadata: { recipient: "legacy-g@example.test" }, headers: { authorization: "Bearer fixture-secret" }, deviceToken: "fixture-device-token", providerResponse: { body: "legacy response" }, status: "failed", provider: "resend", createdAt, updatedAt }
    ]);

    const beforeDryRun = await collection.find({}).sort({ key: 1 }).toArray();
    const dryRun = await runLegacyNotificationLogCleanup(collection, { apply: false });
    const afterDryRun = await collection.find({}).sort({ key: 1 }).toArray();

    assert.equal(stableSnapshot(afterDryRun), stableSnapshot(beforeDryRun));
    assert.equal(dryRun.totalScanned, 7);
    assert.equal(dryRun.totalMatched, 5);
    assert.equal(dryRun.recordsWouldChange, 5);
    assert.equal(dryRun.recordsSkipped, 2);
    assert.equal(dryRun.recipientPlaintextCount, 3);
    assert.equal(dryRun.rawErrorCount, 2);
    assert.equal(dryRun.safeExternalIdCount, 1);
    assert.equal(dryRun.unsafeTokenCredentialCount, 1);
    assert.deepEqual(dryRun.classificationCounts, {
      recipientOnly: 1,
      rawLegacyError: 2,
      legacyExternalId: 1,
      recipientAndRawError: 1,
      recipientAndExternalId: 1,
      extraUnsafeCredential: 1
    });

    const apply = await runLegacyNotificationLogCleanup(collection, { apply: true, batchSize: 2 });
    assert.equal(apply.recordsWouldChange, 5);

    const rows = new Map((await collection.find({}).toArray()).map(row => [row.key, row]));
    for (const key of ["fixture-a", "fixture-b", "fixture-c"]) {
      assert.equal("recipient" in rows.get(key), false);
    }
    for (const key of ["fixture-c", "fixture-d"]) {
      assert.equal("error" in rows.get(key), false);
      assert.equal(rows.get(key).errorCode, "legacy_error_redacted");
    }
    assert.equal("externalId" in rows.get("fixture-b"), false);
    assert.equal(rows.get("fixture-b").providerMessageId, "resend_01HSAFE123");
    for (const field of ["metadata", "headers", "deviceToken", "providerResponse"]) {
      assert.equal(field in rows.get("fixture-g"), false);
    }
    assert.equal(rows.get("fixture-g").errorCode, "legacy_error_redacted");

    assert.equal(rows.get("fixture-a").createdAt.toISOString(), createdAt.toISOString());
    assert.equal(rows.get("fixture-a").updatedAt.toISOString(), updatedAt.toISOString());
    assert.equal(rows.get("fixture-b").sentAt.toISOString(), sentAt.toISOString());

    assert.deepEqual(rows.get("fixture-e"), beforeDryRun.find(row => row.key === "fixture-e"));
    assert.deepEqual(rows.get("fixture-f"), beforeDryRun.find(row => row.key === "fixture-f"));

    const secondRun = await runLegacyNotificationLogCleanup(collection, { apply: true });
    assert.equal(secondRun.totalMatched, 0);
    assert.equal(secondRun.recordsWouldChange, 0);

    const ModernNotificationLog = connection.model("Task10AModernNotificationLog", NotificationLog.schema, "notificationlogs");
    await ModernNotificationLog.create({
      key: "future-write-regression",
      type: "email_test",
      recipientHint: "n***@example.test",
      recipientFingerprint: "abcdef0123456789",
      recipient: "must-not-persist@example.test",
      error: "must-not-persist raw provider error",
      status: "failed",
      provider: "resend",
      errorCode: "email_delivery_rejected"
    });
    const futureRaw = await collection.findOne({ key: "future-write-regression" });
    assert.equal("recipient" in futureRaw, false);
    assert.equal("error" in futureRaw, false);
    assert.equal(futureRaw.errorCode, "email_delivery_rejected");
  }
});
