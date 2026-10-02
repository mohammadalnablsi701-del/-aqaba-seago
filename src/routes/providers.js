import express from "express";
import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router=express.Router();

router.post("/",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const p=await Provider.create({ownerUserId:req.user._id,businessName:req.body.businessName,phone:req.body.phone});
    res.status(201).json(p);
  }catch(e){
    if(e?.code===11000)return res.status(409).json({error:"Provider profile already exists"});
    next(e);
  }
});

router.get("/me",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const provider=await Provider.findOne({ownerUserId:req.user._id});
    if(!provider)return res.status(404).json({error:"Provider profile not found"});
    res.json(provider);
  }catch(e){next(e);}
});

router.get("/me/trips",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const provider=await Provider.findOne({ownerUserId:req.user._id,status:"approved"});
    if(!provider)return res.status(403).json({error:"Approved provider profile required"});
    const trips=await Trip.find({providerId:provider._id}).sort({createdAt:-1});
    res.json(trips);
  }catch(e){next(e);}
});

router.get("/me/departures",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const provider=await Provider.findOne({ownerUserId:req.user._id,status:"approved"});
    if(!provider)return res.status(403).json({error:"Approved provider profile required"});
    const trips=await Trip.find({providerId:provider._id}).select("_id");
    const tripIds=trips.map(t=>t._id);
    const query={tripId:{$in:tripIds}};
    if(req.query.date){
      const start=new Date(req.query.date+"T00:00:00+03:00");
      const end=new Date(req.query.date+"T23:59:59.999+03:00");
      query.startsAt={$gte:start,$lte:end};
    }else{
      query.startsAt={$gte:new Date()};
    }
    const rows=await Departure.find(query).populate("tripId","titleEn titleAr category").sort({startsAt:1}).limit(200);
    res.json(rows.map(d=>({
      id:d._id,tripId:d.tripId,startsAt:d.startsAt,capacity:d.capacity,reservedSeats:d.reservedSeats,
      availableSeats:Math.max(0,d.capacity-d.reservedSeats),status:d.status
    })));
  }catch(e){next(e);}
});

router.get("/me/bookings",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const provider=await Provider.findOne({ownerUserId:req.user._id,status:"approved"});
    if(!provider)return res.status(403).json({error:"Approved provider profile required"});
    const query={providerId:provider._id,status:"confirmed"};
    const rows=await Booking.find(query)
      .populate("tripId","titleEn titleAr category")
      .populate("departureId","startsAt status")
      .populate("customerId","name phone email")
      .sort({createdAt:-1})
      .limit(300);
    const filtered=req.query.date?rows.filter(b=>{
      const s=b.departureId?.startsAt;
      if(!s)return false;
      return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Amman",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(s))===req.query.date;
    }):rows;
    res.json(filtered);
  }catch(e){next(e);}
});


router.get("/me/departures/:departureId/manifest",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const provider=await Provider.findOne({ownerUserId:req.user._id,status:"approved"});
    if(!provider)return res.status(403).json({error:"Approved provider profile required"});

    const departure=await Departure.findById(req.params.departureId)
      .populate("tripId","titleEn titleAr category durationMinutes departureLocation");
    if(!departure)return res.status(404).json({error:"Departure not found"});

    const ownsTrip=await Trip.exists({_id:departure.tripId._id,providerId:provider._id});
    if(!ownsTrip)return res.status(403).json({error:"Forbidden"});

    const rows=await Booking.find({providerId:provider._id,departureId:departure._id,status:"confirmed"})
      .populate("customerId","name phone email")
      .sort({createdAt:1});

    const manifest=rows.map(b=>({
      id:b._id,
      bookingReference:"SG-"+String(b._id).slice(-8).toUpperCase(),
      customer:{name:b.customerId?.name||"Guest",phone:b.customerId?.phone||null,email:b.customerId?.email||null},
      seats:b.seats,
      adults:b.adults,
      children:b.children,
      mealPlan:b.mealPlan,
      checkedInAt:b.checkedInAt||null
    }));

    res.json({
      departure:{
        id:departure._id,startsAt:departure.startsAt,status:departure.status,
        capacity:departure.capacity,reservedSeats:departure.reservedSeats,trip:departure.tripId
      },
      summary:{
        bookings:manifest.length,
        guests:manifest.reduce((s,b)=>s+Number(b.seats||0),0),
        checkedInBookings:manifest.filter(b=>b.checkedInAt).length,
        checkedInGuests:manifest.filter(b=>b.checkedInAt).reduce((s,b)=>s+Number(b.seats||0),0),
        remainingGuests:manifest.filter(b=>!b.checkedInAt).reduce((s,b)=>s+Number(b.seats||0),0)
      },
      bookings:manifest
    });
  }catch(e){next(e);}
});

router.get("/me/stats",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const provider=await Provider.findOne({ownerUserId:req.user._id,status:"approved"});
    if(!provider)return res.status(403).json({error:"Approved provider profile required"});

    const trips=await Trip.find({providerId:provider._id}).select("_id");
    const tripIds=trips.map(t=>t._id);
    const date=req.query.date;
    let departureIds=null;

    if(date){
      const start=new Date(date+"T00:00:00+03:00");
      const end=new Date(date+"T23:59:59.999+03:00");
      const deps=await Departure.find({tripId:{$in:tripIds},startsAt:{$gte:start,$lte:end}}).select("_id");
      departureIds=deps.map(d=>d._id);
    }

    const query={providerId:provider._id,status:"confirmed"};
    if(departureIds)query.departureId={$in:departureIds};

    const rows=await Booking.find(query).select("seats pricing checkedInAt");
    const totals=rows.reduce((a,b)=>{
      a.bookings+=1;
      a.guests+=Number(b.seats||0);
      a.gross+=Number(b.pricing?.grossAmount||0);
      a.commission+=Number(b.pricing?.commissionAmount||0);
      a.providerNet+=Number(b.pricing?.providerNetAmount||0);
      if(b.checkedInAt)a.checkedIn+=1;
      return a;
    },{bookings:0,guests:0,gross:0,commission:0,providerNet:0,checkedIn:0});

    res.json({...totals,currency:"JOD"});
  }catch(e){next(e);}
});

router.get("/me/bookings/:bookingId",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const provider=await Provider.findOne({ownerUserId:req.user._id,status:"approved"});
    if(!provider)return res.status(403).json({error:"Approved provider profile required"});
    const booking=await Booking.findOne({_id:req.params.bookingId,providerId:provider._id})
      .populate("tripId","titleEn titleAr category durationMinutes departureLocation")
      .populate("departureId","startsAt status capacity reservedSeats")
      .populate("customerId","name phone email");
    if(!booking)return res.status(404).json({error:"Booking not found"});
    const payment=await Payment.findOne({bookingId:booking._id}).select("status amount currency paidAt provider");
    res.json({
      ...booking.toObject(),
      bookingReference:"SG-"+String(booking._id).slice(-8).toUpperCase(),
      payment:payment||null
    });
  }catch(e){next(e);}
});

export default router;
