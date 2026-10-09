import mongoose from "mongoose";
import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import ProviderSettlement from "../models/ProviderSettlement.js";
import { STAGE2B_PLAN_ID, STAGE2B_TARGET_TRIP, previewPilotFinancialStage2b } from "./pilotFinancialStage2b.js";

const FUN_N_SUN_PROVIDER_RE=/fun\s*(?:n|&|and)\s*sun/i;

function money(value){return Number(Number(value||0).toFixed(2));}
function fail(message,details=[]){
  const error=new Error(message);
  error.statusCode=409;
  error.details=details;
  throw error;
}

async function loadExactTarget(session){
  const providers=await Provider.find({businessName:FUN_N_SUN_PROVIDER_RE}).select("_id businessName status").session(session).lean();
  if(providers.length!==1)fail("Stage 2B revision restore provider precondition failed",[{code:"provider_count",expected:1,actual:providers.length}]);
  const provider=providers[0];
  const trips=await Trip.find({providerId:provider._id,titleEn:STAGE2B_TARGET_TRIP}).select("_id titleEn pricing active").session(session).lean();
  if(trips.length!==1)fail("Stage 2B revision restore trip precondition failed",[{code:"trip_count",expected:1,actual:trips.length}]);
  const trip=trips[0];
  if(trip.pricing?.commissionType!=="fixed_per_person"||Number(trip.pricing?.commissionValue)!==5){
    fail("Stage 2B revision restore commission precondition failed",[{code:"trip_commission_configuration"}]);
  }

  const bookings=await Booking.find({tripId:trip._id,status:"confirmed"})
    .select("_id status seats pricing")
    .sort({createdAt:1})
    .session(session)
    .lean();
  if(bookings.length!==2)fail("Stage 2B revision restore booking count failed",[{code:"booking_count",expected:2,actual:bookings.length}]);

  let seats=0,gross=0,commission=0,providerNet=0;
  for(const booking of bookings){
    const bookingGross=money(booking.pricing?.grossAmount);
    const expectedCommission=money(Math.min(bookingGross,Number(booking.seats||0)*5));
    const expectedProviderNet=money(bookingGross-expectedCommission);
    if(money(booking.pricing?.commissionAmount)!==expectedCommission||money(booking.pricing?.providerNetAmount)!==expectedProviderNet){
      fail("Stage 2B revision restore requires already-correct booking snapshots",[{code:"booking_snapshot_not_correct",bookingId:String(booking._id)}]);
    }
    seats+=Number(booking.seats||0);
    gross+=bookingGross;
    commission+=expectedCommission;
    providerNet+=expectedProviderNet;
  }
  if(seats!==6||money(gross)!==137||money(commission)!==30||money(providerNet)!==107){
    fail("Stage 2B revision restore historical totals mismatch",[{code:"historical_totals_mismatch",expected:{seats:6,grossAmount:137,commissionAmount:30,providerNetAmount:107},actual:{seats,grossAmount:money(gross),commissionAmount:money(commission),providerNetAmount:money(providerNet)}}]);
  }

  const bookingIds=bookings.map(b=>b._id);
  const payments=await Payment.find({bookingId:{$in:bookingIds}})
    .select("_id bookingId status amount currency refundedAmount paidAt settlementRevision updatedAt")
    .sort({createdAt:1})
    .session(session)
    .lean();
  if(payments.length!==2)fail("Stage 2B revision restore payment count failed",[{code:"payment_count",expected:2,actual:payments.length}]);
  const bookingById=new Map(bookings.map(b=>[String(b._id),b]));
  for(const payment of payments){
    const booking=bookingById.get(String(payment.bookingId));
    if(!booking||payment.status!=="paid"||!payment.paidAt||money(payment.refundedAmount)!==0||money(payment.amount)!==money(booking.pricing?.grossAmount)||String(payment.currency||"JOD")!==String(booking.pricing?.currency||"JOD")){
      fail("Stage 2B revision restore payment precondition failed",[{code:"payment_state_conflict",paymentId:String(payment._id)}]);
    }
  }

  const paymentIds=payments.map(p=>p._id);
  const settlements=await ProviderSettlement.find({$or:[{paymentIds:{$in:paymentIds}},{bookingIds:{$in:bookingIds}}]}).select("_id status").session(session).lean();
  if(settlements.length)fail("Stage 2B revision restore blocked by settlement",[{code:"existing_settlement",actual:settlements.length}]);

  return {provider,trip,bookings,payments,bookingIds,paymentIds};
}

export async function restorePilotFinancialStage2bPaymentRevisions(){
  const session=await mongoose.startSession();
  const before=await previewPilotFinancialStage2b();
  let restoredPayments=0;
  let alreadyRestored=false;
  try{
    await session.withTransaction(async()=>{
      const target=await loadExactTarget(session);
      const revisions=target.payments.map(p=>Number(p.settlementRevision||0));
      if(revisions.every(value=>value===0)){
        alreadyRestored=true;
        return;
      }
      if(!revisions.every(value=>value===1)){
        fail("Stage 2B revision restore encountered unexpected revisions",[{code:"settlement_revision_conflict",expected:[1,1],actual:revisions}]);
      }

      // Native collection update intentionally avoids Mongoose timestamps. This
      // writes the same rows used by settlement serialization, so a concurrent
      // settlement transaction conflicts rather than silently racing this repair.
      const result=await Payment.collection.updateMany(
        {_id:{$in:target.paymentIds},settlementRevision:1},
        {$set:{settlementRevision:0}},
        {session}
      );
      restoredPayments=Number(result.modifiedCount||0);
      if(Number(result.matchedCount||0)!==2||restoredPayments!==2){
        fail("Stage 2B revision restore exact payment precondition failed",[{code:"payment_revision_update_count",matched:Number(result.matchedCount||0),modified:restoredPayments}]);
      }

      const settlements=await ProviderSettlement.find({$or:[{paymentIds:{$in:target.paymentIds}},{bookingIds:{$in:target.bookingIds}}]}).select("_id").session(session).lean();
      if(settlements.length)fail("Stage 2B revision restore blocked by settlement",[{code:"existing_settlement_after_lock",actual:settlements.length}]);

      const revisionsAfter=await Payment.collection.find({_id:{$in:target.paymentIds}},{session,projection:{settlementRevision:1}}).toArray();
      if(revisionsAfter.length!==2||revisionsAfter.some(p=>Number(p.settlementRevision||0)!==0)){
        fail("Stage 2B revision restore postcondition failed",[{code:"revision_postcondition"}]);
      }
    });

    const after=await previewPilotFinancialStage2b();
    if(!after.ok||!after.alreadyCorrect||after.totals.currentCommission!==30||after.totals.currentProviderNet!==107||after.rows.some(row=>Number(row.settlementRevision||0)!==0)||after.settlementRecords.length!==0){
      fail("Stage 2B revision restore final verification failed",[{code:"final_postcondition"}]);
    }
    return {
      planId:STAGE2B_PLAN_ID,
      applied:restoredPayments===2,
      alreadyRestored,
      restoredPayments,
      before,
      after
    };
  }finally{
    await session.endSession();
  }
}
