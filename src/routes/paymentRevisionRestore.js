import express from "express";
import { requireGithubActionsPaymentRevisionOidc } from "../middleware/githubActionsPaymentRevisionOidc.js";
import { PAYMENT_REVISION_RESTORE_PLAN_ID, previewPaymentRevisionRestore, applyPaymentRevisionRestore } from "../services/paymentRevisionRestore.js";

const router=express.Router();

router.use((req,res,next)=>{
  if(process.env.PILOT_PAYMENT_REVISION_RESTORE_ENABLED!=="true")return res.status(404).json({error:"Not found"});
  next();
});

router.post("/",requireGithubActionsPaymentRevisionOidc,async(req,res,next)=>{
  try{
    const keys=Object.keys(req.body||{});
    if(keys.some(key=>!["planId","mode"].includes(key)))return res.status(400).json({error:"Unexpected request field"});
    const planId=String(req.body?.planId||"");
    const mode=String(req.body?.mode||"");
    if(planId!==PAYMENT_REVISION_RESTORE_PLAN_ID)return res.status(409).json({error:"Repair plan mismatch"});
    if(!["preview","apply"].includes(mode))return res.status(400).json({error:"Invalid repair mode"});
    const result=mode==="preview"?await previewPaymentRevisionRestore():await applyPaymentRevisionRestore();
    return res.json(result);
  }catch(error){next(error);}
});

export default router;
