import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import NativePushInstallationState from "../models/NativePushInstallationState.js";
import { releaseExpiredCheckoutHolds } from "../services/payments.js";

const NATIVE_PUSH_INDEX_NOT_READY="NATIVE_PUSH_LIFECYCLE_INDEX_NOT_READY";

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

async function repairLegacyPaymentIndex() {
  const indexes = await listPaymentIndexes();
  const bookingIndex = indexes.find(i => i.name === "bookingId_1");
  if (bookingIndex && (!bookingIndex.sparse || !bookingIndex.unique)) {
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

function isCriticalNativePushLifecycleIndex(index){
  if(index?.unique!==true||!index?.key||typeof index.key!=="object")return false;
  const entries=Object.entries(index.key);
  return entries.length===2&&
    entries[0][0]==="appId"&&entries[0][1]===1&&
    entries[1][0]==="installationId"&&entries[1][1]===1;
}

export async function verifyNativePushLifecycleIndexes({model=NativePushInstallationState}={}){
  const indexes=await model.collection.indexes();
  const critical=indexes.find(isCriticalNativePushLifecycleIndex);
  if(!critical){
    const error=new Error("Native push lifecycle index verification failed");
    error.code=NATIVE_PUSH_INDEX_NOT_READY;
    throw error;
  }
  return critical;
}

export async function initializeNativePushLifecycleIndexes({model=NativePushInstallationState}={}){
  try{
    await model.init();
    // Explicitly request schema indexes even when background/automatic index
    // behavior is disabled or has already completed for this model instance.
    await model.createIndexes();
    await verifyNativePushLifecycleIndexes({model});
  }catch{
    const error=new Error("Native push lifecycle index initialization failed");
    error.code=NATIVE_PUSH_INDEX_NOT_READY;
    throw error;
  }
}

export async function connectDb(uri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  await repairLegacyPaymentIndex();
  // A hold without a payment may still be in checkout creation. Only expire
  // overdue holds, using the same atomic cleanup as the scheduled worker.
  await releaseExpiredCheckoutHolds({limit:200});
}

export const nativePushIndexReadinessInternals={
  isCriticalNativePushLifecycleIndex,
  NATIVE_PUSH_INDEX_NOT_READY
};
