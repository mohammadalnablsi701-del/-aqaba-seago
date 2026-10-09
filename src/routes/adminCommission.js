import express from "express";
import Trip from "../models/Trip.js";
import Provider from "../models/Provider.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { commissionMatchesApprovedPlan, isFunNSunProviderName, resolveFunNSunCommissionPlan } from "../services/pilotCommissionRules.js";

const router=express.Router();
const TYPES=new Set(["percentage","fixed_per_person","fixed_per_booking"]);
const TIER_KEYS=["adultCommission","childCommission","buffetAdultCommission","buffetChildCommission"];

function fail(message,statusCode=400){throw Object.assign(new Error(message),{statusCode});}
function number(value,label,{max=10000}={}){
  const parsed=Number(value);
  if(!Number.isFinite(parsed)||parsed<0||parsed>max)fail(`${label} is invalid`);
  return parsed;
}

export function buildCommissionUpdate(currentPricing={},body={}){
  const currentType=String(currentPricing.commissionType||"percentage");
  const legacyPercentage=body.percentage!==undefined&&body.commissionType===undefined;
  const nextType=legacyPercentage?"percentage":String(body.commissionType||currentType);
  if(!TYPES.has(nextType))fail("Unsupported commission type");

  if(legacyPercentage&&currentType!=="percentage"){
    fail("This trip uses a fixed commission. Use the fixed commission editor instead of percentage commission.",409);
  }
  if(nextType!==currentType&&body.confirmTypeChange!==true){
    fail("Changing commission type requires explicit confirmation.",409);
  }

  if(nextType==="percentage"){
    const commissionValue=number(legacyPercentage?body.percentage:body.commissionValue,"Commission percentage",{max:100});
    return {commissionType:nextType,commissionValue,...Object.fromEntries(TIER_KEYS.map(key=>[key,undefined]))};
  }

  if(nextType==="fixed_per_booking"){
    const commissionValue=number(body.commissionValue,"Fixed booking commission");
    return {commissionType:nextType,commissionValue,...Object.fromEntries(TIER_KEYS.map(key=>[key,undefined]))};
  }

  const fallbackSource=body.commissionValue??currentPricing.commissionValue;
  const commissionValue=number(fallbackSource,"Fixed per-person fallback commission");
  const update={commissionType:nextType,commissionValue};
  for(const key of TIER_KEYS){
    const source=body[key]!==undefined?body[key]:currentPricing[key];
    update[key]=source===undefined||source===null?undefined:number(source,key);
  }
  return update;
}

router.use(requireAuth,requireRole("admin"));
router.patch("/trips/:tripId/commission",async(req,res,next)=>{
  try{
    const trip=await Trip.findById(req.params.tripId);
    if(!trip)return res.status(404).json({error:"Trip not found"});
    const update=buildCommissionUpdate(trip.pricing||{},req.body||{});
    const provider=await Provider.findById(trip.providerId).select("businessName");
    if(provider&&isFunNSunProviderName(provider.businessName)){
      const approvedPlan=resolveFunNSunCommissionPlan(trip.titleEn);
      if(!approvedPlan)fail("This Fun N Sun trip is not in the approved pilot commission plan.",409);
      if(!commissionMatchesApprovedPlan(update,approvedPlan)){
        fail("Fun N Sun pilot commission is locked to the approved fixed-per-person values.",409);
      }
    }
    for(const [key,value] of Object.entries(update))trip.set(`pricing.${key}`,value);
    await trip.save();
    res.json(trip);
  }catch(error){next(error);}
});

export default router;
