import express from "express";
import { requireGithubActionsStage2bOidc } from "../middleware/githubActionsStage2bOidc.js";
import { STAGE2B_PLAN_ID, previewPilotFinancialStage2b, applyPilotFinancialStage2b } from "../services/pilotFinancialStage2b.js";
import { restorePilotFinancialStage2bPaymentRevisions } from "../services/pilotFinancialStage2bRevisionRestore.js";

const router=express.Router();

router.use((req,res,next)=>{
  if(process.env.PILOT_FINANCIAL_STAGE2B_ENABLED!=="true")return res.status(404).json({error:"Not found"});
  next();
});

router.post("/",requireGithubActionsStage2bOidc,async(req,res,next)=>{
  try{
    const keys=Object.keys(req.body||{});
    if(keys.some(key=>!["planId","mode"].includes(key)))return res.status(400).json({error:"Unexpected request field"});
    const planId=String(req.body?.planId||"");
    const mode=String(req.body?.mode||"");
    if(planId!==STAGE2B_PLAN_ID)return res.status(409).json({error:"Repair plan mismatch"});
    if(!["preview","apply","restore_payment_revisions"].includes(mode))return res.status(400).json({error:"Invalid repair mode"});
    let result;
    if(mode==="preview")result=await previewPilotFinancialStage2b();
    else if(mode==="apply")result=await applyPilotFinancialStage2b();
    else result=await restorePilotFinancialStage2bPaymentRevisions();
    return res.json(result);
  }catch(error){next(error);}
});

export default router;
