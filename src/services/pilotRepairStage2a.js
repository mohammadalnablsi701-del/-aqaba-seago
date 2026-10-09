import mongoose from "mongoose";
import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";

export const STAGE2A_PLAN_ID="2026-10-09-pilot-business-data-stage2a-v1";

const FUN_N_SUN_PROVIDER_RE=/fun\s*(?:n|&|and)\s*sun/i;
const ALADDIN_PROVIDER_RE=/(aladdin|alaa\s*aldeen|علاء\s*الدين)/i;

export const FUN_N_SUN_COMMISSION_PLAN={
  "White Prince Swimming Cruise":{
    commissionType:"fixed_per_person",
    commissionValue:3,
    adultCommission:3,
    childCommission:2,
    buffetAdultCommission:5,
    buffetChildCommission:3
  },
  "White Prince Evening Cruise":{
    commissionType:"fixed_per_person",
    commissionValue:5
  },
  "Coral Whisper + White Prince Experience":{
    commissionType:"fixed_per_person",
    commissionValue:5
  }
};

const TIER_KEYS=["adultCommission","childCommission","buffetAdultCommission","buffetChildCommission"];

function withSession(query,session){return session?query.session(session):query;}
function roundMoney(value){return Math.round((Number(value||0)+Number.EPSILON)*100)/100;}
function valueOrNull(value){return value===undefined||value===null?null:Number(value);}

export function resolveFunNSunPlan(titleEn){
  return FUN_N_SUN_COMMISSION_PLAN[String(titleEn||"").trim()]||null;
}

export function isExpectedFunNSunCommission(pricing={},plan={}){
  if(pricing.commissionType!==plan.commissionType)return false;
  if(Number(pricing.commissionValue)!==Number(plan.commissionValue))return false;
  for(const key of TIER_KEYS){
    const actual=valueOrNull(pricing[key]);
    const expected=valueOrNull(plan[key]);
    if(actual!==expected)return false;
  }
  return true;
}

export function isAllowedFunNSunPreRepairCommission(pricing={},plan={}){
  if(isExpectedFunNSunCommission(pricing,plan))return true;
  return pricing.commissionType==="percentage"&&Number(pricing.commissionValue)===20;
}

export function expectedFunNSunCommissionForBooking({titleEn,booking}){
  const plan=resolveFunNSunPlan(titleEn);
  if(!plan)throw new Error(`No approved commission plan for ${titleEn}`);
  const adults=Number(booking?.adults||0);
  const children=Number(booking?.children||0);
  const seats=Number(booking?.seats||adults+children);
  const gross=Number(booking?.pricing?.grossAmount||0);
  let amount;
  if(titleEn==="White Prince Swimming Cruise"){
    const buffet=booking?.mealPlan==="with_buffet";
    const adultCommission=buffet?plan.buffetAdultCommission:plan.adultCommission;
    const childCommission=buffet?plan.buffetChildCommission:plan.childCommission;
    amount=adultCommission*adults+childCommission*children;
  }else{
    amount=plan.commissionValue*seats;
  }
  return roundMoney(Math.min(gross,amount));
}

function summarizeFunTrip({trip,bookings}){
  const plan=resolveFunNSunPlan(trip.titleEn);
  const recorded=bookings.reduce((sum,b)=>sum+Number(b.pricing?.commissionAmount||0),0);
  const expected=bookings.reduce((sum,b)=>sum+expectedFunNSunCommissionForBooking({titleEn:trip.titleEn,booking:b}),0);
  return {
    titleEn:trip.titleEn,
    currentCommission:{
      type:trip.pricing?.commissionType||null,
      value:valueOrNull(trip.pricing?.commissionValue),
      adult:valueOrNull(trip.pricing?.adultCommission),
      child:valueOrNull(trip.pricing?.childCommission),
      buffetAdult:valueOrNull(trip.pricing?.buffetAdultCommission),
      buffetChild:valueOrNull(trip.pricing?.buffetChildCommission)
    },
    expectedCommission:plan,
    configurationMatches:isExpectedFunNSunCommission(trip.pricing,plan),
    confirmedBookings:bookings.length,
    confirmedSeats:bookings.reduce((sum,b)=>sum+Number(b.seats||0),0),
    confirmedGross:roundMoney(bookings.reduce((sum,b)=>sum+Number(b.pricing?.grossAmount||0),0)),
    recordedCommission:roundMoney(recorded),
    expectedCommissionForHistoricalBookings:roundMoney(expected),
    historicalCommissionDelta:roundMoney(expected-recorded)
  };
}

function safeProvider(provider){
  return provider?{businessName:String(provider.businessName||""),status:String(provider.status||"")}:null;
}

function aladdinTripSetIsExpected(trips){
  if(trips.length!==2)return false;
  const titles=trips.map(t=>String(t.titleEn||"").trim().toLowerCase());
  return titles.some(t=>t.includes("aladdin 8"))&&titles.some(t=>t.includes("sukar"));
}

export async function previewPilotRepairStage2a({session=null,now=new Date()}={}){
  const blockers=[];
  const funProviders=await withSession(Provider.find({businessName:FUN_N_SUN_PROVIDER_RE}),session);
  const aladdinProviders=await withSession(Provider.find({businessName:ALADDIN_PROVIDER_RE}),session);
  if(funProviders.length!==1)blockers.push({code:"fun_provider_count",expected:1,actual:funProviders.length});
  if(aladdinProviders.length!==1)blockers.push({code:"aladdin_provider_count",expected:1,actual:aladdinProviders.length});

  const funProvider=funProviders.length===1?funProviders[0]:null;
  const aladdinProvider=aladdinProviders.length===1?aladdinProviders[0]:null;
  const funTrips=funProvider?await withSession(Trip.find({providerId:funProvider._id}).sort({createdAt:1}),session):[];
  const aladdinTrips=aladdinProvider?await withSession(Trip.find({providerId:aladdinProvider._id}).sort({createdAt:1}),session):[];

  const funTitles=funTrips.map(t=>String(t.titleEn||"").trim());
  const expectedFunTitles=Object.keys(FUN_N_SUN_COMMISSION_PLAN);
  if(funTrips.length!==expectedFunTitles.length||expectedFunTitles.some(title=>funTitles.filter(x=>x===title).length!==1)){
    blockers.push({code:"fun_trip_set",expected:expectedFunTitles,actual:funTitles});
  }
  for(const trip of funTrips){
    const plan=resolveFunNSunPlan(trip.titleEn);
    if(!plan){blockers.push({code:"unexpected_fun_trip",titleEn:String(trip.titleEn||"")});continue;}
    if(!isAllowedFunNSunPreRepairCommission(trip.pricing,plan)){
      blockers.push({code:"fun_commission_conflict",titleEn:trip.titleEn,currentType:trip.pricing?.commissionType||null,currentValue:valueOrNull(trip.pricing?.commissionValue)});
    }
  }

  if(aladdinProvider&&!["approved","suspended"].includes(String(aladdinProvider.status||""))){
    blockers.push({code:"aladdin_status_conflict",actual:String(aladdinProvider.status||"")});
  }
  if(aladdinProvider&&!aladdinTripSetIsExpected(aladdinTrips)){
    blockers.push({code:"aladdin_trip_set",expected:["Aladdin 8","Sukar"],actual:aladdinTrips.map(t=>String(t.titleEn||""))});
  }

  const funSummaries=[];
  for(const trip of funTrips){
    const plan=resolveFunNSunPlan(trip.titleEn);
    if(!plan)continue;
    const bookings=await withSession(Booking.find({tripId:trip._id,status:"confirmed"}).select("seats adults children mealPlan pricing"),session);
    funSummaries.push(summarizeFunTrip({trip,bookings}));
  }

  const aladdinTripIds=aladdinTrips.map(t=>t._id);
  const futureDepartures=aladdinTripIds.length?await withSession(Departure.find({tripId:{$in:aladdinTripIds},status:"scheduled",startsAt:{$gte:now}}).select("tripId startsAt capacity reservedSeats salesClosed status"),session):[];
  const aladdinBookings=aladdinTripIds.length?await withSession(Booking.find({tripId:{$in:aladdinTripIds},status:"confirmed"}).select("_id seats pricing"),session):[];
  const bookingIds=aladdinBookings.map(b=>b._id);
  const paidPayments=bookingIds.length?await withSession(Payment.find({bookingId:{$in:bookingIds},status:"paid"}).select("amount currency status"),session):[];

  const funNeedsChange=funSummaries.some(x=>!x.configurationMatches);
  const aladdinNeedsChange=Boolean(aladdinProvider)&&(
    aladdinProvider.status!=="suspended"||
    aladdinTrips.some(t=>t.active!==false)||
    futureDepartures.some(d=>d.salesClosed!==true)
  );

  return {
    planId:STAGE2A_PLAN_ID,
    ok:blockers.length===0,
    blockers,
    changesRequired:funNeedsChange||aladdinNeedsChange,
    funNSun:{
      provider:safeProvider(funProvider),
      tripCount:funTrips.length,
      trips:funSummaries
    },
    aladdin:{
      provider:safeProvider(aladdinProvider),
      tripCount:aladdinTrips.length,
      trips:aladdinTrips.map(t=>({titleEn:String(t.titleEn||""),active:Boolean(t.active),commissionType:t.pricing?.commissionType||null,commissionValue:valueOrNull(t.pricing?.commissionValue)})),
      futureScheduledDepartures:futureDepartures.length,
      openFutureDepartures:futureDepartures.filter(d=>d.salesClosed!==true).length,
      reservedSeats:futureDepartures.reduce((sum,d)=>sum+Number(d.reservedSeats||0),0),
      confirmedBookings:aladdinBookings.length,
      confirmedSeats:aladdinBookings.reduce((sum,b)=>sum+Number(b.seats||0),0),
      confirmedGross:roundMoney(aladdinBookings.reduce((sum,b)=>sum+Number(b.pricing?.grossAmount||0),0)),
      recordedCommission:roundMoney(aladdinBookings.reduce((sum,b)=>sum+Number(b.pricing?.commissionAmount||0),0)),
      paidPayments:paidPayments.length,
      paidAmount:roundMoney(paidPayments.reduce((sum,p)=>sum+Number(p.amount||0),0))
    }
  };
}

function applyCommissionPlan(trip,plan){
  trip.set("pricing.commissionType",plan.commissionType);
  trip.set("pricing.commissionValue",plan.commissionValue);
  for(const key of TIER_KEYS){
    trip.set(`pricing.${key}`,plan[key]===undefined?undefined:plan[key]);
  }
}

export async function applyPilotRepairStage2a(){
  const session=await mongoose.startSession();
  const now=new Date();
  let before;
  const changed={funTrips:0,aladdinProvider:0,aladdinTrips:0,aladdinDepartures:0};
  try{
    await session.withTransaction(async()=>{
      before=await previewPilotRepairStage2a({session,now});
      if(!before.ok){
        const error=new Error("Pilot Stage 2A preconditions failed");
        error.statusCode=409;
        error.details=before.blockers;
        throw error;
      }
      if(!before.changesRequired)return;

      const [funProvider]=await Provider.find({businessName:FUN_N_SUN_PROVIDER_RE}).session(session);
      const funTrips=await Trip.find({providerId:funProvider._id}).session(session);
      for(const trip of funTrips){
        const plan=resolveFunNSunPlan(trip.titleEn);
        if(!plan)throw new Error(`Unexpected Fun N Sun trip ${trip.titleEn}`);
        if(!isExpectedFunNSunCommission(trip.pricing,plan)){
          applyCommissionPlan(trip,plan);
          await trip.save({session});
          changed.funTrips+=1;
        }
      }

      const [aladdinProvider]=await Provider.find({businessName:ALADDIN_PROVIDER_RE}).session(session);
      const aladdinTrips=await Trip.find({providerId:aladdinProvider._id}).session(session);
      if(aladdinProvider.status!=="suspended"){
        aladdinProvider.status="suspended";
        aladdinProvider.approvedAt=undefined;
        aladdinProvider.approvedBy=undefined;
        await aladdinProvider.save({session});
        changed.aladdinProvider=1;
      }
      for(const trip of aladdinTrips){
        if(trip.active!==false){
          trip.active=false;
          await trip.save({session});
          changed.aladdinTrips+=1;
        }
      }
      const aladdinTripIds=aladdinTrips.map(t=>t._id);
      if(aladdinTripIds.length){
        const result=await Departure.updateMany(
          {tripId:{$in:aladdinTripIds},status:"scheduled",startsAt:{$gte:now},salesClosed:{$ne:true}},
          {$set:{salesClosed:true}},
          {session}
        );
        changed.aladdinDepartures=Number(result.modifiedCount||0);
      }
    });
    const after=await previewPilotRepairStage2a({now});
    return {
      planId:STAGE2A_PLAN_ID,
      applied:Boolean(changed.funTrips||changed.aladdinProvider||changed.aladdinTrips||changed.aladdinDepartures),
      changed,
      before,
      after
    };
  }finally{
    await session.endSession();
  }
}
