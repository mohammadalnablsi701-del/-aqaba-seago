import express from "express";
import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";
import {requireAuth,requireRole} from "../middleware/auth.js";
import {releaseCheckoutHoldsForDeparture} from "../services/payments.js";
import {createAdminAuditEvent,withAdminAuditTransaction} from "../services/adminAudit.js";

const router=express.Router();
router.use(requireAuth,requireRole("admin"));

const ALLOWED={
  pending:new Set(["approved","rejected"]),
  approved:new Set(["suspended"]),
  suspended:new Set(["approved","rejected"]),
  rejected:new Set(["pending"])
};

function actionFor(previousStatus,nextStatus){
  if(nextStatus==="approved")return previousStatus==="suspended"?"provider_reactivated":"provider_approved";
  if(nextStatus==="rejected")return "provider_rejected";
  if(nextStatus==="suspended")return "provider_suspended";
  if(nextStatus==="pending")return "provider_returned_to_pending";
  throw Object.assign(new Error("Unsupported provider audit transition"),{statusCode:500});
}

async function releaseProviderCheckoutHolds(providerId,session){
  const trips=await Trip.find({providerId}).session(session).select("_id");
  const tripIds=trips.map(t=>t._id);
  if(!tripIds.length)return;
  const departures=await Departure.find({tripId:{$in:tripIds},status:"scheduled"}).session(session).select("_id");
  for(const departure of departures){
    await releaseCheckoutHoldsForDeparture(departure._id,{session});
  }
}

router.patch("/providers/:providerId/approve",async(req,res,next)=>{
  try{
    const provider=await withAdminAuditTransaction(async session=>{
      const p=await Provider.findById(req.params.providerId).session(session).populate("ownerUserId","isActive role");
      if(!p)throw Object.assign(new Error("Provider not found"),{statusCode:404});
      if(!p.ownerUserId||p.ownerUserId.role!=="provider"||!p.ownerUserId.isActive)throw Object.assign(new Error("Provider owner account is not active"),{statusCode:409});
      if(p.status==="approved")return p;
      if(p.status!=="pending")throw Object.assign(new Error("Only pending provider applications can be approved"),{statusCode:409});

      const before={status:p.status};
      p.status="approved";
      p.approvedAt=new Date();
      p.approvedBy=req.user._id;
      await p.save({session});
      await createAdminAuditEvent({
        req,action:"provider_approved",entityType:"provider",entityId:p._id,
        entityLabel:p.businessName,before,after:{status:p.status},reason:null,session
      });
      return p;
    });
    res.json(provider);
  }catch(error){next(error);}
});

router.patch("/providers/:providerId/status",async(req,res,next)=>{
  try{
    const nextStatus=String(req.body.status||"").trim();
    if(!["pending","approved","rejected","suspended"].includes(nextStatus))return res.status(400).json({error:"Invalid provider status"});

    const provider=await withAdminAuditTransaction(async session=>{
      const p=await Provider.findById(req.params.providerId).session(session).populate("ownerUserId","isActive role");
      if(!p)throw Object.assign(new Error("Provider not found"),{statusCode:404});
      if(!p.ownerUserId||p.ownerUserId.role!=="provider")throw Object.assign(new Error("Provider owner account is invalid"),{statusCode:409});
      if(nextStatus==="approved"&&!p.ownerUserId.isActive)throw Object.assign(new Error("Provider owner account is not active"),{statusCode:409});
      if(p.status===nextStatus)return p;
      if(!ALLOWED[p.status]?.has(nextStatus))throw Object.assign(new Error(`Cannot change provider status from ${p.status} to ${nextStatus}`),{statusCode:409});

      const previousStatus=p.status;
      p.status=nextStatus;
      if(nextStatus==="approved"){
        p.approvedAt=new Date();
        p.approvedBy=req.user._id;
      }else{
        p.approvedAt=undefined;
        p.approvedBy=undefined;
      }
      await p.save({session});

      if(["suspended","rejected"].includes(nextStatus)){
        await releaseProviderCheckoutHolds(p._id,session);
      }

      await createAdminAuditEvent({
        req,action:actionFor(previousStatus,nextStatus),entityType:"provider",entityId:p._id,
        entityLabel:p.businessName,before:{status:previousStatus},after:{status:nextStatus},session
      });
      return p;
    });
    res.json(provider);
  }catch(error){next(error);}
});

export default router;
