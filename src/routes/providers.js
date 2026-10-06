import express from "express";
import Provider from "../models/Provider.js";
import Trip from "../models/Trip.js";
import Departure from "../models/Departure.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import User from "../models/User.js";
import ProviderMember from "../models/ProviderMember.js";
import bcrypt from "bcryptjs";
import { resolveProviderAccess, requireProviderCapability } from "../services/providerAccess.js";
import ProviderAuditLog from "../models/ProviderAuditLog.js";
import { auditProviderAction } from "../services/providerAudit.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { tripForAudience } from "../services/pricingVisibility.js";

const router=express.Router();

function cleanText(value,max=120){
  return String(value??"").trim().replace(/\s+/g," ").slice(0,max);
}
function cleanPhone(value){
  return String(value??"").trim().replace(/[^\d+\-() ]/g,"").slice(0,30);
}

function bookingForAccess(booking, access, { payment = undefined } = {}){
  const obj=typeof booking?.toObject==="function"?booking.toObject():{...booking};
  const canViewFinance=Boolean(access?.capabilities?.includes("view_finance"));
  if(!canViewFinance){
    delete obj.pricing;
    delete obj.cancellation;
  }
  if(payment!==undefined&&canViewFinance)obj.payment=payment;
  return obj;
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

router.patch("/me/settings",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const access=await requireProviderCapability(req.user,"manage_settings",{approved:false});
    const provider=access?.provider;
    if(!provider)return res.status(403).json({error:"Provider settings permission required"});
    const phone=cleanPhone(req.body.phone);
    const defaultCapacity=Number(req.body.defaultCapacity);
    const defaultDepartureTime=cleanText(req.body.defaultDepartureTime,5);
    const location=req.body.departureLocation||{};
    if(phone&&phone.replace(/\D/g,"").length<7)return res.status(400).json({error:"Enter a valid phone number"});
    if(!Number.isInteger(defaultCapacity)||defaultCapacity<1||defaultCapacity>500)return res.status(400).json({error:"Default capacity must be between 1 and 500"});
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(defaultDepartureTime))return res.status(400).json({error:"Default departure time must be HH:MM"});
    provider.phone=phone||undefined;
    provider.settings={
      configured:true,
      defaultCapacity,
      defaultDepartureTime,
      departureLocation:{
        name:cleanText(location.name,120),
        address:cleanText(location.address,220),
        googleMapsUrl:cleanText(location.googleMapsUrl,500)
      }
    };
    await provider.save();
    await auditProviderAction({access,user:req.user,action:"settings.update",targetType:"provider",targetId:provider._id,summary:"Updated provider settings"});
    res.json(provider);
  }catch(e){next(e);}
});

router.get("/me",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const access=await resolveProviderAccess(req.user,{approved:false});
    const provider=access?.provider;
    if(!provider)return res.status(404).json({error:"Provider profile not found"});
    res.json({...provider.toObject(),accessRole:access.accessRole,capabilities:access.capabilities});
  }catch(e){next(e);}
});

router.get("/me/trips",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const access=await resolveProviderAccess(req.user);const provider=access?.provider;
    if(!provider)return res.status(403).json({error:"Approved provider access required"});
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
    res.json(trips.map(t=>({...tripForAudience(t,{viewFinance:access.capabilities.includes("view_finance")}),schedule:byTrip.get(String(t._id))||{upcomingDepartures:0,nextDepartureAt:null,reservedSeatsUpcoming:0,capacityUpcoming:0}})));
  }catch(e){next(e);}
});

router.get("/me/departures",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const access=await resolveProviderAccess(req.user);const provider=access?.provider;
    if(!provider)return res.status(403).json({error:"Approved provider access required"});
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
      availableSeats:Math.max(0,d.capacity-d.reservedSeats),status:d.status,salesClosed:Boolean(d.salesClosed)
    })));
  }catch(e){next(e);}
});

router.get("/me/bookings",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const access=await requireProviderCapability(req.user,"view_bookings");const provider=access?.provider;
    if(!provider)return res.status(403).json({error:"Approved provider access required"});
    const query={providerId:provider._id,status:"confirmed"};
    if(req.query.date){
      const start=new Date(req.query.date+"T00:00:00+03:00");
      const end=new Date(req.query.date+"T23:59:59.999+03:00");
      const tripIds=await Trip.find({providerId:provider._id}).distinct("_id");
      const depIds=await Departure.find({tripId:{$in:tripIds},startsAt:{$gte:start,$lte:end}}).distinct("_id");
      query.departureId={$in:depIds};
    }
    const rows=await Booking.find(query)
      .populate("tripId","titleEn titleAr category")
      .populate("departureId","startsAt status")
      .populate("customerId","name phone email")
      .sort({createdAt:-1})
      .limit(300);
    res.json(rows.map(b=>bookingForAccess(b,access)));
  }catch(e){next(e);}
});


router.get("/me/departures/:departureId/manifest",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const access=await requireProviderCapability(req.user,"view_bookings");const provider=access?.provider;
    if(!provider)return res.status(403).json({error:"Approved provider access required"});

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
    const access=await requireProviderCapability(req.user,"view_finance");const provider=access?.provider;
    if(!provider)return res.status(403).json({error:"Approved provider access required"});

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
    const access=await requireProviderCapability(req.user,"checkin");const provider=access?.provider;
    if(!provider)return res.status(403).json({error:"Approved provider access required"});
    const booking=await Booking.findOne({_id:req.params.bookingId,providerId:provider._id}).populate("departureId","status startsAt");
    if(!booking)return res.status(404).json({error:"Booking not found"});
    if(booking.status!=="confirmed")return res.status(409).json({error:"Booking is not valid for check-in"});
    if(!booking.departureId||booking.departureId.status!=="scheduled")return res.status(409).json({error:"Departure is not open for check-in"});
    const checkedAt=new Date();
    const claimed=await Booking.findOneAndUpdate(
      {_id:booking._id,providerId:provider._id,status:"confirmed",checkedInAt:null},
      {$set:{checkedInAt:checkedAt,checkedInBy:req.user._id},$inc:{checkInCount:1}},
      {new:true}
    );
    if(!claimed)return res.status(409).json({error:"Booking already checked in"});
    await auditProviderAction({access,user:req.user,action:"booking.checkin",targetType:"booking",targetId:claimed._id,summary:"Checked in booking SG-"+String(claimed._id).slice(-8).toUpperCase(),metadata:{guests:claimed.seats,method:"manual"}});
    res.json({ok:true,bookingId:claimed._id,checkedInAt:claimed.checkedInAt,guests:claimed.seats});
  }catch(e){next(e);}
});

router.get("/me/bookings/:bookingId",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const access=await requireProviderCapability(req.user,"view_bookings");const provider=access?.provider;
    if(!provider)return res.status(403).json({error:"Approved provider access required"});
    const booking=await Booking.findOne({_id:req.params.bookingId,providerId:provider._id})
      .populate("tripId","titleEn titleAr category durationMinutes departureLocation")
      .populate("departureId","startsAt status capacity reservedSeats")
      .populate("customerId","name phone email");
    if(!booking)return res.status(404).json({error:"Booking not found"});
    const payment=await Payment.findOne({bookingId:booking._id}).select("status amount currency paidAt provider");
    res.json({
      ...bookingForAccess(booking,access,{payment:payment||null}),
      bookingReference:"SG-"+String(booking._id).slice(-8).toUpperCase()
    });
  }catch(e){next(e);}
});

router.get("/me/team",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const access=await requireProviderCapability(req.user,"manage_team",{approved:false});
    if(!access)return res.status(403).json({error:"Owner permission required"});
    const owner=await User.findById(access.provider.ownerUserId).select("name email phone isActive");
    const members=await ProviderMember.find({providerId:access.provider._id}).populate("userId","name email phone isActive").sort({createdAt:1});
    res.json({owner:owner?{id:owner._id,name:owner.name,email:owner.email,phone:owner.phone,isActive:owner.isActive,role:"owner"}:null,members:members.map(m=>({id:m._id,userId:m.userId?._id,name:m.userId?.name,email:m.userId?.email,phone:m.userId?.phone,role:m.role,isActive:m.isActive&&Boolean(m.userId?.isActive)}))});
  }catch(e){next(e);}
});

router.post("/me/team",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const access=await requireProviderCapability(req.user,"manage_team",{approved:false});
    if(!access)return res.status(403).json({error:"Owner permission required"});
    const name=cleanText(req.body.name,80),email=String(req.body.email||"").trim().toLowerCase(),phone=cleanPhone(req.body.phone),password=String(req.body.password||""),role=String(req.body.role||"staff");
    if(name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:"Valid name and email are required"});
    if(password.length<8||password.length>128)return res.status(400).json({error:"Password must be 8–128 characters"});
    if(!["manager","staff","checkin"].includes(role))return res.status(400).json({error:"Invalid team role"});
    if(await User.exists({email}))return res.status(409).json({error:"Email already registered"});
    const passwordHash=await bcrypt.hash(password,12);
    const user=await User.create({name,email,phone:phone||undefined,passwordHash,role:"provider",isActive:true});
    try{
      const member=await ProviderMember.create({providerId:access.provider._id,userId:user._id,role,isActive:true,createdBy:req.user._id});
      await auditProviderAction({access,user:req.user,action:"team.add",targetType:"team_member",targetId:member._id,summary:"Added team member "+user.name,metadata:{role}});
      res.status(201).json({id:member._id,userId:user._id,name:user.name,email:user.email,phone:user.phone,role:member.role,isActive:true});
    }catch(e){await User.deleteOne({_id:user._id});throw e;}
  }catch(e){next(e);}
});

router.patch("/me/team/:memberId",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const access=await requireProviderCapability(req.user,"manage_team",{approved:false});
    if(!access)return res.status(403).json({error:"Owner permission required"});
    const member=await ProviderMember.findOne({_id:req.params.memberId,providerId:access.provider._id}).populate("userId");
    if(!member)return res.status(404).json({error:"Team member not found"});
    if(req.body.role!==undefined){
      const role=String(req.body.role);
      if(!["manager","staff","checkin"].includes(role))return res.status(400).json({error:"Invalid team role"});
      member.role=role;
    }
    if(req.body.isActive!==undefined){member.isActive=Boolean(req.body.isActive);if(member.userId){member.userId.isActive=Boolean(req.body.isActive);await member.userId.save();}}
    await member.save();
    await auditProviderAction({access,user:req.user,action:"team.update",targetType:"team_member",targetId:member._id,summary:"Updated team member "+(member.userId?.name||"account"),metadata:{role:member.role,isActive:member.isActive}});
    res.json({id:member._id,userId:member.userId?._id,name:member.userId?.name,email:member.userId?.email,role:member.role,isActive:member.isActive&&Boolean(member.userId?.isActive)});
  }catch(e){next(e);}
});

router.get("/me/audit-log",requireAuth,requireRole("provider"),async(req,res,next)=>{
  try{
    const access=await requireProviderCapability(req.user,"manage_team",{approved:false});
    if(!access)return res.status(403).json({error:"Owner permission required"});
    const rows=await ProviderAuditLog.find({providerId:access.provider._id}).populate("actorUserId","name email").sort({createdAt:-1}).limit(200);
    res.json(rows.map(x=>({id:x._id,action:x.action,targetType:x.targetType,targetId:x.targetId,summary:x.summary,metadata:x.metadata,createdAt:x.createdAt,actor:{id:x.actorUserId?._id,name:x.actorUserId?.name,email:x.actorUserId?.email,role:x.actorRole}})));
  }catch(e){next(e);}
});

export default router;
