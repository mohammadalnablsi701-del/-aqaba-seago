import express from "express";
import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router=express.Router();

function cleanText(value,max=120){
  return String(value??"").trim().replace(/\s+/g," ").slice(0,max);
}
function cleanPhone(value){
  return String(value??"").trim().replace(/[^\d+\-() ]/g,"").slice(0,30);
}

router.post("/",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const businessName=cleanText(req.body.businessName,120);
    const phone=cleanPhone(req.body.phone);
    if(businessName.length<2)return res.status(400).json({error:"Business name is required"});
    if(phone&&phone.replace(/\D/g,"").length<7)return res.status(400).json({error:"Enter a valid phone number"});
    const p=await Provider.create({ownerUserId:req.user._id,businessName,phone:phone||undefined});
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
    const tripIds=trips.map(t=>t._id);
    const now=new Date();
    const upcoming=tripIds.length?await Departure.find({tripId:{$in:tripIds},status:"scheduled",startsAt:{$gte:now}}).sort({startsAt:1}).select("tripId startsAt reservedSeats capacity"):[];
    const byTrip=new Map();
    for(const d of upcoming){
      const key=String(d.tripId);
      const row=byTrip.get(key)||{upcomingDepartures:0,nextDepartureAt:null,reservedSeatsUpcoming:0,capacityUpcoming:0};
      row.upcomingDepartures+=1;
      row.nextDepartureAt ||= d.startsAt;
      row.reservedSeatsUpcoming+=Number(d.reservedSeats||0);
      row.capacityUpcoming+=Number(d.capacity||0);
      byTrip.set(key,row);
    }
    res.json(trips.map(t=>({...t.toObject(),schedule:byTrip.get(String(t._id))||{upcomingDepartures:0,nextDepartureAt:null,reservedSeatsUpcoming:0,capacityUpcoming:0}})));
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

router.post("/me/bookings/:bookingId/check-in",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const provider=await Provider.findOne({ownerUserId:req.user._id,status:"approved"});
    if(!provider)return res.status(403).json({error:"Approved provider profile required"});
    const booking=await Booking.findOne({_id:req.params.bookingId,providerId:provider._id})
      .populate("departureId","status startsAt");
    if(!booking)return res.status(404).json({error:"Booking not found"});
    if(booking.status!=="confirmed")return res.status(409).json({error:"Booking is not valid for check-in"});
    if(!booking.departureId||booking.departureId.status!=="scheduled")return res.status(409).json({error:"Departure is not open for check-in"});
    if(booking.checkedInAt)return res.status(409).json({error:"Booking already checked in",checkedInAt:booking.checkedInAt});
    booking.checkedInAt=new Date();
    booking.checkedInBy=req.user._id;
    booking.checkInCount=Number(booking.checkInCount||0)+1;
    await booking.save();
    res.json({ok:true,bookingId:booking._id,checkedInAt:booking.checkedInAt,guests:booking.seats});
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
