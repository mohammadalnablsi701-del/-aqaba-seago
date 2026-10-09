import express from "express";
import { requireGithubActionsRepairOidc } from "../middleware/githubActionsOidc.js";
import { STAGE2A_PLAN_ID, previewPilotRepairStage2a, applyPilotRepairStage2a } from "../services/pilotRepairStage2a.js";

const router=express.Router();

router.use((req,res,next)=>{
  if(process.env.PILOT_REPAIR_STAGE2A_ENABLED!=="true")return res.status(404).json({error:"Not found"});
  next();
});

router.post("/",requireGithubActionsRepairOidc,async(req,res,next)=>{
  try{
    const keys=Object.keys(req.body||{});
    if(keys.some(key=>!["planId","mode"].includes(key)))return res.status(400).json({error:"Unexpected request field"});
    if(req.body?.planId!==STAGE2A_PLAN_ID)return res.status(409).json({error:"Repair plan mismatch"});
    const mode=String(req.body?.mode||"");
    if(mode==="preview")return res.json(await previewPilotRepairStage2a());
    if(mode==="apply")return res.json(await applyPilotRepairStage2a());
    return res.status(400).json({error:"Invalid repair mode"});
  }catch(error){next(error);}
});

export default router;
