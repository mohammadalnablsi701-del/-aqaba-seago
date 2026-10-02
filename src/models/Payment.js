import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema({
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", index: true, sparse: true },
  holdId: { type: mongoose.Schema.Types.ObjectId, ref: "CheckoutHold", required: true, unique: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  provider: { type: String, required: true, default: "mock", index: true },
  externalPaymentId: { type: String, index: true },
  status: {
    type: String,
    enum: ["created", "pending", "paid", "failed", "cancelled", "expired", "needs_review", "refunded"],
    default: "created",
    index: true
  },
  amount: { type: Number, min: 0, required: true },
  currency: { type: String, default: "JOD" },
  checkoutUrl: String,
  paidAt: Date,
  failedAt: Date,
  lastEventId: String,
  rawLastEvent: mongoose.Schema.Types.Mixed
}, { timestamps: true });

paymentSchema.index({ provider: 1, externalPaymentId: 1 }, { unique: true, sparse: true });

export default mongoose.model("Payment", paymentSchema);
