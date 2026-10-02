import express from "express";
import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";
import Booking from "../models/Booking.js";
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

export default router;
