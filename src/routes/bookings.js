import express from "express";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateAllowedFields, isBoundedString } from "../middleware/validation.js";
import { signTicketToken } from "../services/tickets.js";
import { cancelBooking, cancellationPolicyFor } from "../services/cancellations.js";
import { salePricing, tripForAudience } from "../services/pricingVisibility.js";

const router = express.Router();
const CANCELLATION_FIELDS = new Set(["reason"]);

router.get("/", requireAuth, requireRole("customer"), async (req, res, next) => {
  try {
    const rows = await Booking.find({ customerId: req.user._id, status: { $in: ["confirmed","cancelled","refunded"] } })
      .populate({ path: "tripId", select: "titleAr titleEn vesselName category durationMinutes departureLocation pricing" })
      .populate({ path: "providerId", select: "businessName phone ownerUserId", populate: { path: "ownerUserId", select: "phone phoneNormalized" } })
      .populate({ path: "departureId", select: "startsAt status" })
      .sort({ createdAt: -1 })
      .limit(100);
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    res.json(rows.map(row => {
      const obj = row.toObject();
      const ticketToken = signTicketToken(row);
      return {
        ...obj,
        pricing: salePricing(obj.pricing),
        tripId: obj.tripId ? tripForAudience(obj.tripId) : obj.tripId,
        customer: { name: obj.customerSnapshot?.name || req.user.name || "", phone: obj.customerSnapshot?.phone || req.user.phoneNormalized || req.user.phone || "" },
        ticketToken,
        ticketValidationUrl: `${baseUrl}/api/tickets/validate?token=${encodeURIComponent(ticketToken)}`
      };
    }));
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
