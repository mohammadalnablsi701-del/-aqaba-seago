import mongoose from "mongoose";

const refundSchema = new mongoose.Schema({
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", required: true, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", index: true, sparse: true },
  provider: { type: String, required: true, index: true },
  reference: { type: String, required: true, immutable: true, unique: true, index: true },
  idempotencyKey: { type: String, required: true, immutable: true, unique: true, index: true },
  intentType: { type: String, required: true, immutable: true },
  intentId: { type: String, required: true, immutable: true },
  amount: { type: Number, min: 0, required: true, immutable: true },
  currency: { type: String, required: true, immutable: true },
  state: {
    type: String,
    enum: ["requested", "pending", "succeeded", "failed", "needs_review"],
    default: "requested",
    index: true
  },
  providerRefundId: { type: String },
  providerStatus: { type: String },
  reviewReason: { type: String },
  attemptCount: { type: Number, min: 0, default: 0 },
  requestedAt: { type: Date, default: Date.now },
  completedAt: Date,
  lastReconciledAt: Date
}, { timestamps: true });

refundSchema.index({ provider: 1, providerRefundId: 1 }, { unique: true, sparse: true });
refundSchema.index({ paymentId: 1, createdAt: -1 });

export default mongoose.model("Refund", refundSchema);
