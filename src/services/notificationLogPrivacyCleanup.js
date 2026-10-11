const SAFE_PROVIDER_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

export const EXTRA_UNSAFE_LEGACY_FIELDS = Object.freeze([
  "email",
  "phone",
  "endpoint",
  "token",
  "deviceToken",
  "p256dh",
  "auth",
  "authorization",
  "rawError",
  "providerResponse",
  "payload",
  "metadata",
  "body",
  "headers",
  "subscription",
  "keys",
  "ticketToken",
  "authToken",
  "bearerToken",
  "secret"
]);

export const LEGACY_NOTIFICATION_LOG_FILTER = Object.freeze({
  $or: [
    { recipient: { $exists: true } },
    { error: { $exists: true } },
    { externalId: { $exists: true } },
    ...EXTRA_UNSAFE_LEGACY_FIELDS.map(field => ({ [field]: { $exists: true } }))
  ]
});

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isSafeProviderExternalId(value) {
  return nonEmptyString(value) && SAFE_PROVIDER_ID_RE.test(value.trim());
}

export function classifyLegacyNotificationLog(doc = {}) {
  const hasRecipient = hasOwn(doc, "recipient");
  const hasRawError = nonEmptyString(doc.error);
  const hasExternalId = nonEmptyString(doc.externalId);
  const extraUnsafeCredential = EXTRA_UNSAFE_LEGACY_FIELDS.some(field => hasOwn(doc, field));
  const safeExternalId = hasExternalId && isSafeProviderExternalId(doc.externalId);

  return {
    recipientPlaintext: hasRecipient,
    recipientOnly: hasRecipient && !hasRawError && !hasExternalId,
    rawLegacyError: hasRawError,
    legacyExternalId: hasExternalId,
    recipientAndRawError: hasRecipient && hasRawError,
    recipientAndExternalId: hasRecipient && hasExternalId,
    extraUnsafeCredential,
    safeExternalId,
    unsafeExternalId: hasExternalId && !safeExternalId
  };
}

function hasLegacyErrorMaterial(doc) {
  return nonEmptyString(doc.error) || hasOwn(doc, "rawError") || hasOwn(doc, "providerResponse");
}

export function buildLegacyNotificationLogCleanup(doc = {}) {
  const set = {};
  const unset = {};

  if (hasOwn(doc, "recipient")) unset.recipient = "";
  if (hasOwn(doc, "error")) unset.error = "";

  for (const field of EXTRA_UNSAFE_LEGACY_FIELDS) {
    if (hasOwn(doc, field)) unset[field] = "";
  }

  if (hasOwn(doc, "externalId")) {
    if (isSafeProviderExternalId(doc.externalId)) {
      const legacyId = doc.externalId.trim();
      if (nonEmptyString(doc.providerMessageId) && doc.providerMessageId.trim() !== legacyId) {
        return { blocked: true, reason: "provider_message_id_conflict", update: null };
      }
      if (!nonEmptyString(doc.providerMessageId)) set.providerMessageId = legacyId;
    }
    unset.externalId = "";
  }

  if (hasLegacyErrorMaterial(doc) && !nonEmptyString(doc.errorCode)) {
    set.errorCode = "legacy_error_redacted";
  }

  const update = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;

  return {
    blocked: false,
    reason: null,
    update: Object.keys(update).length ? update : null
  };
}

export function classifyDatabaseName(databaseName) {
  const name = String(databaseName || "").trim();
  if (name === "aqaba-seago") return "production";
  if (name === "aqaba-seago-staging") return "staging";
  if (/^aqaba-seago-(?:task10a|test)(?:-|$)/.test(name)) return "test";
  return "ambiguous";
}

export function assertCleanupTargetKnown(databaseName) {
  const environment = classifyDatabaseName(databaseName);
  if (environment === "ambiguous") {
    throw new Error("NotificationLog privacy cleanup target database is ambiguous; aborting");
  }
  return environment;
}

export function assertApplySafety({ environment, confirmation, declaredTarget }) {
  if (confirmation !== "YES") {
    throw new Error("--apply requires CONFIRM_NOTIFICATION_LOG_PRIVACY_CLEANUP=YES");
  }
  if (!declaredTarget || declaredTarget !== environment) {
    throw new Error("--apply requires NOTIFICATION_LOG_CLEANUP_TARGET to exactly match the detected environment");
  }
}

function emptySummary() {
  return {
    totalScanned: 0,
    totalMatched: 0,
    recipientPlaintextCount: 0,
    rawErrorCount: 0,
    unsafeTokenCredentialCount: 0,
    safeExternalIdCount: 0,
    unsafeExternalIdCount: 0,
    recordsWouldChange: 0,
    recordsSkipped: 0,
    classificationCounts: {
      recipientOnly: 0,
      rawLegacyError: 0,
      legacyExternalId: 0,
      recipientAndRawError: 0,
      recipientAndExternalId: 0,
      extraUnsafeCredential: 0
    }
  };
}

export async function inspectLegacyNotificationLogs(collection) {
  const summary = emptySummary();
  summary.totalScanned = await collection.countDocuments({});

  const docs = await collection.find(LEGACY_NOTIFICATION_LOG_FILTER).toArray();
  summary.totalMatched = docs.length;

  const planned = [];
  for (const doc of docs) {
    const classification = classifyLegacyNotificationLog(doc);
    if (classification.recipientPlaintext) summary.recipientPlaintextCount++;
    if (classification.rawLegacyError) summary.rawErrorCount++;
    if (classification.extraUnsafeCredential) summary.unsafeTokenCredentialCount++;
    if (classification.safeExternalId) summary.safeExternalIdCount++;
    if (classification.unsafeExternalId) summary.unsafeExternalIdCount++;

    for (const key of Object.keys(summary.classificationCounts)) {
      if (classification[key]) summary.classificationCounts[key]++;
    }

    const plan = buildLegacyNotificationLogCleanup(doc);
    if (!plan.blocked && plan.update) {
      planned.push({ _id: doc._id, update: plan.update });
    }
  }

  summary.recordsWouldChange = planned.length;
  summary.recordsSkipped = summary.totalScanned - planned.length;
  return { summary, planned };
}

export async function runLegacyNotificationLogCleanup(collection, { apply = false, batchSize = 50 } = {}) {
  const { summary, planned } = await inspectLegacyNotificationLogs(collection);
  if (!apply || planned.length === 0) return summary;

  const boundedBatchSize = Math.max(1, Math.min(Number(batchSize) || 50, 100));
  for (let index = 0; index < planned.length; index += boundedBatchSize) {
    const chunk = planned.slice(index, index + boundedBatchSize);
    await collection.bulkWrite(
      chunk.map(item => ({
        updateOne: {
          filter: { $and: [{ _id: item._id }, LEGACY_NOTIFICATION_LOG_FILTER] },
          update: item.update
        }
      })),
      { ordered: true }
    );
  }

  return summary;
}
