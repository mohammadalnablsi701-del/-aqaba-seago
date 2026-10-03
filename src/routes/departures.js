import express from "express";
import Departure from "../models/Departure.js";
import Trip from "../models/Trip.js";
import Provider from "../models/Provider.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { calculateTieredPricing } from "../services/pricing.js";
import { releaseExpiredCheckoutHolds, releaseCheckoutHoldsForDeparture } from "../services/payments.js";
import { cancelDepartureBookings } from "../services/cancellations.js";

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
    const provider = await Provider.findOne({
      ownerUserId: req.user._id,
      status: "approved"
    });
    if (!provider) {
      return res.status(403).json({ error: "Approved provider profile required" });
    }

    const trip = await Trip.findOne({
      _id: req.body.tripId,
      providerId: provider._id
    });
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const departure = await Departure.create({
      tripId: trip._id,
      startsAt: req.body.startsAt,
      capacity: req.body.capacity
    });

    res.status(201).json(departure);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    await releaseExpiredCheckoutHolds({ limit: 200 });
    const query = {
      status: "scheduled",
      startsAt: { $gte: new Date() }
    };

    if (req.query.tripId) query.tripId = req.query.tripId;

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
        status: d.status
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
    const provider=await Provider.findOne({ownerUserId:req.user._id,status:"approved"});
    if(!provider)return res.status(403).json({error:"Approved provider profile required"});
    const departure=await Departure.findById(req.params.departureId);
    if(!departure)return res.status(404).json({error:"Departure not found"});
    const trip=await Trip.findOne({_id:departure.tripId,providerId:provider._id});
    if(!trip)return res.status(403).json({error:"Forbidden"});
    if(req.body.capacity!==undefined){
      const capacity=Number(req.body.capacity);
      if(!Number.isInteger(capacity)||capacity<departure.reservedSeats)return res.status(400).json({error:"Capacity cannot be below reserved seats"});
      departure.capacity=capacity;
    }
    if(req.body.startsAt!==undefined)departure.startsAt=new Date(req.body.startsAt);
    if(req.body.status!==undefined){
      const nextStatus=req.body.status;
      if(!["scheduled","cancelled","completed"].includes(nextStatus))return res.status(400).json({error:"Invalid departure status"});
      if(nextStatus==="cancelled"&&departure.status!=="cancelled"){
        await releaseCheckoutHoldsForDeparture(departure._id);
        await cancelDepartureBookings({departureId:departure._id,providerId:provider._id,reason:req.body.cancellationReason||"Departure cancelled by provider"});
      }
      departure.status=nextStatus;
    }
    await departure.save();
    res.json(departure);
  }catch(e){next(e);}
});

router.get("/:departureId/quote", async (req, res, next) => {
  try {
    await releaseExpiredCheckoutHolds({ limit: 200 });
    const adults = Number(req.query.adults ?? req.query.seats ?? 0);
    const children = Number(req.query.children ?? 0);
    const mealPlan = req.query.mealPlan === "with_buffet" ? "with_buffet" : "without_buffet";
    const seats = adults + children;
    const departure = await Departure.findById(req.params.departureId);

    if (!departure || departure.status !== "scheduled") {
      return res.status(404).json({ error: "Departure not found" });
    }

    if (!Number.isInteger(seats) || seats < 1) {
      return res.status(400).json({ error: "Invalid seats" });
    }

    if (departure.reservedSeats + seats > departure.capacity) {
      return res.status(409).json({ error: "Not enough seats" });
    }

    const trip = await Trip.findById(departure.tripId);
    const pricing = calculateTieredPricing({ pricing: trip.pricing, adults, children, mealPlan });

    res.json({
      departureId: departure._id,
      seats,
      adults,
      children,
      mealPlan,
      availableSeats: departure.capacity - departure.reservedSeats,
      pricing
    });
  } catch (err) {
    next(err);
  }
});

export default router;
