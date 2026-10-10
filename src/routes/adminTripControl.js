import express from "express";
import Trip from "../models/Trip.js";
import Provider from "../models/Provider.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { attachAdminActionReason } from "../services/adminActionReason.js";
import { createAdminAuditEvent, withAdminAuditTransaction } from "../services/adminAudit.js";
import { isTripSellable, PLATFORM_STATUS, tripPlatformStatus } from "../services/tripSales.js";

const router=express.Router();
router.use(requireAuth,requireRole("admin"));

router.patch("/trips/:tripId/platform-status",async(req,res,next)=>{
  try{
    const platformStatus=String(req.body.platformStatus||"").trim();
    if(!Object.values(PLATFORM_STATUS).includes(platformStatus)){
      return res.status(400).json({error:"platformStatus must be allowed or paused"});
    }

    const result=await withAdminAuditTransaction(async session=>{
      const trip=await Trip.findById(req.params.tripId).session(session);
      if(!trip)throw Object.assign(new Error("Trip not found"),{statusCode:404});
      const provider=await Provider.findById(trip.providerId).session(session).select("businessName status");
      if(!provider)throw Object.assign(new Error("Trip provider not found"),{statusCode:409});

      const currentStatus=tripPlatformStatus(trip);
      if(currentStatus===platformStatus){
        return {trip,provider,currentStatus};
      }
      if(platformStatus===PLATFORM_STATUS.PAUSED)attachAdminActionReason(req);

      trip.platformStatus=platformStatus;
      await trip.save({session});
      await createAdminAuditEvent({
        req,
        action:platformStatus===PLATFORM_STATUS.PAUSED?"trip_platform_paused":"trip_platform_allowed",
        entityType:"trip",
        entityId:trip._id,
        entityLabel:trip.titleEn||trip.titleAr||"Trip",
        reason:platformStatus===PLATFORM_STATUS.PAUSED?req.adminActionReason:null,
        before:{platformStatus:currentStatus},
        after:{platformStatus:tripPlatformStatus(trip)},
        session
      });
      return {trip,provider,currentStatus:tripPlatformStatus(trip)};
    });

    res.json({
      id:result.trip._id,
      active:result.trip.active,
      platformStatus:tripPlatformStatus(result.trip),
      provider:{id:result.provider._id,businessName:result.provider.businessName,status:result.provider.status},
      sellable:isTripSellable({trip:result.trip,provider:result.provider})
    });
  }catch(e){next(e);}
});

// Fail closed for stale Admin clients instead of allowing the old endpoint to mutate provider authority.
router.patch("/trips/:tripId/active",(_req,res)=>{
  res.status(410).json({error:"Admin trip sales control moved to platform-status"});
});

export default router;
