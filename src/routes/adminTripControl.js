import express from "express";
import Trip from "../models/Trip.js";
import Provider from "../models/Provider.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { isTripSellable, PLATFORM_STATUS, tripPlatformStatus } from "../services/tripSales.js";

const router=express.Router();
router.use(requireAuth,requireRole("admin"));

router.patch("/trips/:tripId/platform-status",async(req,res,next)=>{
  try{
    const platformStatus=String(req.body.platformStatus||"").trim();
    if(!Object.values(PLATFORM_STATUS).includes(platformStatus)){
      return res.status(400).json({error:"platformStatus must be allowed or paused"});
    }
    const trip=await Trip.findById(req.params.tripId);
    if(!trip)return res.status(404).json({error:"Trip not found"});
    const provider=await Provider.findById(trip.providerId).select("businessName status");
    if(!provider)return res.status(409).json({error:"Trip provider not found"});

    trip.platformStatus=platformStatus;
    await trip.save();

    res.json({
      id:trip._id,
      active:trip.active,
      platformStatus:tripPlatformStatus(trip),
      provider:{id:provider._id,businessName:provider.businessName,status:provider.status},
      sellable:isTripSellable({trip,provider})
    });
  }catch(e){next(e);}
});

// Fail closed for stale Admin clients instead of allowing the old endpoint to mutate provider authority.
router.patch("/trips/:tripId/active",(_req,res)=>{
  res.status(410).json({error:"Admin trip sales control moved to platform-status"});
});

export default router;
