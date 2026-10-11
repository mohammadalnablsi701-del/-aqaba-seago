import express from "express";
import mongoose from "mongoose";
import Provider from "../models/Provider.js";
import ProviderSettlement from "../models/ProviderSettlement.js";
import SettlementCorrection from "../models/SettlementCorrection.js";
import {requireAuth,requireRole} from "../middleware/auth.js";
import {normalizeAdminActionReason} from "../services/adminActionReason.js";
import {createAdminAuditEvent,withAdminAuditTransaction} from "../services/adminAudit.js";
import {recordSettlement,settlementLedger} from "../services/settlements.js";

const router=express.Router();
router.use(requireAuth,requireRole("admin"));

function overviewDate(value,end=false){
  const s=String(value||"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
  const d=new Date(s+(end?"T23:59:59.999+03:00":"T00:00:00.000+03:00"));
  return Number.isNaN(d.getTime())?null:d;
}

function validateExactBody(body,allowed){
  if(!body||typeof body!=="object"||Array.isArray(body))
    throw Object.assign(new Error("Request body must be a JSON object"),{statusCode:400});
  const unexpected=Object.keys(body).filter(key=>!allowed.has(key));
  if(unexpected.length)
    throw Object.assign(new Error(`Unexpected field: ${unexpected[0]}`),{statusCode:400});
}

function isSafeFinancialConflict(error){
  return error?.code===11000||
    error?.code===112||
    error?.codeName==="WriteConflict"||
    error?.errorLabels?.includes?.("TransientTransactionError")||
    error?.errorLabels?.includes?.("UnknownTransactionCommitResult");
}

router.get("/settlements",async(req,res,next)=>{
  try{
    const from=overviewDate(req.query.from,false),to=overviewDate(req.query.to,true);
    if(req.query.from&&!from)return res.status(400).json({error:"Invalid from date"});
    if(req.query.to&&!to)return res.status(400).json({error:"Invalid to date"});
    if(from&&to&&from>to)return res.status(400).json({error:"From date must be before to date"});
    const providerId=String(req.query.providerId||"").trim();
    if(providerId&&!mongoose.isValidObjectId(providerId))return res.status(400).json({error:"Invalid provider"});

    const data=await settlementLedger({from,to,providerId});
    const history=await ProviderSettlement.find(providerId?{providerId}:{})
      .populate("providerId","businessName")
      .populate("paidBy","name email")
      .sort({paidAt:-1})
      .limit(100)
      .lean();
    const historyIds=history.map(row=>row._id);
    const corrections=historyIds.length
      ?await SettlementCorrection.find({settlementId:{$in:historyIds}})
        .populate("actorUserId","name email")
        .sort({reversedAt:1})
        .lean()
      :[];
    const correctionsBySettlement=new Map();
    for(const correction of corrections){
      const key=String(correction.settlementId);
      if(!correctionsBySettlement.has(key))correctionsBySettlement.set(key,[]);
      correctionsBySettlement.get(key).push(correction);
    }

    res.json({
      generatedAt:new Date(),currency:"JOD",
      filters:{from:req.query.from||null,to:req.query.to||null,providerId:providerId||null},
      providers:data.providersList.map(p=>({id:p._id,businessName:p.businessName,status:p.status})),
      totals:data.totals,reconciliationRequired:data.reconciliationRequired,
      breakdown:data.breakdown.map(({unsettledPaymentIds,unsettledBookingIds,items,...row})=>row),
      history:history.map(settlement=>{
        const settlementCorrections=correctionsBySettlement.get(String(settlement._id))||[];
        const reversed=settlementCorrections.some(c=>c.type==="payment_reversal");
        return{
          id:settlement._id,
          providerId:settlement.providerId?._id||settlement.providerId,
          providerName:settlement.providerId?.businessName||"Provider",
          periodFrom:settlement.periodFrom,periodTo:settlement.periodTo,currency:settlement.currency,
          grossSales:settlement.grossSales,refunds:settlement.refunds,seaGoCommission:settlement.seaGoCommission,
          providerNet:settlement.providerNet,amountPaid:settlement.amountPaid,
          effectiveAmountPaid:reversed?0:settlement.amountPaid,
          status:settlement.status,
          paymentTruth:reversed?"reversed":"paid",
          paidAt:settlement.paidAt,
          paidBy:settlement.paidBy?{id:settlement.paidBy._id,name:settlement.paidBy.name,email:settlement.paidBy.email}:null,
          reason:settlement.reason||settlement.note||"",
          corrections:settlementCorrections.map(c=>({
            id:c._id,type:c.type,originalAmount:c.originalAmount,amountDelta:c.amountDelta,currency:c.currency,
            reason:c.reason,reversedAt:c.reversedAt,
            actor:c.actorUserId?{id:c.actorUserId._id,name:c.actorUserId.name,email:c.actorUserId.email}:null
          }))
        };
      })
    });
  }catch(error){next(error);}
});

router.post("/settlements/pay",async(req,res,next)=>{
  try{
    validateExactBody(req.body,new Set(["providerId","from","to","reason"]));
    const from=overviewDate(req.body.from,false),to=overviewDate(req.body.to,true);
    const providerId=String(req.body.providerId||"").trim();
    if(!from||!to)return res.status(400).json({error:"From and to dates are required"});
    if(from>to)return res.status(400).json({error:"From date must be before to date"});
    if(!mongoose.isValidObjectId(providerId))return res.status(400).json({error:"Invalid provider"});
    const reason=normalizeAdminActionReason(req.body.reason);

    const result=await withAdminAuditTransaction(async session=>{
      const provider=await Provider.findById(providerId).select("_id businessName").session(session);
      if(!provider)throw Object.assign(new Error("Provider not found"),{statusCode:404});

      const beforeLedger=await settlementLedger({from,to,providerId,session});
      const beforeRow=beforeLedger.breakdown.find(row=>String(row.providerId)===String(providerId));
      const settlement=await recordSettlement({from,to,providerId,paidBy:req.user._id,reason,session});
      const amountPaid=Number(settlement.amountPaid||0);
      const currency=settlement.currency||"JOD";

      const audit=await createAdminAuditEvent({
        req,action:"settlement_marked_paid",entityType:"settlement",entityId:settlement._id,
        entityLabel:`${provider.businessName} · ${from.toISOString()} → ${to.toISOString()}`,
        reason,
        before:{
          status:"outstanding",
          effectivePaid:Number(beforeRow?.paid||0),
          outstanding:Number(beforeRow?.outstanding||0),
          payableNow:Number(beforeRow?.payableNow||0)
        },
        after:{status:"paid",effectiveAmountPaid:amountPaid,amountPaid,currency,paidAt:settlement.paidAt,paidBy:req.user._id},
        metadata:{providerId:provider._id,providerName:provider.businessName,amount:amountPaid,currency,periodFrom:from,periodTo:to},
        session
      });
      return{settlement,provider,audit};
    });

    res.status(201).json({
      ok:true,id:result.settlement._id,
      providerId:result.provider._id,providerName:result.provider.businessName,
      amountPaid:result.settlement.amountPaid,currency:result.settlement.currency,
      status:"paid",paymentTruth:"paid",effectiveAmountPaid:result.settlement.amountPaid,
      paidAt:result.settlement.paidAt,paidBy:req.user._id,reason,
      auditId:result.audit._id
    });
  }catch(error){
    if(isSafeFinancialConflict(error))return res.status(409).json({error:"Settlement payment was already recorded or changed concurrently. Refresh and try again."});
    next(error);
  }
});

router.post("/settlements/:settlementId/reverse",async(req,res,next)=>{
  try{
    validateExactBody(req.body,new Set(["reason"]));
    const settlementId=String(req.params.settlementId||"").trim();
    if(!mongoose.isValidObjectId(settlementId))return res.status(400).json({error:"Invalid settlement"});
    const reason=normalizeAdminActionReason(req.body.reason);

    const result=await withAdminAuditTransaction(async session=>{
      const settlement=await ProviderSettlement.findById(settlementId).session(session);
      if(!settlement)throw Object.assign(new Error("Settlement not found"),{statusCode:404});
      const existing=await SettlementCorrection.findOne({settlementId:settlement._id}).session(session).lean();
      if(existing)throw Object.assign(new Error("Settlement payment has already been reversed"),{statusCode:409});
      const provider=await Provider.findById(settlement.providerId).select("_id businessName").session(session);
      const amount=Number(settlement.amountPaid||0);
      const currency=settlement.currency||"JOD";
      const [correction]=await SettlementCorrection.create([{
        settlementId:settlement._id,providerId:settlement.providerId,type:"payment_reversal",
        originalAmount:amount,amountDelta:-amount,currency,reason,actorUserId:req.user._id,reversedAt:new Date()
      }],{session});

      const audit=await createAdminAuditEvent({
        req,action:"settlement_payment_reversed",entityType:"settlement",entityId:settlement._id,
        entityLabel:`${provider?.businessName||"Provider"} · settlement ${settlement._id}`,
        reason,
        before:{historicalStatus:"paid",paymentTruth:"paid",effectiveAmountPaid:amount},
        after:{historicalStatus:"paid",paymentTruth:"reversed",effectiveAmountPaid:0,correctionId:correction._id,amountDelta:-amount},
        metadata:{providerId:settlement.providerId,providerName:provider?.businessName||"Provider",amount,currency,paidAt:settlement.paidAt,paidBy:settlement.paidBy},
        session
      });
      return{settlement,correction,audit};
    });

    res.status(201).json({
      ok:true,settlementId:result.settlement._id,correctionId:result.correction._id,
      status:"paid",paymentTruth:"reversed",originalAmount:result.correction.originalAmount,
      amountDelta:result.correction.amountDelta,effectiveAmountPaid:0,currency:result.correction.currency,
      reason:result.correction.reason,reversedAt:result.correction.reversedAt,
      reversedBy:req.user._id,auditId:result.audit._id
    });
  }catch(error){
    if(isSafeFinancialConflict(error))return res.status(409).json({error:"Settlement payment was already reversed or changed concurrently. Refresh and try again."});
    next(error);
  }
});

export default router;
