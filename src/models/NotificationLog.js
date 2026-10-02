import mongoose from "mongoose";

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", index: true },
  type: { type: String, required: true, index: true },
  recipient: { type: String, required: true },
  status: { type: String, enum: ["sent","failed","skipped"], required: true },
  provider: { type: String, default: "resend" },
  externalId: String,
  error: String,
  sentAt: Date
}, { timestamps: true });

export default mongoose.model("NotificationLog", schema);
