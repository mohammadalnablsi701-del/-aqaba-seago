import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import ProviderSettlement from "../models/ProviderSettlement.js";

export const STAGE2B_TARGET_TRIP="Coral Whisper + White Prince Experience";
const FUN_N_SUN_PROVIDER_RE=/fun\s*(?:n|&|and)\s*sun/i;
const SETTLEMENT_PAYMENT_STATUSES=["paid","partially_refunded","refunded","needs_review"];

function money(value){return Number(Number(value||0).toFixed(2));}
function shortId(value){const s=String(value||"");return s?s.slice(-8).toUpperCase():null;}

export function expectedCoralCommission({seats=0,grossAmount=0}={}){
  return money(Math.min(Number(grossAmount||0),Number(seats||0)*5));
}

export function expectedCoralProviderNet({seats=0,grossAmount=0}={}){
  return money(Number(grossAmount||0)-expectedCoralCommission({seats,grossAmount}));
}

function settlementItemForPayment(settlement,paymentId){
  const id=String(paymentId);
  return (settlement.items||[]).find(item=>String(item.paymentId)===id)||null;
}

export async function buildStage2bReconciliationReport(){
  const providers=await Provider.find({businessName:FUN_N_SUN_PROVIDER_RE}).select("_id businessName status").lean();
  if(providers.length!==1){
    return {ok:false,reason:"fun_n_sun_provider_count",expected:1,actual:providers.length};
  }

  const provider=providers[0];
  const trips=await Trip.find({providerId:provider._id,titleEn:STAGE2B_TARGET_TRIP}).select("_id titleEn pricing active").lean();
  if(trips.length!==1){
    return {ok:false,reason:"target_trip_count",expected:1,actual:trips.length};
  }

  const trip=trips[0];
  const bookings=await Booking.find({tripId:trip._id,status:"confirmed"})
    .select("_id status seats adults children mealPlan pricing departureId checkedInAt createdAt")
    .sort({createdAt:1})
    .lean();
  const bookingIds=bookings.map(b=>b._id);
  const payments=bookingIds.length?await Payment.find({
    bookingId:{$in:bookingIds},
    status:{$in:SETTLEMENT_PAYMENT_STATUSES},
    paidAt:{$ne:null}
  }).select("_id bookingId status amount currency refundedAmount paidAt settlementRevision").sort({paidAt:1}).lean():[];
  const paymentIds=payments.map(p=>p._id);
  const settlements=paymentIds.length?await ProviderSettlement.find({paymentIds:{$in:paymentIds},status:"paid"})
    .select("_id providerId paymentIds bookingIds items periodFrom periodTo grossSales refunds seaGoCommission providerNet amountPaid paidAt")
    .sort({paidAt:1})
    .lean():[];

  const paymentByBooking=new Map();
  for(const payment of payments){
    const key=String(payment.bookingId);
    if(!paymentByBooking.has(key))paymentByBooking.set(key,[]);
    paymentByBooking.get(key).push(payment);
  }

  const rows=bookings.map(booking=>{
    const gross=money(booking.pricing?.grossAmount);
    const recordedCommission=money(booking.pricing?.commissionAmount);
    const expectedCommission=expectedCoralCommission({seats:booking.seats,grossAmount:gross});
    const recordedProviderNet=money(booking.pricing?.providerNetAmount);
    const expectedProviderNet=expectedCoralProviderNet({seats:booking.seats,grossAmount:gross});
    const bookingPayments=(paymentByBooking.get(String(booking._id))||[]).map(payment=>{
      const containingSettlements=settlements.filter(s=>(s.paymentIds||[]).some(id=>String(id)===String(payment._id)));
      return {
        paymentRef:shortId(payment._id),
        status:payment.status,
        amount:money(payment.amount),
        refundedAmount:money(payment.refundedAmount),
        paidAt:payment.paidAt||null,
        settlementRevision:Number(payment.settlementRevision||0),
        settlements:containingSettlements.map(s=>{
          const item=settlementItemForPayment(s,payment._id);
          return {
            settlementRef:shortId(s._id),
            paidAt:s.paidAt||null,
            periodFrom:s.periodFrom||null,
            periodTo:s.periodTo||null,
            hasPerPaymentItem:Boolean(item),
            paymentAmountPaid:item?money(item.amountPaid):null,
            paymentSeaGoCommission:item?money(item.seaGoCommission):null,
            paymentProviderNet:item?money(item.providerNet):null,
            settlementAmountPaid:money(s.amountPaid),
            settlementSeaGoCommission:money(s.seaGoCommission),
            settlementProviderNet:money(s.providerNet)
          };
        })
      };
    });
    return {
      bookingRef:shortId(booking._id),
      departureRef:shortId(booking.departureId),
      seats:Number(booking.seats||0),
      checkedIn:Boolean(booking.checkedInAt),
      grossAmount:gross,
      recordedCommission,
      expectedCommission,
      commissionDelta:money(expectedCommission-recordedCommission),
      recordedProviderNet,
      expectedProviderNet,
      providerNetDelta:money(expectedProviderNet-recordedProviderNet),
      payments:bookingPayments
    };
  });

  const totals=rows.reduce((acc,row)=>{
    acc.bookings+=1;
    acc.seats+=row.seats;
    acc.grossAmount+=row.grossAmount;
    acc.recordedCommission+=row.recordedCommission;
    acc.expectedCommission+=row.expectedCommission;
    acc.commissionDelta+=row.commissionDelta;
    acc.recordedProviderNet+=row.recordedProviderNet;
    acc.expectedProviderNet+=row.expectedProviderNet;
    acc.providerNetDelta+=row.providerNetDelta;
    return acc;
  },{bookings:0,seats:0,grossAmount:0,recordedCommission:0,expectedCommission:0,commissionDelta:0,recordedProviderNet:0,expectedProviderNet:0,providerNetDelta:0});
  for(const key of ["grossAmount","recordedCommission","expectedCommission","commissionDelta","recordedProviderNet","expectedProviderNet","providerNetDelta"]){totals[key]=money(totals[key]);}

  const settledPaymentIds=new Set(settlements.flatMap(s=>(s.paymentIds||[]).map(String)));
  const relevantPayments=payments.length;
  const settledPayments=payments.filter(p=>settledPaymentIds.has(String(p._id))).length;

  return {
    ok:true,
    generatedAt:new Date().toISOString(),
    provider:{businessName:provider.businessName,status:provider.status},
    trip:{titleEn:trip.titleEn,active:Boolean(trip.active),commissionType:trip.pricing?.commissionType||null,commissionValue:Number(trip.pricing?.commissionValue||0)},
    totals:{...totals,relevantPayments,settledPayments,unsettledPayments:relevantPayments-settledPayments,settlementRecords:settlements.length},
    rows,
    decision:{
      historicalMutationRequired:money(totals.commissionDelta)!==0,
      anyAffectedPaymentAlreadySettled:settledPayments>0,
      safeForDirectSnapshotCorrection:settledPayments===0
    }
  };
}

export async function runStage2bReconciliationCapture(){
  if(process.env.STAGE2B_RECON_CAPTURE!=="true")return;
  const report=await buildStage2bReconciliationReport();
  console.log(`STAGE2B_RECONCILIATION ${JSON.stringify(report)}`);
}
