import express from "express";
import Trip from "../models/Trip.js";
import Provider from "../models/Provider.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router=express.Router();
router.use(requireAuth,requireRole("admin"));

router.patch("/trips/:tripId/active",async(req,res,next)=>{
  try{
    if(typeof req.body.active!=="boolean")return res.status(400).json({error:"active must be true or false"});
    const trip=await Trip.findById(req.params.tripId);
    if(!trip)return res.status(404).json({error:"Trip not found"});
    const provider=await Provider.findById(trip.providerId).select("businessName status");
    if(!provider)return res.status(409).json({error:"Trip provider not found"});

    trip.active=req.body.active;
    await trip.save();

    res.json({
      id:trip._id,
      active:trip.active,
      provider:{id:provider._id,businessName:provider.businessName,status:provider.status},
      sellable:trip.active===true&&provider.status==="approved"
    });
  }catch(e){next(e);}
});

export default router;
