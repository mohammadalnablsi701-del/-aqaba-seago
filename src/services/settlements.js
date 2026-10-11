import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import Provider from "../models/Provider.js";
import ProviderSettlement from "../models/ProviderSettlement.js";
import SettlementCorrection from "../models/SettlementCorrection.js";

function settlementMoney(n){return Number(Number(n||0).toFixed(2));}

export async function settlementLedger({from,to,providerId,session}={}){
  const match={status:{$in:["paid","partially_refunded","refunded","needs_review"]},bookingId:{$ne:null},paidAt:{$ne:null}};
  if(from||to){
    match.paidAt={};
    if(from)match.paidAt.$gte=from;
    if(to)match.paidAt.$lte=to;
  }
  const pipeline=[
    {$match:match},
    {$lookup:{from:"bookings",localField:"bookingId",foreignField:"_id",as:"booking"}},
    {$unwind:"$booking"}
  ];
  if(providerId)pipeline.push({$match:{"booking.providerId":new mongoose.Types.ObjectId(providerId)}});
  pipeline.push(
    {$lookup:{from:"providers",localField:"booking.providerId",foreignField:"_id",as:"provider"}},
    {$unwind:{path:"$provider",preserveNullAndEmptyArrays:true}},
    {$project:{
      paymentId:"$_id",
      paymentStatus:"$status",
      bookingId:"$booking._id",
      providerId:"$booking.providerId",
      providerName:{$ifNull:["$provider.businessName","Unknown provider"]},
      amount:{$ifNull:["$amount",0]},
      refundedAmount:{$ifNull:["$refundedAmount",0]},
      commissionAmount:{$ifNull:["$booking.pricing.commissionAmount",0]},
      providerNetAmount:{$ifNull:["$booking.pricing.providerNetAmount",0]}
    }}
  );
  const payments=await Payment.aggregate(pipeline).session(session||null);
  const paymentIds=payments.map(x=>x.paymentId);
  const settled=paymentIds.length
    ?await ProviderSettlement.find({paymentIds:{$in:paymentIds},status:"paid"}).session(session||null).lean()
    :[];
  const settlementIds=settled.map(s=>s._id);
  const corrections=settlementIds.length
    ?await SettlementCorrection.find({settlementId:{$in:settlementIds},type:"payment_reversal"}).session(session||null).lean()
    :[];
  const reversedSettlementIds=new Set(corrections.map(c=>String(c.settlementId)));

  // Allocation truth never disappears: even a reversed payout keeps the original
  // payment IDs allocated so the same booking/payment value cannot be settled twice.
  const settledIds=new Set(settled.flatMap(s=>(s.paymentIds||[]).map(String)));
  const providersList=await Provider.find({}).select("_id businessName status").sort({businessName:1}).session(session||null).lean();
  const byProvider=new Map();
  for(const p of providersList){
    if(providerId&&String(p._id)!==providerId)continue;
    byProvider.set(String(p._id),{
      providerId:p._id,providerName:p.businessName,providerStatus:p.status,
      bookings:0,grossSales:0,refunds:0,seaGoCommission:0,providerNet:0,paid:0,outstanding:0,
      payableNow:0,reversedOutstanding:0,
      unsettledPaymentIds:[],unsettledBookingIds:[],items:[],recoveryDue:0,reconciliationRequired:false
    });
  }
  for(const x of payments){
    const key=String(x.providerId);
    if(!byProvider.has(key))byProvider.set(key,{
      providerId:x.providerId,providerName:x.providerName,providerStatus:"",
      bookings:0,grossSales:0,refunds:0,seaGoCommission:0,providerNet:0,paid:0,outstanding:0,
      payableNow:0,reversedOutstanding:0,
      unsettledPaymentIds:[],unsettledBookingIds:[],items:[],recoveryDue:0,reconciliationRequired:false
    });
    const row=byProvider.get(key);
    const gross=Number(x.amount||0),refund=Number(x.refundedAmount||0),retained=Math.max(0,gross-refund);
    const ratio=gross>0?retained/gross:0;
    const commission=settlementMoney(Number(x.commissionAmount||0)*ratio);
    const providerNet=settlementMoney(Number(x.providerNetAmount||0)*ratio);
    const isAllocated=settledIds.has(String(x.paymentId));
    if(x.paymentStatus==="needs_review")row.reconciliationRequired=true;
    row.bookings+=1;row.grossSales+=gross;row.refunds+=refund;row.seaGoCommission+=commission;row.providerNet+=providerNet;
    if(!isAllocated){
      row.unsettledPaymentIds.push(x.paymentId);
      row.unsettledBookingIds.push(x.bookingId);
      row.items.push({paymentId:x.paymentId,bookingId:x.bookingId,grossSales:gross,refunds:refund,seaGoCommission:settlementMoney(commission),providerNet:settlementMoney(providerNet),amountPaid:settlementMoney(providerNet)});
    }
  }

  const selected=new Set(paymentIds.map(String));
  for(const s of settled){
    const row=byProvider.get(String(s.providerId));
    if(!row)continue;
    if(reversedSettlementIds.has(String(s._id)))continue;
    if(s.items?.length){
      row.paid+=s.items.filter(i=>selected.has(String(i.paymentId))).reduce((sum,i)=>sum+Number(i.amountPaid),0);
    }else if(s.paymentIds.every(id=>selected.has(String(id)))){
      // Legacy records have an exact batch total, but no per-payment allocation.
      row.paid+=Number(s.amountPaid);
    }else{
      row.reconciliationRequired=true;
    }
  }

  for(const row of byProvider.values()){
    const unsettledNet=row.items.reduce((sum,i)=>sum+Number(i.providerNet||0),0);
    row.payableNow=settlementMoney(unsettledNet);
    row.recoveryDue=settlementMoney(Math.max(0,row.paid-(row.providerNet-unsettledNet)));
    row.outstanding=settlementMoney(row.providerNet-row.paid);
    row.reversedOutstanding=settlementMoney(Math.max(0,row.outstanding-row.payableNow));
  }

  const breakdown=[...byProvider.values()].map(r=>({
    ...r,
    grossSales:settlementMoney(r.grossSales),
    refunds:settlementMoney(r.refunds),
    seaGoCommission:settlementMoney(r.seaGoCommission),
    providerNet:settlementMoney(r.providerNet),
    payableNow:r.reconciliationRequired?null:settlementMoney(r.payableNow),
    reversedOutstanding:r.reconciliationRequired?null:settlementMoney(r.reversedOutstanding),
    outstanding:r.reconciliationRequired?null:settlementMoney(r.outstanding),
    paid:r.reconciliationRequired?null:settlementMoney(r.paid)
  })).sort((a,b)=>Number(b.outstanding||0)-Number(a.outstanding||0)||a.providerName.localeCompare(b.providerName));

  const totals=breakdown.reduce((a,r)=>{
    a.grossSales+=Number(r.grossSales||0);
    a.refunds+=Number(r.refunds||0);
    a.seaGoCommission+=Number(r.seaGoCommission||0);
    a.providerNet+=Number(r.providerNet||0);
    a.paid+=Number(r.paid||0);
    a.outstanding+=Number(r.outstanding||0);
    a.payableNow+=Number(r.payableNow||0);
    a.reversedOutstanding+=Number(r.reversedOutstanding||0);
    return a;
  },{grossSales:0,refunds:0,seaGoCommission:0,providerNet:0,paid:0,outstanding:0,payableNow:0,reversedOutstanding:0});
  totals.recoveryDue=breakdown.reduce((sum,r)=>sum+Number(r.recoveryDue||0),0);
  const reconciliationRequired=breakdown.some(r=>r.reconciliationRequired);
  return{
    providersList,breakdown,reconciliationRequired,
    totals:{
      ...Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,settlementMoney(v)])),
      ...(reconciliationRequired?{paid:null,outstanding:null,payableNow:null,reversedOutstanding:null}:{})
    }
  };
}

async function recordSettlementInSession({from,to,providerId,paidBy,reason,note},session){
  // Serialize payouts with every refund for this provider, including refunds
  // outside the selected date window. Refunds write these same Payment rows.
  const all=await settlementLedger({providerId,session});
  const account=all.breakdown.find(r=>String(r.providerId)===String(providerId));
  if(!account||account.reconciliationRequired||account.recoveryDue>0)
    throw Object.assign(new Error("Provider refunds require reconciliation before another settlement"),{statusCode:409});

  const paymentIds=await Payment.aggregate([
    {$match:{paidAt:{$ne:null},bookingId:{$ne:null}}},
    {$lookup:{from:"bookings",localField:"bookingId",foreignField:"_id",as:"booking"}},
    {$match:{"booking.providerId":new mongoose.Types.ObjectId(providerId)}},
    {$project:{_id:1}}
  ]).session(session);
  await Payment.updateMany({_id:{$in:paymentIds.map(p=>p._id)}},{$inc:{settlementRevision:1}},{session});

  const data=await settlementLedger({from,to,providerId,session});
  const row=data.breakdown.find(r=>String(r.providerId)===String(providerId));
  if(!row||row.reconciliationRequired||Number(row.payableNow||0)<=0||!row.items.length){
    if(row&&Number(row.reversedOutstanding||0)>0)
      throw Object.assign(new Error("Reversed settlement balance cannot be re-recorded through Mark Paid"),{statusCode:409,code:"SETTLEMENT_REPAYMENT_REQUIRES_DEDICATED_FLOW"});
    throw Object.assign(new Error("No outstanding provider balance in this period"),{statusCode:409});
  }

  const sums=Object.fromEntries(["grossSales","refunds","seaGoCommission","providerNet","amountPaid"].map(k=>[k,settlementMoney(row.items.reduce((sum,i)=>sum+Number(i[k]||0),0))]));
  const normalizedReason=String(reason||note||"").trim().slice(0,500);
  const [settlement]=await ProviderSettlement.create([{
    providerId,paymentIds:row.unsettledPaymentIds,bookingIds:row.unsettledBookingIds,
    items:row.items,periodFrom:from,periodTo:to,currency:"JOD",...sums,
    paidAt:new Date(),paidBy,
    ...(normalizedReason?{reason:normalizedReason}:{}),
    ...(note?{note:String(note).trim().slice(0,500)}:{})
  }],{session});
  return settlement;
}

export async function recordSettlement({from,to,providerId,paidBy,reason,note,session:externalSession}){
  if(externalSession)return recordSettlementInSession({from,to,providerId,paidBy,reason,note},externalSession);
  const session=await mongoose.startSession();
  let settlement;
  try{
    await session.withTransaction(async()=>{
      settlement=await recordSettlementInSession({from,to,providerId,paidBy,reason,note},session);
    });
    return settlement;
  }finally{
    await session.endSession();
  }
}
