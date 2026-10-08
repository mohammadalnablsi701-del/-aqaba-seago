import express from "express";
import Trip from "../models/Trip.js";
import {requireAuth,requireRole} from "../middleware/auth.js";

const router=express.Router();
router.use(requireAuth,requireRole("admin"));

const feeFields=["adultCommission","childCommission","buffetAdultCommission","buffetChildCommission"];

router.patch("/trips/:tripId/fees",async(req,res,next)=>{
  try{
    const trip=await Trip.findById(req.params.tripId).populate("providerId","businessName status");
    if(!trip)return res.status(404).json({error:"Trip not found"});

    const values={};
    for(const field of feeFields){
      const value=Number(req.body[field]);
      if(!Number.isFinite(value)||value<0||value>10000){
        return res.status(400).json({error:`${field} must be a non-negative amount`});
      }
      values[field]=value;
    }

    trip.pricing.commissionType="fixed_per_person";
    trip.pricing.commissionValue=values.adultCommission;
    for(const field of feeFields)trip.pricing[field]=values[field];
    await trip.save();

    res.json({
      ok:true,
      tripId:trip._id,
      providerId:trip.providerId?._id||trip.providerId,
      providerName:trip.providerId?.businessName||"",
      currency:trip.pricing.currency||"JOD",
      commissionType:trip.pricing.commissionType,
      adultCommission:trip.pricing.adultCommission,
      childCommission:trip.pricing.childCommission,
      buffetAdultCommission:trip.pricing.buffetAdultCommission,
      buffetChildCommission:trip.pricing.buffetChildCommission
    });
  }catch(e){next(e);}
});

export default router;
