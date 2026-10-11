import express from "express";
import Trip from "../models/Trip.js";
import Provider from "../models/Provider.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { attachAdminActionReason } from "../services/adminActionReason.js";
import { createAdminAuditEvent, withAdminAuditTransaction } from "../services/adminAudit.js";
import { InvalidCommissionConfiguration, SUPPORTED_COMMISSION_TYPES, validateCommissionConfig } from "../services/commission.js";
import { commissionMatchesApprovedPlan, isFunNSunProviderName, resolveFunNSunCommissionPlan } from "../services/pilotCommissionRules.js";

const router=express.Router();
const TYPES=new Set(SUPPORTED_COMMISSION_TYPES);
const TIER_KEYS=["adultCommission","childCommission","buffetAdultCommission","buffetChildCommission"];
const SNAPSHOT_KEYS=["commissionType","commissionValue",...TIER_KEYS];
const ALLOWED_BODY_KEYS=new Set(["commissionType","commissionValue",...TIER_KEYS,"confirmTypeChange","percentage","reason"]);

function fail(message,statusCode=400){throw Object.assign(new Error(message),{statusCode});}
function assertPayload(body){
  if(!body||typeof body!=="object"||Array.isArray(body))fail("Invalid commission payload");
  for(const key of Object.keys(body))if(!ALLOWED_BODY_KEYS.has(key))fail(`Unexpected commission field: ${key}`);
}
function number(value,label,{max=Number.MAX_SAFE_INTEGER,maxDecimals=2}={}){
  if((typeof value!=="number"&&typeof value!=="string")||(typeof value==="string"&&!value.trim()))fail(`${label} is invalid`);
  const parsed=Number(value);
  if(!Number.isFinite(parsed)||parsed<0||parsed>max)fail(`${label} is invalid`);
  const factor=10**maxDecimals;
  if(Math.abs(parsed*factor-Math.round(parsed*factor))>1e-8)fail(`${label} supports up to ${maxDecimals} decimal places`);
  return parsed;
}
function present(value){return value!==undefined&&value!==null;}

function commissionSnapshot(pricing={}){
  const out={};
  for(const key of SNAPSHOT_KEYS){
    const value=pricing?.[key];
    if(value!==undefined&&value!==null)out[key]=value;
  }
  return out;
}

function sameSnapshot(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function clearedTiers(){return Object.fromEntries(TIER_KEYS.map(key=>[key,undefined]));}

function validateFinalCommissionUpdate(currentPricing,update){
  const finalConfig=commissionSnapshot(currentPricing);
  for(const [key,value] of Object.entries(update)){
    if(value===undefined)delete finalConfig[key];
    else finalConfig[key]=value;
  }
  try{
    validateCommissionConfig(finalConfig);
  }catch(error){
    if(error instanceof InvalidCommissionConfiguration)error.statusCode=400;
    throw error;
  }
  return update;
}

export function buildCommissionUpdate(currentPricing={},body={}){
  assertPayload(body);
  const currentType=currentPricing?.commissionType;
  const legacyPercentage=body.percentage!==undefined&&body.commissionType===undefined;
  const nextType=legacyPercentage
    ? "percentage"
    : (body.commissionType!==undefined?body.commissionType:currentType);
  if(typeof nextType!=="string"||!TYPES.has(nextType))fail("Unsupported commission type");

  if(legacyPercentage&&currentType!=="percentage"){
    fail("This trip uses a fixed commission. Use the fixed commission editor instead of percentage commission.",409);
  }
  if(nextType!==currentType&&body.confirmTypeChange!==true){
    fail("Changing commission type requires explicit confirmation.",409);
  }

  if(nextType==="percentage"){
    const source=legacyPercentage
      ? body.percentage
      : (body.commissionValue!==undefined?body.commissionValue:(nextType===currentType?currentPricing.commissionValue:undefined));
    const commissionValue=number(source,"Commission percentage",{max:100});
    return validateFinalCommissionUpdate(currentPricing,{commissionType:nextType,commissionValue,...clearedTiers()});
  }

  if(nextType==="fixed_per_booking"){
    const source=body.commissionValue!==undefined
      ? body.commissionValue
      : (nextType===currentType?currentPricing.commissionValue:undefined);
    const commissionValue=number(source,"Fixed booking commission");
    return validateFinalCommissionUpdate(currentPricing,{commissionType:nextType,commissionValue,...clearedTiers()});
  }

  const switchingIntoFixed=currentType!=="fixed_per_person";
  const fallbackSource=body.commissionValue!==undefined
    ? body.commissionValue
    : switchingIntoFixed?undefined:currentPricing.commissionValue;
  const commissionValue=number(fallbackSource,"Fixed per-person fallback commission");
  const update={commissionType:nextType,commissionValue};
  for(const key of TIER_KEYS){
    const source=body[key]!==undefined?body[key]:(switchingIntoFixed?undefined:currentPricing[key]);
    update[key]=present(source)?number(source,key):undefined;
  }

  const adultPair=present(update.adultCommission)&&present(update.childCommission);
  const buffetPair=present(update.buffetAdultCommission)&&present(update.buffetChildCommission);
  if(present(update.adultCommission)!==present(update.childCommission))fail("Adult and child commissions must be configured together");
  if(present(update.buffetAdultCommission)!==present(update.buffetChildCommission))fail("Buffet adult and child commissions must be configured together");
  if(buffetPair&&!adultPair)fail("Buffet commission tiers require adult and child commission tiers");
  return validateFinalCommissionUpdate(currentPricing,update);
}

router.use(requireAuth,requireRole("admin"));
router.patch("/trips/:tripId/commission",async(req,res,next)=>{
  try{
    const trip=await withAdminAuditTransaction(async session=>{
      const row=await Trip.findById(req.params.tripId).session(session);
      if(!row)throw Object.assign(new Error("Trip not found"),{statusCode:404});
      const update=buildCommissionUpdate(row.pricing||{},req.body||{});
      attachAdminActionReason(req);
      const provider=await Provider.findById(row.providerId).session(session).select("businessName");
      if(provider&&isFunNSunProviderName(provider.businessName)){
        const approvedPlan=resolveFunNSunCommissionPlan(row.titleEn);
        if(!approvedPlan)fail("This Fun N Sun trip is not in the approved pilot commission plan.",409);
        if(!commissionMatchesApprovedPlan(update,approvedPlan)){
          fail("Fun N Sun pilot commission is locked to the approved fixed-per-person values.",409);
        }
      }

      const before=commissionSnapshot(row.pricing||{});
      for(const [key,value] of Object.entries(update))row.set(`pricing.${key}`,value);
      const after=commissionSnapshot(row.pricing||{});
      if(sameSnapshot(before,after))return row;

      await row.save({session});
      await createAdminAuditEvent({
        req,action:"commission_updated",entityType:"trip",entityId:row._id,
        entityLabel:row.titleEn||row.titleAr||"Trip",before,after,
        reason:req.adminActionReason,metadata:{appliesTo:"future_bookings_only"},session
      });
      return row;
    });
    res.json(trip);
  }catch(error){next(error);}
});

export default router;
