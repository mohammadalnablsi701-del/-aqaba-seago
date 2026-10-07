import {settlementLedger, recordSettlement} from "../services/settlements.js";
import express from "express";import mongoose from "mongoose";import Provider from "../models/Provider.js";import ProviderSettlement from "../models/ProviderSettlement.js";import User from "../models/User.js";import CheckoutHold from "../models/CheckoutHold.js";import Payment from "../models/Payment.js";import NotificationLog from "../models/NotificationLog.js";import Booking from "../models/Booking.js";import Departure from "../models/Departure.js";import Trip from "../models/Trip.js";import SupportRequest from "../models/SupportRequest.js";import{releaseExpiredCheckoutHolds,releaseCheckoutHoldsForDeparture}from"../services/payments.js";import{requireAuth,requireRole}from"../middleware/auth.js";const router=express.Router();router.use(requireAuth,requireRole("admin"));

function overviewDate(value,end=false){
  const s=String(value||"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
  const d=new Date(s+(end?"T23:59:59.999+03:00":"T00:00:00.000+03:00"));
  return Number.isNaN(d.getTime())?null:d;
}

router.get("/overview",async(req,res,next)=>{
  try{
    const from=overviewDate(req.query.from,false);
    const to=overviewDate(req.query.to,true);
    if(req.query.from&&!from)return res.status(400).json({error:"Invalid from date"});
    if(req.query.to&&!to)return res.status(400).json({error:"Invalid to date"});
    if(from&&to&&from>to)return res.status(400).json({error:"From date must be before to date"});

    const providerId=String(req.query.providerId||"").trim();
    if(providerId&&!/^[a-f0-9]{24}$/i.test(providerId))return res.status(400).json({error:"Invalid provider"});
    const match={
      status:{$in:["paid","partially_refunded","refunded"]},
      bookingId:{$ne:null},
      paidAt:{$ne:null}
    };
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
      {$addFields:{
        retainedAmount:{$max:[0,{$subtract:[{$ifNull:["$amount",0]},{$ifNull:["$refundedAmount",0]}]}]},
        originalAmount:{$ifNull:["$amount",0]}
      }},
      {$addFields:{
        retainedRatio:{$cond:[{$gt:["$originalAmount",0]},{$divide:["$retainedAmount","$originalAmount"]},0]}
      }},
      {$group:{
        _id:"$booking.providerId",
        providerName:{$first:{$ifNull:["$provider.businessName","Unknown provider"]}},
        bookings:{$sum:1},
        guests:{$sum:{$ifNull:["$booking.seats",0]}},
        grossSales:{$sum:"$originalAmount"},
        refunds:{$sum:{$ifNull:["$refundedAmount",0]}},
        netSales:{$sum:"$retainedAmount"},
        seaGoIncome:{$sum:{$multiply:[{$ifNull:["$booking.pricing.commissionAmount",0]},"$retainedRatio"]}},
        providerNet:{$sum:{$multiply:[{$ifNull:["$booking.pricing.providerNetAmount",0]},"$retainedRatio"]}}
      }},
      {$sort:{netSales:-1,providerName:1}}
    );

    const rows=await Payment.aggregate(pipeline);
    const providersList=await Provider.find({}).select("_id businessName status").sort({businessName:1}).lean();
    const totals=rows.reduce((a,r)=>{
      a.bookings+=Number(r.bookings||0);
      a.guests+=Number(r.guests||0);
      a.grossSales+=Number(r.grossSales||0);
      a.refunds+=Number(r.refunds||0);
      a.netSales+=Number(r.netSales||0);
      a.seaGoIncome+=Number(r.seaGoIncome||0);
      a.providerNet+=Number(r.providerNet||0);
      return a;
    },{bookings:0,guests:0,grossSales:0,refunds:0,netSales:0,seaGoIncome:0,providerNet:0});

    const roundMoney=n=>Number(Number(n||0).toFixed(2));
    res.json({
      generatedAt:new Date(),
      currency:"JOD",
      filters:{from:req.query.from||null,to:req.query.to||null,providerId:providerId||null},
      totals:{...totals,grossSales:roundMoney(totals.grossSales),refunds:roundMoney(totals.refunds),netSales:roundMoney(totals.netSales),seaGoIncome:roundMoney(totals.seaGoIncome),providerNet:roundMoney(totals.providerNet)},
      providers:providersList.map(p=>({id:p._id,businessName:p.businessName,status:p.status})),
      breakdown:(()=>{
        const byId=new Map(rows.map(r=>[String(r._id),r]));
        const visible=providerId?providersList.filter(p=>String(p._id)===providerId):providersList;
        return visible.map(p=>{
          const r=byId.get(String(p._id))||{};
          return{
            providerId:p._id,
            providerName:p.businessName,
            providerStatus:p.status,
            bookings:Number(r.bookings||0),
            guests:Number(r.guests||0),
            grossSales:roundMoney(r.grossSales),
            refunds:roundMoney(r.refunds),
            netSales:roundMoney(r.netSales),
            seaGoIncome:roundMoney(r.seaGoIncome),
            providerNet:roundMoney(r.providerNet)
          };
        }).sort((a,b)=>b.netSales-a.netSales||a.providerName.localeCompare(b.providerName));
      })()
    });
  }catch(e){next(e);}
});


router.get("/settlements",async(req,res,next)=>{
  try{
    const from=overviewDate(req.query.from,false),to=overviewDate(req.query.to,true);
    if(req.query.from&&!from)return res.status(400).json({error:"Invalid from date"});
    if(req.query.to&&!to)return res.status(400).json({error:"Invalid to date"});
    if(from&&to&&from>to)return res.status(400).json({error:"From date must be before to date"});
    const providerId=String(req.query.providerId||"").trim();
    if(providerId&&!/^[a-f0-9]{24}$/i.test(providerId))return res.status(400).json({error:"Invalid provider"});
    const data=await settlementLedger({from,to,providerId});
    const history=await ProviderSettlement.find(providerId?{providerId}:{})
      .populate("providerId","businessName").populate("paidBy","name email")
      .sort({paidAt:-1}).limit(100).lean();
    res.json({
      generatedAt:new Date(),currency:"JOD",
      filters:{from:req.query.from||null,to:req.query.to||null,providerId:providerId||null},
      providers:data.providersList.map(p=>({id:p._id,businessName:p.businessName,status:p.status})),
      totals:data.totals,reconciliationRequired:data.reconciliationRequired,
      breakdown:data.breakdown.map(({unsettledPaymentIds,unsettledBookingIds,items,...x})=>x),
      history:history.map(s=>({
        id:s._id,providerId:s.providerId?._id||s.providerId,providerName:s.providerId?.businessName||"Provider",
        periodFrom:s.periodFrom,periodTo:s.periodTo,currency:s.currency,
        grossSales:s.grossSales,refunds:s.refunds,seaGoCommission:s.seaGoCommission,
        providerNet:s.providerNet,amountPaid:s.amountPaid,status:s.status,paidAt:s.paidAt,
        paidBy:s.paidBy?{name:s.paidBy.name,email:s.paidBy.email}:null,note:s.note||""
      }))
    });
  }catch(e){next(e);}
});

router.post("/settlements/pay",async(req,res,next)=>{
  try{
    const from=overviewDate(req.body.from,false),to=overviewDate(req.body.to,true);
    const providerId=String(req.body.providerId||"").trim();
    if(!from||!to)return res.status(400).json({error:"From and to dates are required"});
    if(from>to)return res.status(400).json({error:"From date must be before to date"});
    if(!/^[a-f0-9]{24}$/i.test(providerId))return res.status(400).json({error:"Invalid provider"});
    const provider=await Provider.findById(providerId).select("_id businessName");
    if(!provider)return res.status(404).json({error:"Provider not found"});
    const settlement=await recordSettlement({from,to,providerId,paidBy:req.user._id,note:req.body.note});
    res.status(201).json({
      ok:true,id:settlement._id,providerId:provider._id,providerName:provider.businessName,
      amountPaid:settlement.amountPaid,currency:settlement.currency,paidAt:settlement.paidAt
    });
  }catch(e){
    if(e?.code===11000)return res.status(409).json({error:"One or more payments were already settled. Refresh and try again."});
    next(e);
  }
});

router.get("/trips",async(_req,res,next)=>{try{
  const rows=await Trip.find({}).populate("providerId","businessName status").sort({createdAt:-1});
  const tripIds=rows.map(t=>t._id);
  const stats=tripIds.length?await Booking.aggregate([
    {$match:{tripId:{$in:tripIds},status:"confirmed"}},
    {$group:{_id:"$tripId",bookings:{$sum:1},seats:{$sum:{$ifNull:["$seats",0]}},gross:{$sum:{$ifNull:["$pricing.grossAmount",0]}},commission:{$sum:{$ifNull:["$pricing.commissionAmount",0]}},providerNet:{$sum:{$ifNull:["$pricing.providerNetAmount",0]}}}}
  ]):[];
  const byTrip=new Map(stats.map(s=>[String(s._id),s]));
  res.json(rows.map(t=>({...t.toObject(),financials:(()=>{const s=byTrip.get(String(t._id))||{};return{confirmedBookings:Number(s.bookings||0),confirmedSeats:Number(s.seats||0),grossSales:Number(s.gross||0),commissionAmount:Number(s.commission||0),providerNetAmount:Number(s.providerNet||0),currency:t.pricing?.currency||"JOD"};})()})));
}catch(e){next(e);}});
router.get("/providers",async(_req,res,next)=>{try{
  const rows=await Provider.find({}).populate("ownerUserId","name email phone isActive").sort({createdAt:-1}).limit(300);
  const providerIds=rows.map(x=>x._id);
  const trips=providerIds.length?await Trip.find({providerId:{$in:providerIds}}).select("_id providerId active"): [];
  const tripIds=trips.map(t=>t._id);
  const now=new Date();
  const departures=tripIds.length?await Departure.find({tripId:{$in:tripIds},status:"scheduled",startsAt:{$gte:now}}).select("tripId startsAt reservedSeats capacity").sort({startsAt:1}):[];
  const tripProvider=new Map(trips.map(t=>[String(t._id),String(t.providerId)]));
  const byProvider=new Map();
  for(const p of providerIds)byProvider.set(String(p),{tripCount:0,activeTripCount:0,upcomingDepartures:0,nextDepartureAt:null,reservedSeatsUpcoming:0,capacityUpcoming:0});
  for(const t of trips){const k=String(t.providerId),s=byProvider.get(k);if(!s)continue;s.tripCount+=1;if(t.active)s.activeTripCount+=1;}
  for(const d of departures){const k=tripProvider.get(String(d.tripId));const s=byProvider.get(k);if(!s)continue;s.upcomingDepartures+=1;s.reservedSeatsUpcoming+=Number(d.reservedSeats||0);s.capacityUpcoming+=Number(d.capacity||0);if(!s.nextDepartureAt)s.nextDepartureAt=d.startsAt;}
  res.json(rows.map(p=>({...p.toObject(),operations:byProvider.get(String(p._id))||{tripCount:0,activeTripCount:0,upcomingDepartures:0,nextDepartureAt:null,reservedSeatsUpcoming:0,capacityUpcoming:0},settingsConfigured:Boolean(p.settings?.configured)})));
}catch(e){next(e);}});
router.get("/notifications",async(_req,res,next)=>{try{const rows=await NotificationLog.find({}).sort({createdAt:-1}).limit(300);res.json(rows);}catch(e){next(e);}});
router.get("/support-requests",async(_req,res,next)=>{try{
  const rows=await SupportRequest.find({}).populate("customerId","name email phone").populate("bookingId","status").sort({createdAt:-1}).limit(300);
  res.json(rows);
}catch(e){next(e);}});
router.patch("/support-requests/:requestId",async(req,res,next)=>{try{
  const status=String(req.body.status||"");
  if(!["open","in_progress","resolved","closed"].includes(status))return res.status(400).json({error:"Invalid support status"});
  const update={$set:{status}};
  if(["resolved","closed"].includes(status)){update.$set.resolvedAt=new Date();update.$set.resolvedBy=req.user._id;}
  else{update.$unset={resolvedAt:1,resolvedBy:1};}
  const row=await SupportRequest.findByIdAndUpdate(req.params.requestId,update,{new:true});
  if(!row)return res.status(404).json({error:"Support request not found"});
  res.json(row);
}catch(e){next(e);}});
router.get("/refunds",async(_req,res,next)=>{try{
  const rows=await Booking.find({"cancellation.cancelledAt":{$exists:true}})
    .populate("customerId","name email phone")
    .populate("providerId","businessName")
    .populate("tripId","titleEn titleAr")
    .populate("departureId","startsAt status")
    .sort({"cancellation.cancelledAt":-1}).limit(300);
  const ids=rows.map(x=>x._id);
  const payments=ids.length?await Payment.find({bookingId:{$in:ids}}).select("bookingId status amount currency refundedAmount refundedAt refundReference provider"):[];
  const byBooking=new Map(payments.map(p=>[String(p.bookingId),p]));
  res.json(rows.map(b=>{
    const o=b.toObject();
    const original=Number(o.pricing?.grossAmount||0);
    const refund=Number(o.cancellation?.refundAmount||0);
    const retained=Math.max(0,original-refund);
    const originalCommission=Number(o.pricing?.commissionAmount||0);
    const originalProviderNet=Number(o.pricing?.providerNetAmount||0);
    const ratio=original>0?retained/original:0;
    return {...o,
      bookingReference:"SG-"+String(b._id).slice(-8).toUpperCase(),
      payment:byBooking.get(String(b._id))||null,
      financialImpact:{
        currency:o.pricing?.currency||"JOD",
        originalAmount:original,
        refundAmount:refund,
        retainedAmount:retained,
        seaGoRetained:Number((originalCommission*ratio).toFixed(2)),
        providerNetAfterRefund:Number((originalProviderNet*ratio).toFixed(2))
      }
    };
  }));
}catch(e){next(e);}});
router.patch("/trips/:tripId/commission",async(req,res,next)=>{try{const percentage=Number(req.body.percentage);if(!Number.isFinite(percentage)||percentage<0||percentage>100)return res.status(400).json({error:"Commission percentage must be between 0 and 100"});const trip=await Trip.findById(req.params.tripId);if(!trip)return res.status(404).json({error:"Trip not found"});trip.pricing.commissionType="percentage";trip.pricing.commissionValue=percentage;await trip.save();res.json(trip);}catch(e){next(e);}});
router.patch("/providers/:providerId/approve",async(req,res,next)=>{try{const p=await Provider.findById(req.params.providerId).populate("ownerUserId","isActive role");if(!p)return res.status(404).json({error:"Provider not found"});if(!p.ownerUserId||p.ownerUserId.role!=="provider"||!p.ownerUserId.isActive)return res.status(409).json({error:"Provider owner account is not active"});if(p.status==="approved")return res.json(p);if(p.status!=="pending")return res.status(409).json({error:"Only pending provider applications can be approved"});p.status="approved";p.approvedAt=new Date();p.approvedBy=req.user._id;await p.save();res.json(p);}catch(e){next(e);}});
router.patch("/providers/:providerId/status",async(req,res,next)=>{
  try{
    const nextStatus=String(req.body.status||"").trim();
    if(!["pending","approved","rejected","suspended"].includes(nextStatus))return res.status(400).json({error:"Invalid provider status"});
    const p=await Provider.findById(req.params.providerId).populate("ownerUserId","isActive role");
    if(!p)return res.status(404).json({error:"Provider not found"});
    if(!p.ownerUserId||p.ownerUserId.role!=="provider")return res.status(409).json({error:"Provider owner account is invalid"});
    if(nextStatus==="approved"&&!p.ownerUserId.isActive)return res.status(409).json({error:"Provider owner account is not active"});
    if(p.status===nextStatus)return res.json(p);

    const allowed={
      pending:new Set(["approved","rejected"]),
      approved:new Set(["suspended"]),
      suspended:new Set(["approved","rejected"]),
      rejected:new Set(["pending"])
    };
    if(!allowed[p.status]?.has(nextStatus))return res.status(409).json({error:`Cannot change provider status from ${p.status} to ${nextStatus}`});

    p.status=nextStatus;
    if(nextStatus==="approved"){
      p.approvedAt=new Date();
      p.approvedBy=req.user._id;
    }else if(nextStatus!=="approved"){
      p.approvedAt=undefined;
      p.approvedBy=undefined;
    }
    await p.save();

    if(["suspended","rejected"].includes(nextStatus)){
      const trips=await Trip.find({providerId:p._id}).select("_id");
      const tripIds=trips.map(t=>t._id);
      if(tripIds.length){
        const departures=await Departure.find({tripId:{$in:tripIds},status:"scheduled"}).select("_id");
        for(const d of departures){
          await releaseCheckoutHoldsForDeparture(d._id);
        }
      }
    }

    res.json(p);
  }catch(e){next(e);}
});
router.post("/bookings/release-expired",async(_req,res,next)=>{try{const released=await releaseExpiredCheckoutHolds({limit:1000});res.json({released});}catch(e){next(e);}});

router.get("/readiness",async(_req,res,next)=>{
  try{
    const now=new Date();
    const [approvedProviders,providersPending,confirmedBookings,bookingTotals]=await Promise.all([
      Provider.find({status:"approved"}).select("_id"),
      Provider.countDocuments({status:"pending"}),
      Booking.countDocuments({status:"confirmed"}),
      Booking.aggregate([
        {$match:{status:"confirmed"}},
        {$group:{_id:null,gross:{$sum:{$ifNull:["$pricing.grossAmount",0]}},commission:{$sum:{$ifNull:["$pricing.commissionAmount",0]}},providerNet:{$sum:{$ifNull:["$pricing.providerNetAmount",0]}},seats:{$sum:{$ifNull:["$seats",0]}}}}
      ])
    ]);
    const approvedProviderIds=approvedProviders.map(p=>p._id);
    const activeTripRows=approvedProviderIds.length
      ?await Trip.find({active:true,providerId:{$in:approvedProviderIds}}).select("_id")
      :[];
    const activeTripIds=activeTripRows.map(t=>t._id);
    const upcomingDepartures=activeTripIds.length
      ?await Departure.countDocuments({tripId:{$in:activeTripIds},status:"scheduled",startsAt:{$gte:now}})
      :0;
    const providersApproved=approvedProviders.length;
    const activeTrips=activeTripIds.length;
    const totals=bookingTotals[0]||{gross:0,commission:0,providerNet:0,seats:0};
    const upcomingRows=activeTripIds.length
      ?await Departure.find({tripId:{$in:activeTripIds},status:"scheduled",startsAt:{$gte:now}})
        .sort({startsAt:1}).limit(6).populate({path:"tripId",select:"titleEn titleAr providerId",populate:{path:"providerId",select:"businessName"}})
      :[];

    const demoProvider=await Provider.findOne({businessName:"Aqaba SeaGo Demo Partner"}).select("_id");
    const demoTripCount=demoProvider?await Trip.countDocuments({providerId:demoProvider._id}):0;
    const demoActiveTripCount=demoProvider?await Trip.countDocuments({providerId:demoProvider._id,active:true}):0;
    const demoUserEmails=[process.env.DEMO_PROVIDER_EMAIL,process.env.DEMO_ADMIN_EMAIL].filter(Boolean).map(v=>String(v).trim().toLowerCase());
    const demoUserCount=demoUserEmails.length?await User.countDocuments({email:{$in:demoUserEmails}}):0;

    const allowedOrigins=String(process.env.ALLOWED_ORIGINS||"").split(",").map(v=>v.trim()).filter(Boolean);
    const publicBaseUrl=String(process.env.PUBLIC_BASE_URL||"").trim();
    const jwtSecret=String(process.env.JWT_SECRET||"");
    const mockCheckout=process.env.ENABLE_MOCK_CHECKOUT==="true";
    const mockSecret=String(process.env.MOCK_PAYMENT_WEBHOOK_SECRET||"");
    const validPublicBaseUrl=(()=>{try{const u=new URL(publicBaseUrl);return u.protocol==="https:"||u.hostname==="localhost"||u.hostname==="127.0.0.1";}catch{return false;}})();

    const checks=[
      {id:"provider",label:"At least one approved provider",ok:providersApproved>0},
      {id:"trips",label:"At least one active trip",ok:activeTrips>0},
      {id:"departures",label:"At least one upcoming departure",ok:upcomingDepartures>0},
      {id:"demo-seed",label:"Demo seeding disabled",ok:process.env.SEED_DEMO_DATA!=="true"},
      {id:"demo-records",label:"No sellable demo inventory remains",ok:demoActiveTripCount===0},
      {id:"jwt-secret",label:"Strong JWT secret configured",ok:jwtSecret.length>=32&&!/replace-with|changeme|secret/i.test(jwtSecret)},
      {id:"cors",label:"Allowed frontend origins configured",ok:allowedOrigins.length>0},
      {id:"public-url",label:"Public API base URL configured",ok:validPublicBaseUrl},
      {id:"mock-secret",label:"Mock webhook secret configured",ok:!mockCheckout||(mockSecret.length>=24&&!/replace-with|changeme/i.test(mockSecret))},
      {id:"email",label:"Production email sender/domain configured",ok:Boolean(process.env.RESEND_API_KEY)&&Boolean(process.env.EMAIL_FROM)&&!String(process.env.EMAIL_FROM).includes("onboarding@resend.dev"),deferred:true},
      {id:"payment",label:"Real payment gateway configured",ok:(process.env.PAYMENT_PROVIDER||"mock")!=="mock",deferred:true}
    ];
    const blockers=checks.filter(x=>!x.ok&&!x.deferred).map(x=>({id:x.id,label:x.label}));
    const deferredChecks=checks.filter(x=>x.deferred&&!x.ok).map(x=>({id:x.id,label:x.label}));
    const pilotReady=blockers.length===0;
    const controlledPilotReady=pilotReady&&mockCheckout&&process.env.PUBLIC_LAUNCH!=="true";

    res.json({
      generatedAt:new Date(),
      pilotReady,
      controlledPilotReady,
      status:pilotReady?"ready":"blocked",
      blockers,
      deferredChecks,
      environment:{
        nodeEnv:process.env.NODE_ENV||"development",
        publicLaunch:process.env.PUBLIC_LAUNCH==="true",
        seedDemoData:process.env.SEED_DEMO_DATA==="true",
        mockCheckout,
        paymentProvider:process.env.PAYMENT_PROVIDER||"mock",
        allowedOriginCount:allowedOrigins.length,
        publicBaseUrlConfigured:validPublicBaseUrl
      },
      counts:{providersApproved,providersPending,activeTrips,upcomingDepartures,confirmedBookings},
      operations:{
        currency:"JOD",
        grossSales:Number(totals.gross||0),
        seaGoCommission:Number(totals.commission||0),
        providerNet:Number(totals.providerNet||0),
        confirmedSeats:Number(totals.seats||0),
        upcoming:upcomingRows.map(d=>({
          id:d._id,
          startsAt:d.startsAt,
          capacity:d.capacity,
          reservedSeats:d.reservedSeats,
          availableSeats:Math.max(0,Number(d.capacity||0)-Number(d.reservedSeats||0)),
          tripTitle:d.tripId?.titleEn||d.tripId?.titleAr||"Trip",
          providerName:d.tripId?.providerId?.businessName||"Provider"
        }))
      },
      demo:{providerExists:Boolean(demoProvider),tripCount:demoTripCount,activeTripCount:demoActiveTripCount,userCount:demoUserCount},
      checks
    });
  }catch(e){next(e);}
});

router.get("/demo-cleanup-preview",async(_req,res,next)=>{
  try{
    const provider=await Provider.findOne({businessName:"Aqaba SeaGo Demo Partner"}).select("_id businessName");
    const trips=provider?await Trip.find({providerId:provider._id}).select("_id titleEn"): [];
    const tripIds=trips.map(t=>t._id);
    const departures=tripIds.length?await Departure.find({tripId:{$in:tripIds}}).select("_id"): [];
    const departureIds=departures.map(d=>d._id);
    const bookingCount=tripIds.length?await Booking.countDocuments({tripId:{$in:tripIds}}):0;
    const holdCount=tripIds.length?await CheckoutHold.countDocuments({tripId:{$in:tripIds}}):0;
    const demoEmails=[process.env.DEMO_PROVIDER_EMAIL,process.env.DEMO_ADMIN_EMAIL].filter(Boolean).map(v=>String(v).trim().toLowerCase());
    const users=demoEmails.length?await User.find({email:{$in:demoEmails}}).select("_id email role"):[];
    res.json({
      dryRun:true,
      provider:provider||null,
      trips:trips.map(t=>({id:t._id,title:t.titleEn})),
      departureCount:departures.length,
      bookingCount,
      holdCount,
      safeToDelete:Boolean(provider)&&bookingCount===0&&holdCount===0&&process.env.SEED_DEMO_DATA!=="true",
      users:users.map(u=>({id:u._id,email:u.email,role:u.role})),
      note:"Preview only. No records were deleted."
    });
  }catch(e){next(e);}
});

router.post("/demo-cleanup",async(req,res,next)=>{
  try{
    if(process.env.SEED_DEMO_DATA==="true"){
      return res.status(409).json({error:"Disable SEED_DEMO_DATA before cleanup"});
    }
    if(String(req.body.confirmation||"")!=="DELETE DEMO DATA"){
      return res.status(400).json({error:"Confirmation phrase is incorrect"});
    }

    const provider=await Provider.findOne({businessName:"Aqaba SeaGo Demo Partner"});
    if(!provider)return res.json({ok:true,deleted:{provider:0,trips:0,departures:0,users:0},message:"No demo provider found"});

    if(String(req.body.providerId||"")!==String(provider._id)){
      return res.status(409).json({error:"Demo provider changed. Refresh the preview before cleanup"});
    }

    const trips=await Trip.find({providerId:provider._id}).select("_id");
    const tripIds=trips.map(t=>t._id);
    const departures=tripIds.length?await Departure.find({tripId:{$in:tripIds}}).select("_id"): [];
    const departureIds=departures.map(d=>d._id);

    const [bookingCount,holdCount]=await Promise.all([
      tripIds.length?Booking.countDocuments({tripId:{$in:tripIds}}):0,
      tripIds.length?CheckoutHold.countDocuments({tripId:{$in:tripIds}}):0
    ]);
    if(bookingCount>0||holdCount>0){
      return res.status(409).json({error:"Cleanup blocked because demo records have booking or checkout history",bookingCount,holdCount});
    }

    const demoProviderEmail=String(process.env.DEMO_PROVIDER_EMAIL||"").trim().toLowerCase();
    const owner=await User.findById(provider.ownerUserId).select("_id email role");
    const canDeleteOwner=Boolean(owner&&demoProviderEmail&&owner.email===demoProviderEmail&&owner.role==="provider"&&String(owner._id)!==String(req.user._id));

    if(departureIds.length) await Departure.deleteMany({_id:{$in:departureIds}});
    if(tripIds.length) await Trip.deleteMany({_id:{$in:tripIds}});
    await Provider.deleteOne({_id:provider._id});
    let users=0;
    if(canDeleteOwner){
      const r=await User.deleteOne({_id:owner._id});
      users=r.deletedCount||0;
    }

    res.json({
      ok:true,
      deleted:{provider:1,trips:tripIds.length,departures:departureIds.length,users},
      preservedAdmin:true,
      message:"Demo provider data removed. Admin accounts were not deleted."
    });
  }catch(e){next(e);}
});

export default router;
