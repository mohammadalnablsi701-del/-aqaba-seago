import express from "express";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateAllowedFields, isBoundedString } from "../middleware/validation.js";
import { signTicketToken } from "../services/tickets.js";
import { deriveTicketLifecycle } from "../services/ticketLifecycle.js";
import { cancelBooking, cancellationPolicyFor } from "../services/cancellations.js";
import { salePricing, tripForAudience } from "../services/pricingVisibility.js";

const router = express.Router();
const CANCELLATION_FIELDS = new Set(["reason"]);

function toCustomerDeparture(departure) {
  if (!departure) return null;
  const source = departure?.toObject ? departure.toObject() : departure;
  return {
    _id: source._id,
    startsAt: source.startsAt,
    status: source.status
  };
}

function toCustomerProvider(provider) {
  if (!provider) return null;
  const source = provider?.toObject ? provider.toObject() : provider;
  const owner = source.ownerUserId?.toObject ? source.ownerUserId.toObject() : source.ownerUserId;
  return {
    _id: source._id,
    businessName: source.businessName,
    phone: source.phone || null,
    ownerUserId: owner ? {
      phone: owner.phone || null,
      phoneNormalized: owner.phoneNormalized || null
    } : null
  };
}

function toCustomerCancellation(cancellation) {
  if (!cancellation) return null;
  const source = cancellation?.toObject ? cancellation.toObject() : cancellation;
  if (!source.cancelledAt && source.refundStatus === undefined) return null;
  return {
    cancelledAt: source.cancelledAt || null,
    refundPercentage: Number(source.refundPercentage || 0),
    refundAmount: Number(source.refundAmount || 0),
    refundStatus: source.refundStatus || "none"
  };
}

function toCustomerBookingDto(row, reqUser, baseUrl) {
  const source = row.toObject();
  const departureId = toCustomerDeparture(source.departureId);
  const lifecycle = deriveTicketLifecycle({
    status: source.status,
    checkedInAt: source.checkedInAt,
    departureId
  });
  const ticketToken = signTicketToken(row);

  return {
    _id: source._id,
    status: source.status,
    seats: source.seats,
    adults: source.adults,
    children: source.children,
    mealPlan: source.mealPlan,
    pricing: salePricing(source.pricing),
    tripId: source.tripId ? tripForAudience(source.tripId) : null,
    providerId: toCustomerProvider(source.providerId),
    departureId,
    checkedInAt: source.checkedInAt || null,
    cancellation: toCustomerCancellation(source.cancellation),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    customer: {
      name: source.customerSnapshot?.name || reqUser.name || "",
      phone: source.customerSnapshot?.phone || reqUser.phoneNormalized || reqUser.phone || ""
    },
    ticketLifecycle: lifecycle,
    ticketToken,
    ticketValidationUrl: `${baseUrl}/api/tickets/validate?token=${encodeURIComponent(ticketToken)}`
  };
}

router.get("/", requireAuth, requireRole("customer"), async (req, res, next) => {
  try {
    const rows = await Booking.find({ customerId: req.user._id, status: { $in: ["confirmed","cancelled","refunded"] } })
      .select("customerSnapshot providerId tripId departureId seats adults children mealPlan status pricing checkedInAt cancellation createdAt updatedAt")
      .populate({ path: "tripId", select: "titleAr titleEn vesselName category durationMinutes departureLocation pricing" })
      .populate({ path: "providerId", select: "businessName phone ownerUserId", populate: { path: "ownerUserId", select: "phone phoneNormalized" } })
      .populate({ path: "departureId", select: "startsAt status" })
      .sort({ createdAt: -1 })
      .limit(100);
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    res.json(rows.map(row => toCustomerBookingDto(row, req.user, baseUrl)));
  } catch (err) {
    next(err);
  }
});

router.get("/:bookingId/cancellation-policy", requireAuth, requireRole("customer"), async (req,res,next)=>{
  try{
    if(!mongoose.isValidObjectId(req.params.bookingId))return res.status(400).json({error:"Invalid bookingId"});
    const booking=await Booking.findOne({_id:req.params.bookingId,customerId:req.user._id,status:"confirmed"}).populate("departureId","startsAt");
    if(!booking)return res.status(404).json({error:"Confirmed booking not found"});
    const policy=cancellationPolicyFor(booking.departureId?.startsAt||new Date());
    const gross=Number(booking.pricing?.grossAmount||0);
    res.json({
      refundPercentage:policy.refundPercentage,
      refundAmount:Number((gross*policy.refundPercentage/100).toFixed(2)),
      hoursBeforeDeparture:Number(policy.hoursBeforeDeparture.toFixed(2)),
      currency:booking.pricing?.currency||"JOD",
      rules:[
        {label:"24+ hours before departure",refundPercentage:100},
        {label:"12–24 hours before departure",refundPercentage:50},
        {label:"Less than 12 hours",refundPercentage:0}
      ]
    });
  }catch(e){next(e);}
});

router.post("/:bookingId/cancel", requireAuth, requireRole("customer"), async (req,res,next)=>{
  try{
    if(!mongoose.isValidObjectId(req.params.bookingId))return res.status(400).json({error:"Invalid bookingId"});
    const fieldError=validateAllowedFields(req.body,CANCELLATION_FIELDS);
    if(fieldError)return res.status(400).json({error:fieldError});
    if(req.body.reason!==undefined&&!isBoundedString(req.body.reason,{min:1,max:500})){
      return res.status(400).json({error:"Cancellation reason must be a string between 1 and 500 characters"});
    }
    const reason=req.body.reason?.trim()||"Customer cancellation";
    const result=await cancelBooking({
      bookingId:req.params.bookingId,
      customerId:req.user._id,
      source:"customer",
      reason
    });
    res.json({
      ok:true,
      bookingId:result.booking._id,
      status:result.booking.status,
      refundPercentage:result.policy.refundPercentage,
      refundAmount:result.refund.amount,
      refundStatus:result.refund.status,
      currency:result.booking.pricing?.currency||"JOD"
    });
  }catch(e){next(e);}
});

router.post("/", requireAuth, requireRole("customer"), async (_req, res) => {
  res.status(410).json({ error: "Bookings are created only after successful payment" });
});

export default router;
