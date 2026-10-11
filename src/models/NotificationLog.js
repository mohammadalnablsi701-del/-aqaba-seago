import mongoose from "mongoose";

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", index: true },
  type: { type: String, required: true, index: true },
  recipientHint: String,
  recipientFingerprint: { type: String, index: true },
  status: { type: String, enum: ["sent","failed","skipped"], required: true },
  provider: { type: String, default: "resend" },
  providerMessageId: String,
  errorCode: String,
  sentAt: Date
}, { timestamps: true });

schema.set("toJSON", {
  transform(_doc, ret) {
    const recipientHint = ret.recipientHint || null;
    const errorCode = ret.errorCode || null;
    const providerMessageId = ret.providerMessageId || null;

    // The admin UI historically consumed recipient/error/externalId. Keep those
    // response aliases operational without ever exposing legacy plaintext/raw data.
    delete ret.recipient;
    delete ret.error;
    delete ret.externalId;
    delete ret.recipientFingerprint;
    ret.recipient = recipientHint;
    ret.error = errorCode;
    ret.externalId = providerMessageId;
    return ret;
  }
});

export default mongoose.model("NotificationLog", schema);
