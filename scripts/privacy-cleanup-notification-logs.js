import "dotenv/config";
import mongoose from "mongoose";
import {
  assertApplySafety,
  assertCleanupTargetKnown,
  runLegacyNotificationLogCleanup
} from "../src/services/notificationLogPrivacyCleanup.js";

function parseMode(argv) {
  const allowed = new Set(["--dry-run", "--apply"]);
  const unknown = argv.filter(arg => !allowed.has(arg));
  if (unknown.length) throw new Error("Unknown cleanup argument");

  const dryRun = argv.includes("--dry-run");
  const apply = argv.includes("--apply");
  if (dryRun === apply) throw new Error("Choose exactly one cleanup mode");
  return apply ? "apply" : "dry-run";
}

function printSummary({ databaseName, environment, mode, summary }) {
  const output = {
    database: databaseName,
    environment,
    mode,
    totalScanned: summary.totalScanned,
    totalMatched: summary.totalMatched,
    recipientPlaintextCount: summary.recipientPlaintextCount,
    rawErrorCount: summary.rawErrorCount,
    unsafeTokenCredentialCount: summary.unsafeTokenCredentialCount,
    safeExternalIdCount: summary.safeExternalIdCount,
    unsafeExternalIdCount: summary.unsafeExternalIdCount,
    recordsWouldChange: summary.recordsWouldChange,
    recordsSkipped: summary.recordsSkipped,
    classificationCounts: summary.classificationCounts
  };
  console.log(JSON.stringify(output, null, 2));
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const uri = String(process.env.MONGODB_URI || "").trim();
  if (!uri) throw new Error("Missing database configuration");

  await mongoose.connect(uri, {
    autoIndex: false,
    serverSelectionTimeoutMS: 10000
  });

  try {
    const databaseName = mongoose.connection.name;
    const environment = assertCleanupTargetKnown(databaseName);

    if (mode === "apply") {
      assertApplySafety({
        environment,
        confirmation: process.env.CONFIRM_NOTIFICATION_LOG_PRIVACY_CLEANUP,
        declaredTarget: process.env.NOTIFICATION_LOG_CLEANUP_TARGET
      });
    }

    const collection = mongoose.connection.collection("notificationlogs");
    const summary = await runLegacyNotificationLogCleanup(collection, { apply: mode === "apply" });
    printSummary({ databaseName, environment, mode, summary });
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(() => {
  console.error(JSON.stringify({
    event: "notification_log_privacy_cleanup",
    result: "aborted",
    code: "cleanup_aborted"
  }));
  process.exitCode = 1;
});
