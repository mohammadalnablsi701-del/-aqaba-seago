import express from "express";import Provider from "../models/Provider.js";import User from "../models/User.js";import Payment from "../models/Payment.js";import NotificationLog from "../models/NotificationLog.js";import Booking from "../models/Booking.js";import Departure from "../models/Departure.js";import Trip from "../models/Trip.js";import{releaseExpiredCheckoutHolds}from"../services/payments.js";import{requireAuth,requireRole}from"../middleware/auth.js";const router=express.Router();router.use(requireAuth,requireRole("admin"));
router.get("/trips",async(_req,res,next)=>{try{const rows=await Trip.find({}).populate("providerId","businessName status").sort({createdAt:-1});res.json(rows);}catch(e){next(e);}});
router.get("/notifications",async(_req,res,next)=>{try{const rows=await NotificationLog.find({}).sort({createdAt:-1}).limit(300);res.json(rows);}catch(e){next(e);}});
router.get("/refunds",async(_req,res,next)=>{try{const rows=await Booking.find({"cancellation.cancelledAt":{$exists:true}}).populate("customerId","name email phone").populate("providerId","businessName").populate("tripId","titleEn titleAr").populate("departureId","startsAt status").sort({"cancellation.cancelledAt":-1}).limit(300);const ids=rows.map(x=>x._id);const payments=await Payment.find({bookingId:{$in:ids}}).select("bookingId status amount currency refundedAmount refundedAt refundReference provider");const byBooking=new Map(payments.map(p=>[String(p.bookingId),p]));res.json(rows.map(b=>({...b.toObject(),bookingReference:"SG-"+String(b._id).slice(-8).toUpperCase(),payment:byBooking.get(String(b._id))||null})));}catch(e){next(e);}});
router.patch("/trips/:tripId/commission",async(req,res,next)=>{try{const percentage=Number(req.body.percentage);if(!Number.isFinite(percentage)||percentage<0||percentage>100)return res.status(400).json({error:"Commission percentage must be between 0 and 100"});const trip=await Trip.findById(req.params.tripId);if(!trip)return res.status(404).json({error:"Trip not found"});trip.pricing.commissionType="percentage";trip.pricing.commissionValue=percentage;await trip.save();res.json(trip);}catch(e){next(e);}});
router.patch("/providers/:providerId/approve",async(req,res,next)=>{try{const p=await Provider.findByIdAndUpdate(req.params.providerId,{status:"approved",approvedAt:new Date(),approvedBy:req.user._id},{new:true});if(!p)return res.status(404).json({error:"Provider not found"});res.json(p);}catch(e){next(e);}});
router.post("/bookings/release-expired",async(_req,res,next)=>{try{const released=await releaseExpiredCheckoutHolds({limit:1000});res.json({released});}catch(e){next(e);}});

router.get("/readiness",async(_req,res,next)=>{
  try{
    const now=new Date();
    const [providersApproved,providersPending,activeTrips,upcomingDepartures,confirmedBookings]=await Promise.all([
      Provider.countDocuments({status:"approved"}),
      Provider.countDocuments({status:"pending"}),
      Trip.countDocuments({active:true}),
      Departure.countDocuments({status:"scheduled",startsAt:{$gte:now}}),
      Booking.countDocuments({status:"confirmed"})
    ]);

    const demoProvider=await Provider.findOne({businessName:"Aqaba SeaGo Demo Partner"}).select("_id");
    const demoTripCount=demoProvider?await Trip.countDocuments({providerId:demoProvider._id}):0;
    const demoUserEmails=[process.env.DEMO_PROVIDER_EMAIL,process.env.DEMO_ADMIN_EMAIL].filter(Boolean).map(v=>String(v).trim().toLowerCase());
    const demoUserCount=demoUserEmails.length?await User.countDocuments({email:{$in:demoUserEmails}}):0;

    res.json({
      generatedAt:new Date(),
      environment:{
        nodeEnv:process.env.NODE_ENV||"development",
        publicLaunch:process.env.PUBLIC_LAUNCH==="true",
        seedDemoData:process.env.SEED_DEMO_DATA==="true",
        mockCheckout:process.env.ENABLE_MOCK_CHECKOUT==="true",
        paymentProvider:process.env.PAYMENT_PROVIDER||"mock"
      },
      counts:{providersApproved,providersPending,activeTrips,upcomingDepartures,confirmedBookings},
      demo:{providerExists:Boolean(demoProvider),tripCount:demoTripCount,userCount:demoUserCount},
      checks:[
        {id:"provider",label:"At least one approved provider",ok:providersApproved>0},
        {id:"trips",label:"At least one active trip",ok:activeTrips>0},
        {id:"departures",label:"At least one upcoming departure",ok:upcomingDepartures>0},
        {id:"demo-seed",label:"Demo seeding disabled",ok:process.env.SEED_DEMO_DATA!=="true"},
        {id:"demo-records",label:"No demo provider/trips remain",ok:!demoProvider&&demoTripCount===0},
        {id:"payment",label:"Real payment gateway configured",ok:(process.env.PAYMENT_PROVIDER||"mock")!=="mock",deferred:true}
      ]
    });
  }catch(e){next(e);}
});

router.get("/demo-cleanup-preview",async(_req,res,next)=>{
  try{
    const provider=await Provider.findOne({businessName:"Aqaba SeaGo Demo Partner"}).select("_id businessName");
    const trips=provider?await Trip.find({providerId:provider._id}).select("_id titleEn"): [];
    const departures=trips.length?await Departure.countDocuments({tripId:{$in:trips.map(t=>t._id)}}):0;
    const demoEmails=[process.env.DEMO_PROVIDER_EMAIL,process.env.DEMO_ADMIN_EMAIL].filter(Boolean).map(v=>String(v).trim().toLowerCase());
    const users=demoEmails.length?await User.find({email:{$in:demoEmails}}).select("_id email role"):[];
    res.json({
      dryRun:true,
      provider:provider||null,
      trips:trips.map(t=>({id:t._id,title:t.titleEn})),
      departureCount:departures,
      users:users.map(u=>({id:u._id,email:u.email,role:u.role})),
      note:"Preview only. No records were deleted."
    });
  }catch(e){next(e);}
});

export default router;
