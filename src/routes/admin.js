import express from "express";import Provider from "../models/Provider.js";import User from "../models/User.js";import CheckoutHold from "../models/CheckoutHold.js";import Payment from "../models/Payment.js";import NotificationLog from "../models/NotificationLog.js";import Booking from "../models/Booking.js";import Departure from "../models/Departure.js";import Trip from "../models/Trip.js";import{releaseExpiredCheckoutHolds}from"../services/payments.js";import{requireAuth,requireRole}from"../middleware/auth.js";const router=express.Router();router.use(requireAuth,requireRole("admin"));
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
