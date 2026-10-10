import express from "express";
import {requireAuth,requireRole} from "../middleware/auth.js";
import {attachAdminActionReason} from "../services/adminActionReason.js";

const router=express.Router();
router.use(requireAuth,requireRole("admin"));

router.patch("/providers/:providerId/status",(req,_res,next)=>{
  try{
    const status=String(req.body?.status||"").trim();
    if(["rejected","suspended","pending"].includes(status))attachAdminActionReason(req);
    next();
  }catch(error){next(error);}
});

export default router;
