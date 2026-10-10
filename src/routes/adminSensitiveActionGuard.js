import express from "express";
import Provider from "../models/Provider.js";
import {requireAuth,requireRole} from "../middleware/auth.js";
import {attachAdminActionReason} from "../services/adminActionReason.js";

const router=express.Router();
router.use(requireAuth,requireRole("admin"));

router.patch("/providers/:providerId/status",async(req,res,next)=>{
  try{
    const status=String(req.body?.status||"").trim();
    if(["rejected","suspended","pending"].includes(status)){
      const provider=await Provider.findById(req.params.providerId).select("status").lean();
      if(!provider)return res.status(404).json({error:"Provider not found"});
      if(provider.status!==status)attachAdminActionReason(req);
    }
    next();
  }catch(error){next(error);}
});

export default router;
