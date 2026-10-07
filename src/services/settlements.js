import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import Provider from "../models/Provider.js";
import ProviderSettlement from "../models/ProviderSettlement.js";

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
  const settled=paymentIds.length?await ProviderSettlement.find({paymentIds:{$in:paymentIds},status:"paid"}).session(session||null).lean():[];
  const settledIds=new Set(settled.flatMap(s=>(s.paymentIds||[]).map(String)));
  const providersList=await Provider.find({}).select("_id businessName status").sort({businessName:1}).session(session||null).lean();
  const byProvider=new Map();
  for(const p of providersList){
    if(providerId&&String(p._id)!==providerId)continue;
    byProvider.set(String(p._id),{
      providerId:p._id,providerName:p.businessName,providerStatus:p.status,
      bookings:0,grossSales:0,refunds:0,seaGoCommission:0,providerNet:0,paid:0,outstanding:0,
      unsettledPaymentIds:[],unsettledBookingIds:[],items:[],recoveryDue:0,reconciliationRequired:false
    });
  }
  for(const x of payments){
    const key=String(x.providerId);
    if(!byProvider.has(key))byProvider.set(key,{providerId:x.providerId,providerName:x.providerName,providerStatus:"",bookings:0,grossSales:0,refunds:0,seaGoCommission:0,providerNet:0,paid:0,outstanding:0,unsettledPaymentIds:[],unsettledBookingIds:[],items:[],recoveryDue:0,reconciliationRequired:false});
    const row=byProvider.get(key);
    const gross=Number(x.amount||0),refund=Number(x.refundedAmount||0),retained=Math.max(0,gross-refund);
    const ratio=gross>0?retained/gross:0;
    const commission=settlementMoney(Number(x.commissionAmount||0)*ratio);
    const providerNet=settlementMoney(Number(x.providerNetAmount||0)*ratio);
    const isSettled=settledIds.has(String(x.paymentId));
    if(x.paymentStatus==="needs_review")row.reconciliationRequired=true;
    row.bookings+=1;row.grossSales+=gross;row.refunds+=refund;row.seaGoCommission+=commission;row.providerNet+=providerNet;
    if(isSettled){}
    else{
      row.outstanding+=providerNet;
      row.unsettledPaymentIds.push(x.paymentId);
      row.unsettledBookingIds.push(x.bookingId);
      row.items.push({paymentId:x.paymentId,bookingId:x.bookingId,grossSales:gross,refunds:refund,seaGoCommission:settlementMoney(commission),providerNet:settlementMoney(providerNet),amountPaid:settlementMoney(providerNet)});
    }
  }
  const selected=new Set(paymentIds.map(String));
  for(const s of settled){
    const row=byProvider.get(String(s.providerId));
    if(!row)continue;
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
    const unsettledNet=row.items.reduce((sum,i)=>sum+i.providerNet,0);
    row.recoveryDue=settlementMoney(Math.max(0,row.paid-(row.providerNet-unsettledNet)));
    row.outstanding=settlementMoney(row.providerNet-row.paid);
  }
  const breakdown=[...byProvider.values()].map(r=>({
    ...r,
    grossSales:settlementMoney(r.grossSales),
    refunds:settlementMoney(r.refunds),
    seaGoCommission:settlementMoney(r.seaGoCommission),
    providerNet:settlementMoney(r.providerNet),
    outstanding:r.reconciliationRequired?null:settlementMoney(r.outstanding),
    paid:r.reconciliationRequired?null:settlementMoney(r.paid)
  })).sort((a,b)=>b.outstanding-a.outstanding||a.providerName.localeCompare(b.providerName));
  const totals=breakdown.reduce((a,r)=>{
    a.grossSales+=r.grossSales;a.refunds+=r.refunds;a.seaGoCommission+=r.seaGoCommission;a.providerNet+=r.providerNet;a.paid+=r.paid;a.outstanding+=r.outstanding;return a;
  },{grossSales:0,refunds:0,seaGoCommission:0,providerNet:0,paid:0,outstanding:0});
  totals.recoveryDue=breakdown.reduce((sum,r)=>sum+r.recoveryDue,0);
  const reconciliationRequired=breakdown.some(r=>r.reconciliationRequired);
  return{providersList,breakdown,reconciliationRequired,totals:{...Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,settlementMoney(v)])),...(reconciliationRequired?{paid:null,outstanding:null}:{})}};
}

export async function recordSettlement({from,to,providerId,paidBy,note}) {
  const session=await mongoose.startSession();
  let settlement;
  try {
    await session.withTransaction(async()=>{
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
      if(!row||row.reconciliationRequired||row.outstanding<=0||!row.items.length)
        throw Object.assign(new Error("No outstanding provider balance in this period"),{statusCode:409});
      const sums=Object.fromEntries(['grossSales','refunds','seaGoCommission','providerNet','amountPaid'].map(k=>[k,settlementMoney(row.items.reduce((sum,i)=>sum+i[k],0))]));
      [settlement]=await ProviderSettlement.create([{
        providerId,paymentIds:row.unsettledPaymentIds,bookingIds:row.unsettledBookingIds,
        items:row.items,periodFrom:from,periodTo:to,currency:'JOD',...sums,
        paidAt:new Date(),paidBy,note:String(note||'').trim().slice(0,500)
      }],{session});
    });
    return settlement;
  }finally{await session.endSession()}
}
