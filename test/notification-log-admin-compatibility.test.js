import test from "node:test";
import assert from "node:assert/strict";
import NotificationLog from "../src/models/NotificationLog.js";

test("legacy NotificationLog JSON never exposes plaintext recipient or raw error", () => {
  const legacy = NotificationLog.hydrate({
    _id: "507f1f77bcf86cd799439011",
    key: "legacy-admin-shape",
    type: "legacy",
    recipient: "legacy@example.test",
    error: "raw provider error containing private material",
    externalId: "legacy_external_safe",
    status: "failed",
    provider: "resend",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z")
  }).toJSON();

  assert.equal(legacy.recipient, null);
  assert.equal(legacy.error, null);
  assert.equal(legacy.externalId, "legacy_external_safe");
  assert.doesNotMatch(JSON.stringify(legacy), /legacy@example\.test|raw provider error/);
});

test("legacy NotificationLog JSON drops unsafe external IDs", () => {
  const legacy = NotificationLog.hydrate({
    _id: "507f1f77bcf86cd799439013",
    key: "legacy-unsafe-external",
    type: "legacy",
    externalId: "https://provider.test/message?recipient=private@example.test",
    status: "sent",
    provider: "resend"
  }).toJSON();
  assert.equal(legacy.externalId, null);
  assert.doesNotMatch(JSON.stringify(legacy), /private@example\.test|provider\.test/);
});

test("modern NotificationLog JSON keeps admin UI operational using safe aliases", () => {
  const modern = NotificationLog.hydrate({
    _id: "507f1f77bcf86cd799439012",
    key: "modern-admin-shape",
    type: "email_test",
    recipientHint: "m***@example.test",
    recipientFingerprint: "0123456789abcdef",
    status: "failed",
    provider: "resend",
    providerMessageId: "resend_safe_123",
    errorCode: "email_delivery_rejected",
    createdAt: new Date("2026-10-11T00:00:00Z"),
    updatedAt: new Date("2026-10-11T00:00:00Z")
  }).toJSON();

  assert.equal(modern.recipient, "m***@example.test");
  assert.equal(modern.error, "email_delivery_rejected");
  assert.equal(modern.externalId, "resend_safe_123");
  assert.equal("recipientFingerprint" in modern, false);
});
