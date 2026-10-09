import mongoose from "mongoose";
import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import ProviderSettlement from "../models/ProviderSettlement.js";

export const STAGE2B_PLAN_ID="2026-10-09-fun-n-sun-coral-financial-stage2b-v1";
export const STAGE2B_TARGET_TRIP="Coral Whisper + White Prince Experience";
const FUN_N_SUN_PROVIDER_RE=/fun\s*(?:n|&|and)\s*sun/i;

function money(value){return Number(Number(value||0).toFixed(2));}
function shortId(value){const text=String(value||"");return text?text.slice(-8).toUpperCase():null;}
function withSession(query,session){return session?query.session(session):query;}

export function expectedCommissionForBooking({seats=0,grossAmount=0}={}){
  return money(Math.min(Number(grossAmount||0),Number(seats||0)*5));
}

export function classifyBookingSnapshot({seats=0,grossAmount=0,commissionAmount=0,providerNetAmount=0}={}){
  const gross=money(grossAmount);
  const commission=money(commissionAmount);
  const providerNet=money(providerNetAmount);
  const expectedCommission=expectedCommissionForBooking({seats,grossAmount:gross});
  const expectedProviderNet=money(gross-expectedCommission);
  if(commission===0&&providerNet===gross)return "before";
  if(commission===expectedCommission&&providerNet===expectedProviderNet)return "after";
  return "conflict";
}

async function loadState({session=null}={}){
  const blockers=[];
  const providers=await withSession(Provider.find({businessName:FUN_N_SUN_PROVIDER_RE}).select("_id businessName status").lean(),session);
  if(providers.length!==1)blockers.push({code:"provider_count",expected:1,actual:providers.length});
  const provider=providers.length===1?providers[0]:null;

  const trips=provider?await withSession(Trip.find({providerId:provider._id,titleEn:STAGE2B_TARGET_TRIP}).select("_id titleEn active pricing").lean(),session):[];
  if(provider&&trips.length!==1)blockers.push({code:"trip_count",expected:1,actual:trips.length});
  const trip=trips.length===1?trips[0]:null;
  if(trip&&(trip.pricing?.commissionType!=="fixed_per_person"||Number(trip.pricing?.commissionValue)!==5)){
    blockers.push({code:"trip_commission_configuration",expected:{commissionType:"fixed_per_person",commissionValue:5},actual:{commissionType:trip.pricing?.commissionType||null,commissionValue:Number(trip.pricing?.commissionValue||0)}});
  }

  const bookings=trip?await withSession(Booking.find({tripId:trip._id,status:"confirmed"}).select("_id providerId tripId departureId status seats adults children mealPlan pricing checkedInAt createdAt").sort({createdAt:1}).lean(),session):[];
  if(trip&&bookings.length!==2)blockers.push({code:"booking_count",expected:2,actual:bookings.length});

  const bookingIds=bookings.map(b=>b._id);
  const payments=bookingIds.length?await withSession(Payment.find({bookingId:{$in:bookingIds}}).select("_id bookingId status amount currency refundedAmount paidAt settlementRevision").sort({createdAt:1}).lean(),session):[];
  if(bookingIds.length&&payments.length!==bookings.length)blockers.push({code:"payment_count",expected:bookings.length,actual:payments.length});
  const paymentByBooking=new Map(payments.map(p=>[String(p.bookingId),p]));

  const paymentIds=payments.map(p=>p._id);
  const settlements=(paymentIds.length||bookingIds.length)?await withSession(ProviderSettlement.find({$or:[{paymentIds:{$in:paymentIds}},{bookingIds:{$in:bookingIds}}]}).select("_id paymentIds bookingIds status paidAt amountPaid seaGoCommission providerNet").lean(),session):[];
  if(settlements.length)blockers.push({code:"existing_settlement",actual:settlements.length});

  const rows=bookings.map(booking=>{
    const grossAmount=money(booking.pricing?.grossAmount);
    const recordedCommission=money(booking.pricing?.commissionAmount);
    const recordedProviderNet=money(booking.pricing?.providerNetAmount);
    const expectedCommission=expectedCommissionForBooking({seats:booking.seats,grossAmount});
    const expectedProviderNet=money(grossAmount-expectedCommission);
    const state=classifyBookingSnapshot({seats:booking.seats,grossAmount,commissionAmount:recordedCommission,providerNetAmount:recordedProviderNet});
    const payment=paymentByBooking.get(String(booking._id))||null;
    if(state==="conflict")blockers.push({code:"booking_snapshot_conflict",bookingRef:shortId(booking._id)});
    if(payment){
      if(payment.status!=="paid"||!payment.paidAt)blockers.push({code:"payment_not_paid",bookingRef:shortId(booking._id),status:payment.status||null});
      if(money(payment.refundedAmount)!==0)blockers.push({code:"payment_refunded",bookingRef:shortId(booking._id),refundedAmount:money(payment.refundedAmount)});
      if(money(payment.amount)!==grossAmount)blockers.push({code:"payment_amount_mismatch",bookingRef:shortId(booking._id),paymentAmount:money(payment.amount),grossAmount});
      if(String(payment.currency||"JOD")!==String(booking.pricing?.currency||"JOD"))blockers.push({code:"payment_currency_mismatch",bookingRef:shortId(booking._id)});
    }
    return {
      bookingRef:shortId(booking._id),
      paymentRef:payment?shortId(payment._id):null,
      seats:Number(booking.seats||0),
      grossAmount,
      currentCommission:recordedCommission,
      correctCommission:expectedCommission,
      commissionDelta:money(expectedCommission-recordedCommission),
      currentProviderNet:recordedProviderNet,
      correctProviderNet:expectedProviderNet,
      providerNetDelta:money(expectedProviderNet-recordedProviderNet),
      state,
      paymentStatus:payment?.status||null,
      paymentAmount:payment?money(payment.amount):null,
      settlementRevision:payment?Number(payment.settlementRevision||0):null,
      checkedIn:Boolean(booking.checkedInAt)
    };
  });

  const totals=rows.reduce((acc,row)=>{
    acc.bookings+=1;acc.seats+=row.seats;acc.grossAmount+=row.grossAmount;acc.currentCommission+=row.currentCommission;acc.correctCommission+=row.correctCommission;acc.commissionDelta+=row.commissionDelta;acc.currentProviderNet+=row.currentProviderNet;acc.correctProviderNet+=row.correctProviderNet;acc.providerNetDelta+=row.providerNetDelta;return acc;
  },{bookings:0,seats:0,grossAmount:0,currentCommission:0,correctCommission:0,commissionDelta:0,currentProviderNet:0,correctProviderNet:0,providerNetDelta:0});
  for(const key of ["grossAmount","currentCommission","correctCommission","commissionDelta","currentProviderNet","correctProviderNet","providerNetDelta"])totals[key]=money(totals[key]);
  if(bookings.length===2&&(totals.seats!==6||totals.grossAmount!==137))blockers.push({code:"historical_totals_mismatch",expected:{seats:6,grossAmount:137},actual:{seats:totals.seats,grossAmount:totals.grossAmount}});

  const states=new Set(rows.map(r=>r.state));
  if(states.has("before")&&states.has("after"))blockers.push({code:"mixed_snapshot_state"});
  const changesRequired=rows.length===2&&rows.every(r=>r.state==="before");
  const alreadyCorrect=rows.length===2&&rows.every(r=>r.state==="after");

  return {
    planId:STAGE2B_PLAN_ID,
    ok:blockers.length===0,
    blockers,
    changesRequired,
    alreadyCorrect,
    provider:provider?{businessName:provider.businessName,status:provider.status}:null,
    trip:trip?{titleEn:trip.titleEn,active:Boolean(trip.active),commissionType:trip.pricing?.commissionType||null,commissionValue:Number(trip.pricing?.commissionValue||0)}:null,
    totals,
    rows,
    settlementRecords:settlements.map(s=>({settlementRef:shortId(s._id),status:s.status,paidAt:s.paidAt||null,amountPaid:money(s.amountPaid)}))
  };
}

export async function previewPilotFinancialStage2b(options={}){
  return loadState(options);
}

export async function applyPilotFinancialStage2b(){
  const session=await mongoose.startSession();
  let before;
  let changedBookings=0;
  let serializedPayments=0;
  let restoredPayments=0;
  try{
    await session.withTransaction(async()=>{
      before=await loadState({session});
      if(!before.ok){
        const error=new Error("Stage 2B financial preconditions failed");
        error.statusCode=409;
        error.details=before.blockers;
        throw error;
      }
      if(!before.changesRequired)return;

      const provider=await Provider.findOne({businessName:FUN_N_SUN_PROVIDER_RE}).session(session);
      const trip=await Trip.findOne({providerId:provider._id,titleEn:STAGE2B_TARGET_TRIP}).session(session);
      const bookings=await Booking.find({tripId:trip._id,status:"confirmed"}).sort({createdAt:1}).session(session);
      const bookingIds=bookings.map(b=>b._id);
      const payments=await Payment.find({bookingId:{$in:bookingIds}}).session(session);
      const paymentIds=payments.map(p=>p._id);

      // recordSettlement() serializes provider payouts by incrementing the same
      // Payment rows. Touch them transactionally to create the same write conflict,
      // then restore each raw value exactly before commit so Payment data/timestamps
      // remain unchanged by this repair.
      const rawPayments=await Payment.collection.find(
        {_id:{$in:paymentIds}},
        {session,projection:{settlementRevision:1}}
      ).toArray();
      if(rawPayments.length!==2)throw Object.assign(new Error("Could not snapshot target payment locks"),{statusCode:409});
      const lock=await Payment.collection.updateMany(
        {_id:{$in:paymentIds}},
        {$inc:{settlementRevision:1}},
        {session}
      );
      serializedPayments=Number(lock.modifiedCount||0);
      if(serializedPayments!==2)throw Object.assign(new Error("Could not serialize target payments"),{statusCode:409});

      const settlements=await ProviderSettlement.find({$or:[{paymentIds:{$in:paymentIds}},{bookingIds:{$in:bookingIds}}]}).session(session).lean();
      if(settlements.length)throw Object.assign(new Error("Affected payment was settled before correction could be applied"),{statusCode:409});

      for(const booking of bookings){
        const gross=money(booking.pricing?.grossAmount);
        const currentState=classifyBookingSnapshot({seats:booking.seats,grossAmount:gross,commissionAmount:booking.pricing?.commissionAmount,providerNetAmount:booking.pricing?.providerNetAmount});
        if(currentState!=="before")throw Object.assign(new Error("Booking snapshot changed during Stage 2B correction"),{statusCode:409});
        const commission=expectedCommissionForBooking({seats:booking.seats,grossAmount:gross});
        const providerNet=money(gross-commission);
        const result=await Booking.updateOne(
          {_id:booking._id,status:"confirmed","pricing.grossAmount":gross,"pricing.commissionAmount":0,"pricing.providerNetAmount":gross},
          {$set:{"pricing.commissionAmount":commission,"pricing.providerNetAmount":providerNet}},
          {session}
        );
        if(Number(result.modifiedCount||0)!==1)throw Object.assign(new Error("Exact booking precondition failed during Stage 2B correction"),{statusCode:409});
        changedBookings+=1;
      }

      for(const raw of rawPayments){
        const hasRevision=Object.prototype.hasOwnProperty.call(raw,"settlementRevision");
        const update=hasRevision?{$set:{settlementRevision:raw.settlementRevision}}:{$unset:{settlementRevision:""}};
        const restored=await Payment.collection.updateOne({_id:raw._id},update,{session});
        if(Number(restored.matchedCount||0)!==1)throw Object.assign(new Error("Could not restore target payment lock"),{statusCode:409});
        restoredPayments+=1;
      }
      if(restoredPayments!==2)throw Object.assign(new Error("Could not restore target payment locks"),{statusCode:409});

      const afterInside=await loadState({session});
      if(!afterInside.ok||!afterInside.alreadyCorrect||afterInside.totals.currentCommission!==30||afterInside.totals.currentProviderNet!==107){
        throw Object.assign(new Error("Stage 2B postcondition failed; transaction rolled back"),{statusCode:409});
      }
    });
    const after=await loadState();
    return {
      planId:STAGE2B_PLAN_ID,
      applied:changedBookings===2,
      changedBookings,
      serializedPayments,
      restoredPayments,
      before,
      after
    };
  }finally{
    await session.endSession();
  }
}
