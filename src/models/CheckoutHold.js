import mongoose from "mongoose";

const schema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: "Provider", required: true, index: true },
  tripId: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", required: true },
  departureId: { type: mongoose.Schema.Types.ObjectId, ref: "Departure", required: true, index: true },
  seats: { type: Number, min: 1, required: true },
  adults: { type: Number, min: 0, default: 0 },
  children: { type: Number, min: 0, default: 0 },
  mealPlan: { type: String, enum: ["without_buffet","with_buffet"], default: "without_buffet" },
  pricing: {
    currency: { type: String, default: "JOD" },
    unitPrice: Number,
    adultUnitPrice: Number,
    childUnitPrice: Number,
    adultSubtotal: Number,
    childSubtotal: Number,
    grossAmount: Number,
    commissionAmount: Number,
    providerNetAmount: Number
  },
  status: { type: String, enum: ["active","paid","released","expired"], default: "active", index: true },
  expiresAt: { type: Date, required: true, index: true },
  idempotencyKey: { type: String, required: true }
}, { timestamps: true });

schema.index({ customerId: 1, idempotencyKey: 1 }, { unique: true });

export default mongoose.model("CheckoutHold", schema);
