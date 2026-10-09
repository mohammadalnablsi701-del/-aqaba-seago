import mongoose from "mongoose";
import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import ProviderSettlement from "../models/ProviderSettlement.js";

export const STAGE2B_PLAN_ID="2026-10-09-fun-n-sun-historical-commission-stage2b-v1";
export const STAGE2B_TRIP_TITLE="Coral Whisper + White Prince Experience";
const FUN_N_SUN_PROVIDER_RE=/fun\s*(?:n|&|and)\s*sun/i;
const PAYMENT_STATUSES=["paid","partially_refunded","refunded","needs_review"];

function money(value){return Number(Number(value||0).toFixed(2));}
function shortId(value){const text=String(value||"");return text?text.slice(-8).toUpperCase():null;}
function withSession(query,session){return session?query.session(session):query;}

export function expectedCommissionForBooking(booking={}){
  return money(Math.min(Number(booking?.pricing?.grossAmount||0),Number(booking?.seats||0)*5));
}

function blockersForBooking(booking){
  const blockers=[];
  const gross=money(booking?.pricing?.grossAmount);
  const commission=money(booking?.pricing?.commissionAmount);
  const providerNet=money(booking?.pricing?.providerNetAmount);
  if(commission!==0)blockers.push({code:"booking_commission_changed",bookingRef:shortId(booking?._id),actual:commission,expected:0});
  if(providerNet!==gross)blockers.push({code:"booking_provider_net_changed",bookingRef:shortId(booking?._id),actual:providerNet,expected:gross});
  return blockers;
}

export async function previewPilotRepairStage2b({session=null}={}){
  const blockers=[];
  const providers=await withSession(Provider.find({businessName:FUN_N_SUN_PROVIDER_RE}).select("_id businessName status"),session);
  if(providers.length!==1)blockers.push({code:"fun_provider_count",expected:1,actual:providers.length});
  const provider=providers.length===1?providers[0]:null;

  const trips=provider?await withSession(Trip.find({providerId:provider._id,titleEn:STAGE2B_TRIP_TITLE}).select("_id titleEn active pricing"),session):[];
  if(trips.length!==1)blockers.push({code:"target_trip_count",expected:1,actual:trips.length});
  const trip=trips.length===1?trips[0]:null;
  if(trip&&(trip.pricing?.commissionType!=="fixed_per_person"||Number(trip.pricing?.commissionValue)!==5)){
    blockers.push({code:"trip_commission_not_approved",actualType:trip.pricing?.commissionType||null,actualValue:Number(trip.pricing?.commissionValue||0)});
  }

  const bookings=trip?await withSession(Booking.find({tripId:trip._id,status:"confirmed"}).select("_id status seats adults children mealPlan pricing departureId checkedInAt createdAt").sort({createdAt:1}),session):[];
  if(bookings.length!==2)blockers.push({code:"confirmed_booking_count",expected:2,actual:bookings.length});
  for(const booking of bookings)blockers.push(...blockersForBooking(booking));

  const totals={
    bookings:bookings.length,
    seats:bookings.reduce((sum,b)=>sum+Number(b.seats||0),0),
    gross:money(bookings.reduce((sum,b)=>sum+Number(b.pricing?.grossAmount||0),0)),
    currentCommission:money(bookings.reduce((sum,b)=>sum+Number(b.pricing?.commissionAmount||0),0)),
    currentProviderNet:money(bookings.reduce((sum,b)=>sum+Number(b.pricing?.providerNetAmount||0),0)),
    expectedCommission:money(bookings.reduce((sum,b)=>sum+expectedCommissionForBooking(b),0))
  };
  totals.expectedProviderNet=money(totals.gross-totals.expectedCommission);
  totals.commissionDelta=money(totals.expectedCommission-totals.currentCommission);
  totals.providerNetDelta=money(totals.expectedProviderNet-totals.currentProviderNet);

  if(totals.seats!==6)blockers.push({code:"confirmed_seat_total",expected:6,actual:totals.seats});
  if(totals.gross!==137)blockers.push({code:"confirmed_gross_total",expected:137,actual:totals.gross});
  if(totals.currentCommission!==0)blockers.push({code:"recorded_commission_total",expected:0,actual:totals.currentCommission});
  if(totals.currentProviderNet!==137)blockers.push({code:"recorded_provider_net_total",expected:137,actual:totals.currentProviderNet});
  if(totals.expectedCommission!==30)blockers.push({code:"expected_commission_total",expected:30,actual:totals.expectedCommission});
  if(totals.expectedProviderNet!==107)blockers.push({code:"expected_provider_net_total",expected:107,actual:totals.expectedProviderNet});

  const bookingIds=bookings.map(b=>b._id);
  const payments=bookingIds.length?await withSession(Payment.find({bookingId:{$in:bookingIds},status:{$in:PAYMENT_STATUSES},paidAt:{$ne:null}}).select("_id bookingId status amount currency refundedAmount paidAt settlementRevision"),session):[];
  if(payments.length!==bookings.length)blockers.push({code:"paid_payment_count",expected:bookings.length,actual:payments.length});
  const paymentByBooking=new Map(payments.map(p=>[String(p.bookingId),p]));
  for(const booking of bookings){
    const payment=paymentByBooking.get(String(booking._id));
    if(!payment){blockers.push({code:"missing_paid_payment",bookingRef:shortId(booking._id)});continue;}
    if(money(payment.amount)!==money(booking.pricing?.grossAmount)){
      blockers.push({code:"payment_gross_mismatch",bookingRef:shortId(booking._id),paymentAmount:money(payment.amount),bookingGross:money(booking.pricing?.grossAmount)});
    }
    if(money(payment.refundedAmount)!==0)blockers.push({code:"refund_present",paymentRef:shortId(payment._id),refundedAmount:money(payment.refundedAmount)});
  }

  const paymentIds=payments.map(p=>p._id);
  const settlements=(paymentIds.length||bookingIds.length)?await withSession(ProviderSettlement.find({$or:[{paymentIds:{$in:paymentIds}},{bookingIds:{$in:bookingIds}}]}).select("_id status paymentIds bookingIds amountPaid paidAt"),session):[];
  if(settlements.length)blockers.push({code:"affected_booking_already_in_settlement",settlementCount:settlements.length,settlementRefs:settlements.map(s=>shortId(s._id))});

  return {
    planId:STAGE2B_PLAN_ID,
    ok:blockers.length===0,
    blockers,
    provider:provider?{businessName:provider.businessName,status:provider.status}:null,
    trip:trip?{titleEn:trip.titleEn,active:Boolean(trip.active),commissionType:trip.pricing?.commissionType||null,commissionValue:Number(trip.pricing?.commissionValue||0)}:null,
    totals,
    rows:bookings.map(booking=>{
      const gross=money(booking.pricing?.grossAmount);
      const expectedCommission=expectedCommissionForBooking(booking);
      const payment=paymentByBooking.get(String(booking._id));
      return {
        bookingRef:shortId(booking._id),
        seats:Number(booking.seats||0),
        gross,
        currentCommission:money(booking.pricing?.commissionAmount),
        correctedCommission:expectedCommission,
        currentProviderNet:money(booking.pricing?.providerNetAmount),
        correctedProviderNet:money(gross-expectedCommission),
        paymentRef:payment?shortId(payment._id):null,
        paymentStatus:payment?.status||null,
        paymentAmount:payment?money(payment.amount):null,
        checkedIn:Boolean(booking.checkedInAt)
      };
    }),
    affectedSettlements:settlements.length
  };
}

export async function applyPilotRepairStage2b(){
  const session=await mongoose.startSession();
  let before;
  let modifiedBookings=0;
  try{
    await session.withTransaction(async()=>{
      before=await previewPilotRepairStage2b({session});
      if(!before.ok){
        const error=new Error("Pilot Stage 2B preconditions failed");
        error.statusCode=409;
        error.details=before.blockers;
        throw error;
      }

      const [provider]=await Provider.find({businessName:FUN_N_SUN_PROVIDER_RE}).session(session);
      const [trip]=await Trip.find({providerId:provider._id,titleEn:STAGE2B_TRIP_TITLE}).session(session);
      const bookings=await Booking.find({tripId:trip._id,status:"confirmed"}).sort({createdAt:1}).session(session);

      for(const booking of bookings){
        const gross=money(booking.pricing?.grossAmount);
        const commission=expectedCommissionForBooking(booking);
        const providerNet=money(gross-commission);
        const result=await Booking.updateOne(
          {_id:booking._id,status:"confirmed","pricing.grossAmount":booking.pricing?.grossAmount,"pricing.commissionAmount":0,"pricing.providerNetAmount":booking.pricing?.grossAmount},
          {$set:{"pricing.commissionAmount":commission,"pricing.providerNetAmount":providerNet}},
          {session}
        );
        if(Number(result.modifiedCount)!==1){
          const error=new Error("Booking changed during Stage 2B repair");
          error.statusCode=409;
          throw error;
        }
        modifiedBookings+=1;
      }
    });

    const after=await previewPostRepairStage2b();
    return {planId:STAGE2B_PLAN_ID,applied:true,modifiedBookings,before,after};
  }finally{
    await session.endSession();
  }
}

export async function previewPostRepairStage2b(){
  const providers=await Provider.find({businessName:FUN_N_SUN_PROVIDER_RE}).select("_id businessName status");
  if(providers.length!==1)return {ok:false,reason:"fun_provider_count",actual:providers.length};
  const trips=await Trip.find({providerId:providers[0]._id,titleEn:STAGE2B_TRIP_TITLE}).select("_id titleEn pricing active");
  if(trips.length!==1)return {ok:false,reason:"target_trip_count",actual:trips.length};
  const bookings=await Booking.find({tripId:trips[0]._id,status:"confirmed"}).select("_id seats pricing checkedInAt").sort({createdAt:1});
  const bookingIds=bookings.map(b=>b._id);
  const payments=await Payment.find({bookingId:{$in:bookingIds},status:{$in:PAYMENT_STATUSES},paidAt:{$ne:null}}).select("_id bookingId status amount refundedAmount");
  const paymentIds=payments.map(p=>p._id);
  const settlements=await ProviderSettlement.find({$or:[{paymentIds:{$in:paymentIds}},{bookingIds:{$in:bookingIds}}]}).select("_id status");
  const totals={
    bookings:bookings.length,
    seats:bookings.reduce((sum,b)=>sum+Number(b.seats||0),0),
    gross:money(bookings.reduce((sum,b)=>sum+Number(b.pricing?.grossAmount||0),0)),
    commission:money(bookings.reduce((sum,b)=>sum+Number(b.pricing?.commissionAmount||0),0)),
    providerNet:money(bookings.reduce((sum,b)=>sum+Number(b.pricing?.providerNetAmount||0),0)),
    payments:payments.length,
    paymentAmount:money(payments.reduce((sum,p)=>sum+Number(p.amount||0),0)),
    refundedAmount:money(payments.reduce((sum,p)=>sum+Number(p.refundedAmount||0),0)),
    settlementRecords:settlements.length
  };
  return {
    ok:bookings.length===2&&totals.seats===6&&totals.gross===137&&totals.commission===30&&totals.providerNet===107&&payments.length===2&&totals.paymentAmount===137&&totals.refundedAmount===0&&settlements.length===0,
    totals,
    rows:bookings.map(b=>({bookingRef:shortId(b._id),seats:Number(b.seats||0),gross:money(b.pricing?.grossAmount),commission:money(b.pricing?.commissionAmount),providerNet:money(b.pricing?.providerNetAmount),checkedIn:Boolean(b.checkedInAt)}))
  };
}
