import mongoose from "mongoose";
import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import ProviderSettlement from "../models/ProviderSettlement.js";

export const PAYMENT_REVISION_RESTORE_PLAN_ID="2026-10-09-stage2b-payment-revision-restore-v1";
const TARGET_TRIP="Coral Whisper + White Prince Experience";
const FUN_N_SUN_PROVIDER_RE=/fun\s*(?:n|&|and)\s*sun/i;

function money(value){return Number(Number(value||0).toFixed(2));}
function shortId(value){const text=String(value||"");return text?text.slice(-8).toUpperCase():null;}
function withSession(query,session){return session?query.session(session):query;}

async function loadTarget({session=null}={}){
  const blockers=[];
  const providers=await withSession(Provider.find({businessName:FUN_N_SUN_PROVIDER_RE}).select("_id businessName status").lean(),session);
  if(providers.length!==1)blockers.push({code:"provider_count",expected:1,actual:providers.length});
  const provider=providers.length===1?providers[0]:null;
  if(provider&&provider.status!=="approved")blockers.push({code:"provider_status",expected:"approved",actual:provider.status});

  const trips=provider?await withSession(Trip.find({providerId:provider._id,titleEn:TARGET_TRIP}).select("_id titleEn active pricing").lean(),session):[];
  if(provider&&trips.length!==1)blockers.push({code:"trip_count",expected:1,actual:trips.length});
  const trip=trips.length===1?trips[0]:null;
  if(trip&&(!trip.active||trip.pricing?.commissionType!=="fixed_per_person"||Number(trip.pricing?.commissionValue)!==5)){
    blockers.push({code:"trip_configuration",expected:{active:true,commissionType:"fixed_per_person",commissionValue:5},actual:{active:Boolean(trip.active),commissionType:trip.pricing?.commissionType||null,commissionValue:Number(trip.pricing?.commissionValue||0)}});
  }

  const bookings=trip?await withSession(Booking.find({tripId:trip._id,status:"confirmed"}).select("_id status seats pricing checkedInAt createdAt updatedAt").sort({createdAt:1}).lean(),session):[];
  if(trip&&bookings.length!==2)blockers.push({code:"booking_count",expected:2,actual:bookings.length});

  const bookingRows=bookings.map(booking=>{
    const grossAmount=money(booking.pricing?.grossAmount);
    const expectedCommission=money(Math.min(grossAmount,Number(booking.seats||0)*5));
    const expectedProviderNet=money(grossAmount-expectedCommission);
    const currentCommission=money(booking.pricing?.commissionAmount);
    const currentProviderNet=money(booking.pricing?.providerNetAmount);
    if(currentCommission!==expectedCommission||currentProviderNet!==expectedProviderNet){
      blockers.push({code:"booking_snapshot_conflict",bookingRef:shortId(booking._id)});
    }
    return {
      bookingRef:shortId(booking._id),
      seats:Number(booking.seats||0),
      grossAmount,
      commissionAmount:currentCommission,
      providerNetAmount:currentProviderNet,
      checkedIn:Boolean(booking.checkedInAt)
    };
  });

  const totals=bookingRows.reduce((acc,row)=>{
    acc.bookings+=1;acc.seats+=row.seats;acc.grossAmount+=row.grossAmount;acc.commissionAmount+=row.commissionAmount;acc.providerNetAmount+=row.providerNetAmount;return acc;
  },{bookings:0,seats:0,grossAmount:0,commissionAmount:0,providerNetAmount:0});
  for(const key of ["grossAmount","commissionAmount","providerNetAmount"])totals[key]=money(totals[key]);
  if(bookings.length===2&&(totals.seats!==6||totals.grossAmount!==137||totals.commissionAmount!==30||totals.providerNetAmount!==107)){
    blockers.push({code:"historical_totals",expected:{bookings:2,seats:6,grossAmount:137,commissionAmount:30,providerNetAmount:107},actual:totals});
  }

  const bookingIds=bookings.map(b=>b._id);
  const payments=bookingIds.length?await withSession(Payment.find({bookingId:{$in:bookingIds}}).select("_id bookingId status amount currency refundedAmount paidAt settlementRevision createdAt updatedAt").sort({createdAt:1}).lean(),session):[];
  if(bookingIds.length&&payments.length!==2)blockers.push({code:"payment_count",expected:2,actual:payments.length});
  const bookingById=new Map(bookings.map(b=>[String(b._id),b]));
  const paymentRows=payments.map(payment=>{
    const booking=bookingById.get(String(payment.bookingId));
    const expectedAmount=booking?money(booking.pricing?.grossAmount):null;
    if(!booking||payment.status!=="paid"||!payment.paidAt||money(payment.refundedAmount)!==0||money(payment.amount)!==expectedAmount||String(payment.currency||"JOD")!==String(booking?.pricing?.currency||"JOD")){
      blockers.push({code:"payment_state_conflict",paymentRef:shortId(payment._id)});
    }
    return {
      paymentRef:shortId(payment._id),
      bookingRef:shortId(payment.bookingId),
      status:payment.status,
      amount:money(payment.amount),
      currency:String(payment.currency||"JOD"),
      refundedAmount:money(payment.refundedAmount),
      settlementRevision:Number(payment.settlementRevision||0)
    };
  });

  const paymentIds=payments.map(p=>p._id);
  const settlements=(paymentIds.length||bookingIds.length)?await withSession(ProviderSettlement.find({$or:[{paymentIds:{$in:paymentIds}},{bookingIds:{$in:bookingIds}}]}).select("_id status paidAt").lean(),session):[];
  if(settlements.length)blockers.push({code:"existing_settlement",actual:settlements.length});

  const revisions=paymentRows.map(row=>row.settlementRevision);
  const changesRequired=paymentRows.length===2&&revisions.every(value=>value===1)&&settlements.length===0;
  const alreadyRestored=paymentRows.length===2&&revisions.every(value=>value===0)&&settlements.length===0;
  if(paymentRows.length===2&&!changesRequired&&!alreadyRestored){
    blockers.push({code:"settlement_revision_conflict",expected:"both 1 before restore or both 0 after restore",actual:revisions});
  }

  return {
    planId:PAYMENT_REVISION_RESTORE_PLAN_ID,
    ok:blockers.length===0,
    blockers,
    changesRequired,
    alreadyRestored,
    provider:provider?{businessName:provider.businessName,status:provider.status}:null,
    trip:trip?{titleEn:trip.titleEn,active:Boolean(trip.active),commissionType:trip.pricing?.commissionType||null,commissionValue:Number(trip.pricing?.commissionValue||0)}:null,
    totals,
    bookings:bookingRows,
    payments:paymentRows,
    settlementRecords:settlements.map(s=>({settlementRef:shortId(s._id),status:s.status,paidAt:s.paidAt||null})),
    _ids:{bookingIds,paymentIds}
  };
}

function publicReport(report){
  const {_ids,...safe}=report;
  return safe;
}

export async function previewPaymentRevisionRestore(){
  return publicReport(await loadTarget());
}

export async function applyPaymentRevisionRestore(){
  const session=await mongoose.startSession();
  let before;
  let restoredPayments=0;
  let alreadyRestored=false;
  try{
    await session.withTransaction(async()=>{
      before=await loadTarget({session});
      if(!before.ok){
        const error=new Error("Payment revision restore preconditions failed");
        error.statusCode=409;
        error.details=before.blockers;
        throw error;
      }
      if(before.alreadyRestored){alreadyRestored=true;return;}
      if(!before.changesRequired){
        const error=new Error("Payment revision restore is not required");
        error.statusCode=409;
        throw error;
      }

      // Native collection write avoids touching updatedAt. It also writes the
      // same Payment rows used by provider-settlement serialization, so a
      // concurrent settlement cannot silently race this one-time remediation.
      const result=await Payment.collection.updateMany(
        {_id:{$in:before._ids.paymentIds},settlementRevision:1},
        {$set:{settlementRevision:0}},
        {session}
      );
      restoredPayments=Number(result.modifiedCount||0);
      if(Number(result.matchedCount||0)!==2||restoredPayments!==2){
        const error=new Error("Exact Payment revision precondition failed");
        error.statusCode=409;
        throw error;
      }

      const settlements=await ProviderSettlement.find({$or:[{paymentIds:{$in:before._ids.paymentIds}},{bookingIds:{$in:before._ids.bookingIds}}]}).select("_id").session(session).lean();
      if(settlements.length){
        const error=new Error("Payment revision restore blocked by settlement");
        error.statusCode=409;
        throw error;
      }

      const afterInside=await loadTarget({session});
      if(!afterInside.ok||!afterInside.alreadyRestored||afterInside.totals.grossAmount!==137||afterInside.totals.commissionAmount!==30||afterInside.totals.providerNetAmount!==107){
        const error=new Error("Payment revision restore postcondition failed");
        error.statusCode=409;
        throw error;
      }
    });

    const after=await loadTarget();
    if(!after.ok||!after.alreadyRestored||after.settlementRecords.length!==0){
      const error=new Error("Payment revision restore final verification failed");
      error.statusCode=409;
      throw error;
    }
    return {
      planId:PAYMENT_REVISION_RESTORE_PLAN_ID,
      applied:restoredPayments===2,
      alreadyRestored,
      restoredPayments,
      before:publicReport(before),
      after:publicReport(after)
    };
  }finally{
    await session.endSession();
  }
}
