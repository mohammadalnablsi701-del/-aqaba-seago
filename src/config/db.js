import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import CheckoutHold from "../models/CheckoutHold.js";
import Departure from "../models/Departure.js";

async function repairLegacyPaymentIndex() {
  const indexes = await Payment.collection.indexes();
  const bookingIndex = indexes.find(i => i.name === "bookingId_1");
  if (bookingIndex && !bookingIndex.sparse) {
    await Payment.collection.dropIndex("bookingId_1");
  }
  const refreshed = await Payment.collection.indexes();
  if (!refreshed.some(i => i.name === "bookingId_1")) {
    await Payment.collection.createIndex(
      { bookingId: 1 },
      { unique: true, sparse: true, name: "bookingId_1" }
    );
  }
}

async function releaseOrphanCheckoutHolds() {
  const active = await CheckoutHold.find({ status: "active" }).limit(200);
  for (const hold of active) {
    const payment = await Payment.findOne({ holdId: hold._id }).select("_id");
    if (payment) continue;
    hold.status = "released";
    await hold.save();
    await Departure.updateOne(
      { _id: hold.departureId },
      { $inc: { reservedSeats: -hold.seats } }
    );
  }
}

export async function connectDb(uri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  await repairLegacyPaymentIndex();
  await releaseOrphanCheckoutHolds();
}
