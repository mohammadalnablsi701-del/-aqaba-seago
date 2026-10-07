import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import { releaseExpiredCheckoutHolds } from "../services/payments.js";

async function listPaymentIndexes() {
  try {
    return await Payment.collection.indexes();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === "NamespaceNotFound") {
      return [];
    }
    throw error;
  }
}

async function applyOptionalMongoIndexDiskThreshold() {
  const raw = process.env.MONGO_INDEX_MIN_DISK_MB;
  if (!raw) return;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 8 * 1024 * 1024) {
    throw new Error("MONGO_INDEX_MIN_DISK_MB must be a number between 0 and 8388608");
  }

  await mongoose.connection.db.admin().command({
    setParameter: 1,
    indexBuildMinAvailableDiskSpaceMB: value,
  });
}

async function repairLegacyPaymentIndex() {
  const indexes = await listPaymentIndexes();
  const bookingIndex = indexes.find(i => i.name === "bookingId_1");
  if (bookingIndex && !bookingIndex.sparse) {
    await Payment.collection.dropIndex("bookingId_1");
  }
  const refreshed = await listPaymentIndexes();
  if (!refreshed.some(i => i.name === "bookingId_1")) {
    await Payment.collection.createIndex(
      { bookingId: 1 },
      { unique: true, sparse: true, name: "bookingId_1" }
    );
  }
}

export async function connectDb(uri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  await applyOptionalMongoIndexDiskThreshold();
  await repairLegacyPaymentIndex();
  // A hold without a payment may still be in checkout creation. Only expire
  // overdue holds, using the same atomic cleanup as the scheduled worker.
  await releaseExpiredCheckoutHolds({limit:200});
}
