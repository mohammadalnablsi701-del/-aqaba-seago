import mongoose from "mongoose";
import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import ProviderSettlement from "../models/ProviderSettlement.js";

export const STAGE2B_PLAN_ID="2026-10-09-fun-n-sun-coral-finance-stage2b-v1";
export const STAGE2B_TARGET_TRIP="Coral Whisper + White Prince Experience";
const FUN_N_SUN_PROVIDER_RE=/fun\s*(?:n|&|and)\s*sun/i;

function money(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100;}
function withSession(query,session){return session?query.session(session):query;}
export function expectedStage2bCommission({seats,grossAmount}){return money(Math.min(Number(grossAmount||0),Number(seats||0)*5));}

async function inspect({session=null}={}){
  const blockers=[];
  const providers=await withSession(Provider.find({businessName:FUN_N_SUN_PROVIDER_RE}).select("_id businessName status"),session);
  if(providers.length!==1)return {ok:false,blockers:[{code:"provider_count",expected:1,actual:providers.length}]};
  const provider=providers[0];
  if(provider.status!=="approved")blockers.push({code:"provider_status",expected:"approved",actual:provider.status});

  const trips=await withSession(Trip.find({providerId:provider._id,titleEn:STAGE2B_TARGET_TRIP}).select("_id titleEn active pricing"),session);
  if(trips.length!==1)return {ok:false,blockers:[...blockers,{code:"trip_count",expected:1,actual:trips.length}]};
  const trip=trips[0];
  if(trip.active!==true)blockers.push({code:"trip_active",expected:true,actual:Boolean(trip.active)});
  if(trip.pricing?.commissionType!=="fixed_per_person"||Number(trip.pricing?.commissionValue)!==5){
    blockers.push({code:"trip_commission",expected:{type:"fixed_per_person",value:5},actual:{type:trip.pricing?.commissionType||null,value:Number(trip.pricing?.commissionValue||0)}});
  }

  const bookings=await withSession(Booking.find({tripId:trip._id,status:"confirmed"}).sort({createdAt:1}),session);
  const rows=bookings.map(b=>{
    const gross=money(b.pricing?.grossAmount);
    const currentCommission=money(b.pricing?.commissionAmount);
    const correctCommission=expectedStage2bCommission({seats:b.seats,grossAmount:gross});
    const currentProviderNet=money(b.pricing?.providerNetAmount);
    const correctProviderNet=money(gross-correctCommission);
    return {bookingId:b._id,seats:Number(b.seats||0),gross,currentCommission,correctCommission,currentProviderNet,correctProviderNet,booking:b};
  });
  const totals=rows.reduce((a,r)=>({bookings:a.bookings+1,seats:a.seats+r.seats,gross:money(a.gross+r.gross),currentCommission:money(a.currentCommission+r.currentCommission),correctCommission:money(a.correctCommission+r.correctCommission),currentProviderNet:money(a.currentProviderNet+r.currentProviderNet),correctProviderNet:money(a.correctProviderNet+r.correctProviderNet)}),{bookings:0,seats:0,gross:0,currentCommission:0,correctCommission:0,currentProviderNet:0,correctProviderNet:0});
  if(totals.bookings!==2)blockers.push({code:"booking_count",expected:2,actual:totals.bookings});
  if(totals.seats!==6)blockers.push({code:"seat_count",expected:6,actual:totals.seats});
  if(totals.gross!==137)blockers.push({code:"gross_total",expected:137,actual:totals.gross});
  if(totals.correctCommission!==30)blockers.push({code:"correct_commission_total",expected:30,actual:totals.correctCommission});
  const alreadyCorrect=rows.length===2&&rows.every(r=>r.currentCommission===r.correctCommission&&r.currentProviderNet===r.correctProviderNet);
  const expectedPreRepair=rows.length===2&&rows.every(r=>r.currentCommission===0&&r.currentProviderNet===r.gross);
  if(!alreadyCorrect&&!expectedPreRepair)blockers.push({code:"booking_snapshot_conflict"});

  const bookingIds=rows.map(r=>r.bookingId);
  const payments=bookingIds.length?await withSession(Payment.find({bookingId:{$in:bookingIds}}).select("_id bookingId status amount currency refundedAmount provider paidAt"),session):[];
  if(payments.length!==2)blockers.push({code:"payment_count",expected:2,actual:payments.length});
  for(const row of rows){
    const matches=payments.filter(p=>String(p.bookingId)===String(row.bookingId));
    if(matches.length!==1){blockers.push({code:"booking_payment_count",bookingId:String(row.bookingId),expected:1,actual:matches.length});continue;}
    const p=matches[0];
    if(p.status!=="paid")blockers.push({code:"payment_status",bookingId:String(row.bookingId),expected:"paid",actual:p.status});
    if(money(p.amount)!==row.gross)blockers.push({code:"payment_amount",bookingId:String(row.bookingId),expected:row.gross,actual:money(p.amount)});
    if(money(p.refundedAmount)!==0)blockers.push({code:"payment_refund",bookingId:String(row.bookingId),expected:0,actual:money(p.refundedAmount)});
  }
  const paymentIds=payments.map(p=>p._id);
  const settlementQuery={$or:[{bookingIds:{$in:bookingIds}},{paymentIds:{$in:paymentIds}}]};
  const settlements=(bookingIds.length||paymentIds.length)?await withSession(ProviderSettlement.find(settlementQuery).select("_id status paymentIds bookingIds amountPaid paidAt"),session):[];
  if(settlements.length)blockers.push({code:"settlement_exists",actual:settlements.length});

  return {
    ok:blockers.length===0,
    blockers,
    alreadyCorrect,
    provider:{businessName:provider.businessName,status:provider.status},
    trip:{titleEn:trip.titleEn,commissionType:trip.pricing?.commissionType||null,commissionValue:Number(trip.pricing?.commissionValue||0)},
    totals:{...totals,commissionDelta:money(totals.correctCommission-totals.currentCommission),providerNetDelta:money(totals.correctProviderNet-totals.currentProviderNet),payments:payments.length,settlements:settlements.length},
    rows:rows.map(r=>({bookingRef:String(r.bookingId).slice(-8).toUpperCase(),seats:r.seats,gross:r.gross,currentCommission:r.currentCommission,correctCommission:r.correctCommission,currentProviderNet:r.currentProviderNet,correctProviderNet:r.correctProviderNet})),
    _rows:rows
  };
}

function publicReport(report){const {_rows,...safe}=report;return safe;}
export async function previewPilotRepairStage2b({session=null}={}){return publicReport(await inspect({session}));}

export async function applyPilotRepairStage2b(){
  const session=await mongoose.startSession();
  let changed=0;
  let before;
  try{
    await session.withTransaction(async()=>{
      const inspected=await inspect({session});
      before=publicReport(inspected);
      if(!inspected.ok){const e=new Error("Stage 2B preconditions failed");e.statusCode=409;e.details=inspected.blockers;throw e;}
      if(inspected.alreadyCorrect)return;
      if(inspected.totals.commissionDelta!==30||inspected.totals.providerNetDelta!==-30){const e=new Error("Stage 2B delta mismatch");e.statusCode=409;throw e;}
      for(const row of inspected._rows){
        row.booking.set("pricing.commissionAmount",row.correctCommission);
        row.booking.set("pricing.providerNetAmount",row.correctProviderNet);
        await row.booking.save({session});
        changed+=1;
      }
    });
    const after=await previewPilotRepairStage2b();
    if(!after.ok||!after.alreadyCorrect||after.totals.correctCommission!==30||after.totals.currentCommission!==30){throw new Error("Stage 2B postcondition failed");}
    return {planId:STAGE2B_PLAN_ID,applied:changed>0,changedBookings:changed,before,after};
  }finally{await session.endSession();}
}
