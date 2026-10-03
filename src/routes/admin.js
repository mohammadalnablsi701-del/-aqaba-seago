import express from "express";import Provider from "../models/Provider.js";import User from "../models/User.js";import CheckoutHold from "../models/CheckoutHold.js";import Payment from "../models/Payment.js";import NotificationLog from "../models/NotificationLog.js";import Booking from "../models/Booking.js";import Departure from "../models/Departure.js";import Trip from "../models/Trip.js";import{releaseExpiredCheckoutHolds,releaseCheckoutHoldsForDeparture}from"../services/payments.js";import{requireAuth,requireRole}from"../middleware/auth.js";const router=express.Router();router.use(requireAuth,requireRole("admin"));
router.get("/trips",async(_req,res,next)=>{try{const rows=await Trip.find({}).populate("providerId","businessName status").sort({createdAt:-1});res.json(rows);}catch(e){next(e);}});
router.get("/providers",async(_req,res,next)=>{try{const rows=await Provider.find({}).populate("ownerUserId","name email phone isActive").sort({createdAt:-1}).limit(300);res.json(rows);}catch(e){next(e);}});
router.get("/notifications",async(_req,res,next)=>{try{const rows=await NotificationLog.find({}).sort({createdAt:-1}).limit(300);res.json(rows);}catch(e){next(e);}});
router.get("/refunds",async(_req,res,next)=>{try{const rows=await Booking.find({"cancellation.cancelledAt":{$exists:true}}).populate("customerId","name email phone").populate("providerId","businessName").populate("tripId","titleEn titleAr").populate("departureId","startsAt status").sort({"cancellation.cancelledAt":-1}).limit(300);const ids=rows.map(x=>x._id);const payments=await Payment.find({bookingId:{$in:ids}}).select("bookingId status amount currency refundedAmount refundedAt refundReference provider");const byBooking=new Map(payments.map(p=>[String(p.bookingId),p]));res.json(rows.map(b=>({...b.toObject(),bookingReference:"SG-"+String(b._id).slice(-8).toUpperCase(),payment:byBooking.get(String(b._id))||null})));}catch(e){next(e);}});
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
    const [approvedProviders,providersPending,confirmedBookings]=await Promise.all([
      Provider.find({status:"approved"}).select("_id"),
      Provider.countDocuments({status:"pending"}),
      Booking.countDocuments({status:"confirmed"})
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

    const demoProvider=await Provider.findOne({businessName:"Aqaba SeaGo Demo Partner"}).select("_id");
    const demoTripCount=demoProvider?await Trip.countDocuments({providerId:demoProvider._id}):0;
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
      {id:"demo-records",label:"No demo provider/trips remain",ok:!demoProvider&&demoTripCount===0},
      {id:"jwt-secret",label:"Strong JWT secret configured",ok:jwtSecret.length>=32&&!/replace-with|changeme|secret/i.test(jwtSecret)},
      {id:"cors",label:"Allowed frontend origins configured",ok:allowedOrigins.length>0},
      {id:"public-url",label:"Public API base URL configured",ok:validPublicBaseUrl},
      {id:"mock-secret",label:"Mock webhook secret configured",ok:!mockCheckout||(mockSecret.length>=24&&!/replace-with|changeme/i.test(mockSecret))},
      {id:"payment",label:"Real payment gateway configured",ok:(process.env.PAYMENT_PROVIDER||"mock")!=="mock",deferred:true}
    ];
    const blockers=checks.filter(x=>!x.ok&&!x.deferred).map(x=>({id:x.id,label:x.label}));
    const deferredChecks=checks.filter(x=>x.deferred&&!x.ok).map(x=>({id:x.id,label:x.label}));
    const pilotReady=blockers.length===0;

    res.json({
      generatedAt:new Date(),
      pilotReady,
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
      demo:{providerExists:Boolean(demoProvider),tripCount:demoTripCount,userCount:demoUserCount},
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
