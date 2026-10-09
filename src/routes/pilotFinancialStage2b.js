import express from "express";
import { requireGithubActionsStage2bOidc } from "../middleware/githubActionsStage2bOidc.js";
import { STAGE2B_PLAN_ID, previewPilotFinancialStage2b, applyPilotFinancialStage2b } from "../services/pilotFinancialStage2b.js";

const router=express.Router();

router.use((req,res,next)=>{
  if(process.env.PILOT_FINANCIAL_STAGE2B_ENABLED!=="true")return res.status(404).json({error:"Not found"});
  next();
});

router.post("/",requireGithubActionsStage2bOidc,async(req,res,next)=>{
  try{
    const planId=String(req.body?.planId||"");
    const mode=String(req.body?.mode||"");
    if(planId!==STAGE2B_PLAN_ID)return res.status(400).json({error:"Invalid repair plan"});
    if(!["preview","apply"].includes(mode))return res.status(400).json({error:"Invalid repair mode"});
    const result=mode==="preview"?await previewPilotFinancialStage2b():await applyPilotFinancialStage2b();
    return res.json(result);
  }catch(error){next(error);}
});

export default router;
