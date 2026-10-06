import express from "express";
import Departure from "../models/Departure.js";
import Trip from "../models/Trip.js";
import Provider from "../models/Provider.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireProviderCapability } from "../services/providerAccess.js";
import { auditProviderAction } from "../services/providerAudit.js";
import { calculateTieredPricing } from "../services/pricing.js";
import { releaseExpiredCheckoutHolds, releaseCheckoutHoldsForDeparture } from "../services/payments.js";
import { cancelDepartureBookings } from "../services/cancellations.js";
import { salePricing } from "../services/pricingVisibility.js";

const router = express.Router();

function validateDepartureInput({startsAt,capacity},{partial=false}={}){
  const errors=[];
  if(!partial||startsAt!==undefined){
    const d=new Date(startsAt);
    if(!startsAt||Number.isNaN(d.getTime())) errors.push("Valid departure date and time are required");
    else if(d.getTime()<=Date.now()+5*60*1000) errors.push("Departure must be scheduled at least 5 minutes in the future");
  }
  if(!partial||capacity!==undefined){
    const n=Number(capacity);
    if(!Number.isInteger(n)||n<1||n>500) errors.push("Capacity must be a whole number between 1 and 500");
  }
  return errors;
}


router.post("/", requireAuth, requireRole("provider"), async (req, res, next) => {
  try {
    const errors=validateDepartureInput(req.body);
    if(errors.length)return res.status(400).json({error:errors[0],errors});
    const access=await requireProviderCapability(req.user,"manage_departures");
    const provider=access?.provider;
    if(!provider)return res.status(403).json({error:"Departure management permission required"});

    const trip = await Trip.findOne({
      _id: req.body.tripId,
      providerId: provider._id,
      active: true
    });
    if (!trip) return res.status(404).json({ error: "Active trip not found" });

    const departure = await Departure.create({
      tripId: trip._id,
      startsAt: req.body.startsAt,
      capacity: req.body.capacity
    });

    await auditProviderAction({access,user:req.user,action:"departure.create",targetType:"departure",targetId:departure._id,summary:"Created departure for "+trip.titleEn,metadata:{startsAt:departure.startsAt,capacity:departure.capacity,tripId:trip._id}});
    res.status(201).json(departure);
  } catch (err) {
    next(err);
  }
});

router.post("/bulk", requireAuth, requireRole("provider"), async (req,res,next)=>{
  try{
    const access=await requireProviderCapability(req.user,"manage_departures");const provider=access?.provider;
    if(!provider)return res.status(403).json({error:"Departure management permission required"});
    const trip=await Trip.findOne({_id:req.body.tripId,providerId:provider._id,active:true});
    if(!trip)return res.status(404).json({error:"Active trip not found"});

    const startsAtList=Array.isArray(req.body.startsAtList)?req.body.startsAtList:[];
    const capacity=Number(req.body.capacity);
    if(!Number.isInteger(capacity)||capacity<1||capacity>500)return res.status(400).json({error:"Capacity must be a whole number between 1 and 500"});
    if(startsAtList.length<1||startsAtList.length>60)return res.status(400).json({error:"Choose between 1 and 60 departure times"});

    const normalized=[];
    const seen=new Set();
    for(const value of startsAtList){
      const d=new Date(value);
      if(Number.isNaN(d.getTime())||d.getTime()<=Date.now()+5*60*1000)return res.status(400).json({error:"All departures must be valid and at least 5 minutes in the future"});
      const key=d.toISOString();
      if(seen.has(key))continue;
      seen.add(key);
      normalized.push(d);
    }

    const existing=await Departure.find({tripId:trip._id,status:"scheduled",startsAt:{$in:normalized}}).select("startsAt");
    const existingSet=new Set(existing.map(x=>new Date(x.startsAt).toISOString()));
    const docs=normalized.filter(d=>!existingSet.has(d.toISOString())).map(startsAt=>({tripId:trip._id,startsAt,capacity,status:"scheduled"}));
    const created=docs.length?await Departure.insertMany(docs):[];
    if(created.length)await auditProviderAction({access,user:req.user,action:"departure.bulk_create",targetType:"trip",targetId:trip._id,summary:"Created "+created.length+" departures for "+trip.titleEn,metadata:{created:created.length,capacity}});
    res.status(201).json({created:created.length,skippedExisting:normalized.length-created.length,items:created});
  }catch(e){next(e);}
});

router.get("/", async (req, res, next) => {
  try {
    await releaseExpiredCheckoutHolds({ limit: 200 });
    const approvedProviders=await Provider.find({status:"approved"}).select("_id");
    const approvedProviderIds=approvedProviders.map(p=>p._id);
    const activeTrips=await Trip.find({active:true,providerId:{$in:approvedProviderIds}}).select("_id");
    const activeTripIds=activeTrips.map(t=>t._id);
    const query = {
      status: "scheduled",
      salesClosed: { $ne: true },
      startsAt: { $gte: new Date() },
      tripId: { $in: activeTripIds }
    };

    if (req.query.tripId) {
      const requestedTripId=String(req.query.tripId);
      const allowed=activeTripIds.some(id=>String(id)===requestedTripId);
      if(!allowed)return res.json([]);
      query.tripId=req.query.tripId;
    }

    const departures = await Departure.find(query)
      .sort({ startsAt: 1 })
      .limit(Math.min(Number(req.query.limit || 30), 100));

    res.json(
      departures.map(d => ({
        id: d._id,
        tripId: d.tripId,
        startsAt: d.startsAt,
        capacity: d.capacity,
        reservedSeats: d.reservedSeats,
        availableSeats: Math.max(0, d.capacity - d.reservedSeats),
        status: d.status,
        salesClosed:Boolean(d.salesClosed)
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.patch("/:departureId", requireAuth, requireRole("provider"), async (req,res,next)=>{
  try{
    const errors=validateDepartureInput(req.body,{partial:true});
    if(errors.length)return res.status(400).json({error:errors[0],errors});
    const access=await requireProviderCapability(req.user,"manage_departures");const provider=access?.provider;
    if(!provider)return res.status(403).json({error:"Departure management permission required"});
    const departure=await Departure.findById(req.params.departureId);
    if(!departure)return res.status(404).json({error:"Departure not found"});
    const originalReservedSeats=Number(departure.reservedSeats||0);
    const originalStatus=departure.status;
    const trip=await Trip.findOne({_id:departure.tripId,providerId:provider._id});
    if(!trip)return res.status(403).json({error:"Forbidden"});
    if(req.body.capacity!==undefined){
      const capacity=Number(req.body.capacity);
      if(!Number.isInteger(capacity)||capacity<departure.reservedSeats)return res.status(400).json({error:"Capacity cannot be below reserved seats"});
      departure.capacity=capacity;
    }
    if(req.body.startsAt!==undefined){
      const nextStartsAt=new Date(req.body.startsAt);
      const timeChanged=nextStartsAt.getTime()!==new Date(departure.startsAt).getTime();
      if(timeChanged&&departure.reservedSeats>0){
        return res.status(409).json({error:"Departure time cannot be changed while seats are reserved"});
      }
      departure.startsAt=nextStartsAt;
    }
    const closingSales=req.body.salesClosed===true&&!departure.salesClosed;
    if(req.body.salesClosed!==undefined){
      if(departure.status!=="scheduled")return res.status(409).json({error:"Only scheduled departures can change sales availability"});
      departure.salesClosed=Boolean(req.body.salesClosed);
    }
    if(req.body.status!==undefined){
      const nextStatus=req.body.status;
      if(!["scheduled","cancelled","completed"].includes(nextStatus))return res.status(400).json({error:"Invalid departure status"});
      if(departure.status==="cancelled"&&nextStatus!=="cancelled"){
        return res.status(409).json({error:"Cancelled departures cannot be reactivated"});
      }
      if(departure.status==="completed"&&nextStatus!=="completed"){
        return res.status(409).json({error:"Completed departures cannot be reactivated"});
      }
      if(nextStatus==="completed"&&new Date(departure.startsAt)>new Date()){
        return res.status(409).json({error:"Future departures cannot be marked completed"});
      }
      if(nextStatus==="cancelled"&&departure.status!=="cancelled"){
        departure.status="cancelled";
        await departure.save();
        await releaseCheckoutHoldsForDeparture(departure._id);
        await cancelDepartureBookings({departureId:departure._id,providerId:provider._id,reason:req.body.cancellationReason||"Departure cancelled by provider"});
        await auditProviderAction({access,user:req.user,action:"departure.cancel",targetType:"departure",targetId:departure._id,summary:"Cancelled departure for "+trip.titleEn,metadata:{startsAt:departure.startsAt,reason:req.body.cancellationReason||"Departure cancelled by provider"}});
        return res.json(departure);
      }
      departure.status=nextStatus;
    }
    const updateSet={
      capacity:departure.capacity,
      startsAt:departure.startsAt,
      status:departure.status,
      salesClosed:Boolean(departure.salesClosed)
    };
    const updated=await Departure.findOneAndUpdate(
      {_id:departure._id,reservedSeats:originalReservedSeats,status:originalStatus},
      {$set:updateSet},
      {new:true}
    );
    if(!updated)return res.status(409).json({error:"Departure changed while you were editing it. Reload and try again."});
    if(closingSales)await releaseCheckoutHoldsForDeparture(updated._id);
    const finalDeparture=closingSales?await Departure.findById(updated._id):updated;
    await auditProviderAction({access,user:req.user,action:"departure.update",targetType:"departure",targetId:updated._id,summary:"Updated departure for "+trip.titleEn,metadata:{startsAt:updated.startsAt,capacity:updated.capacity,status:updated.status,salesClosed:Boolean(updated.salesClosed)}});
    res.json(finalDeparture);
  }catch(e){next(e);}
});

router.get("/:departureId/quote", async (req, res, next) => {
  try {
    await releaseExpiredCheckoutHolds({ limit: 200 });
    const adults = Number(req.query.adults ?? req.query.seats ?? 0);
    const children = Number(req.query.children ?? 0);
    const mealPlan = req.query.mealPlan === "with_buffet" ? "with_buffet" : "without_buffet";
    if (!Number.isInteger(adults) || adults < 0) {
      return res.status(400).json({ error: "Invalid adults" });
    }
    if (!Number.isInteger(children) || children < 0) {
      return res.status(400).json({ error: "Invalid children" });
    }
    const seats = adults + children;
    const departure = await Departure.findById(req.params.departureId);

    if (!departure || departure.status !== "scheduled" || departure.salesClosed === true || departure.startsAt <= new Date()) {
      return res.status(404).json({ error: "Departure not found" });
    }

    if (seats < 1) {
      return res.status(400).json({ error: "At least one guest is required" });
    }

    if (departure.reservedSeats + seats > departure.capacity) {
      return res.status(409).json({ error: "Not enough seats" });
    }

    const trip = await Trip.findOne({ _id: departure.tripId, active: true });
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    const provider = await Provider.findOne({ _id: trip.providerId, status: "approved" }).select("_id");
    if (!provider) return res.status(404).json({ error: "Trip not found" });
    const pricing = calculateTieredPricing({ pricing: trip.pricing, adults, children, mealPlan });

    res.json({
      departureId: departure._id,
      seats,
      adults,
      children,
      mealPlan,
      availableSeats: departure.capacity - departure.reservedSeats,
      pricing: salePricing(pricing)
    });
  } catch (err) {
    next(err);
  }
});

export default router;
