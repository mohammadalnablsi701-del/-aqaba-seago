import express from "express";
import Trip from "../models/Trip.js";
import Provider from "../models/Provider.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireProviderCapability } from "../services/providerAccess.js";
import { auditProviderAction } from "../services/providerAudit.js";
import { tripForAudience } from "../services/pricingVisibility.js";

const router = express.Router();

const CATEGORIES=new Set(["group_boat","private_boat","yacht","glass_bottom","snorkeling","diving","fishing","sunset","private_event","water_sports","semi_submarine"]);

function cleanText(value,max=160){
  return String(value??"").trim().replace(/\s+/g," ").slice(0,max);
}
function validHttpUrl(value){
  if(!value) return true;
  try{
    const u=new URL(String(value));
    return u.protocol==="http:"||u.protocol==="https:";
  }catch{return false;}
}
function validateTripPayload(body,{partial=false}={}){
  const errors=[];
  const titleAr=cleanText(body.titleAr,120);
  const titleEn=cleanText(body.titleEn,120);
  const vesselName=cleanText(body.vesselName,120);
  const category=body.category;
  const duration=Number(body.durationMinutes);
  if(!partial||body.titleAr!==undefined){if(titleAr.length<2)errors.push("Arabic title is required");}
  if(!partial||body.titleEn!==undefined){if(titleEn.length<2)errors.push("English title is required");}
  if(body.vesselName!==undefined&&vesselName.length>0&&vesselName.length<2)errors.push("Vessel name must be at least 2 characters");
  if(!partial||body.category!==undefined){if(!CATEGORIES.has(category))errors.push("Invalid category");}
  if(!partial||body.durationMinutes!==undefined){if(!Number.isFinite(duration)||duration<15||duration>1440)errors.push("Duration must be between 15 and 1440 minutes");}
  const p=body.pricing||{};
  for(const [key,label] of [["adultPrice","Adult price"],["childPrice","Child price"],["buffetAdultPrice","Buffet adult price"],["buffetChildPrice","Buffet child price"]]){
    if(p[key]!==undefined){
      const n=Number(p[key]);
      if(!Number.isFinite(n)||n<0||n>10000)errors.push(label+" is invalid");
    }
  }
  if(p.buffetEnabled===true){
    if(!Number.isFinite(Number(p.buffetAdultPrice))||Number(p.buffetAdultPrice)<=0)errors.push("Buffet adult price is required when buffet is enabled");
    if(!Number.isFinite(Number(p.buffetChildPrice))||Number(p.buffetChildPrice)<0)errors.push("Buffet child price is invalid");
  }
  if(body.departureLocation?.googleMapsUrl&&!validHttpUrl(body.departureLocation.googleMapsUrl))errors.push("Google Maps URL is invalid");
  if(Array.isArray(body.images)&&body.images.length>10)errors.push("A maximum of 10 trip images is allowed");
  return errors;
}

function sanitizeImages(input){
  if(!Array.isArray(input)) return [];
  return input.slice(0,10).map(x=>{
    if(typeof x==="string") return x.trim();
    if(x && typeof x==="object" && x.url) return {url:String(x.url),publicId:x.publicId?String(x.publicId):undefined,source:x.source?String(x.source):"external"};
    return null;
  }).filter(Boolean);
}

function salePriceUpdate(input = {}, existing = null) {
  const adultPrice = Number(input.adultPrice ?? input.pricePerPerson ?? existing?.adultPrice ?? existing?.pricePerPerson ?? 0);
  const childPrice = Number(input.childPrice ?? existing?.childPrice ?? adultPrice);
  const buffetEnabled = input.buffetEnabled !== undefined ? Boolean(input.buffetEnabled) : Boolean(existing?.buffetEnabled);
  const buffetAdultPrice = Number(input.buffetAdultPrice ?? existing?.buffetAdultPrice ?? adultPrice);
  const buffetChildPrice = Number(input.buffetChildPrice ?? existing?.buffetChildPrice ?? childPrice);
  const buffetDescription = String(input.buffetDescription ?? existing?.buffetDescription ?? "").trim();

  return {
    currency: input.currency || existing?.currency || "JOD",
    pricePerPerson: adultPrice,
    adultPrice,
    childPrice,
    buffetEnabled,
    buffetAdultPrice,
    buffetChildPrice,
    buffetDescription
  };
}

router.post("/", requireAuth, requireRole("provider"), async (req, res, next) => {
  try {
    const errors=validateTripPayload(req.body);
    if(errors.length)return res.status(400).json({error:errors[0],errors});
    const access=await requireProviderCapability(req.user,"manage_trips");
    const p=access?.provider;
    if(!p)return res.status(403).json({error:"Trip management permission required"});

    const configuredCommission=Number(process.env.DEFAULT_COMMISSION_PERCENTAGE);
    const defaultCommission=Number.isFinite(configuredCommission)&&configuredCommission>=0&&configuredCommission<=100?configuredCommission:20;
    const trip = await Trip.create({
      titleAr: cleanText(req.body.titleAr,120),
      titleEn: cleanText(req.body.titleEn,120),
      vesselName: cleanText(req.body.vesselName,120) || undefined,
      category: req.body.category,
      durationMinutes: req.body.durationMinutes,
      departureLocation: req.body.departureLocation ? {...req.body.departureLocation,name:cleanText(req.body.departureLocation.name,120),address:cleanText(req.body.departureLocation.address,220),googleMapsUrl:cleanText(req.body.departureLocation.googleMapsUrl,500)} : undefined,
      images: sanitizeImages(req.body.images),
      active: req.body.active !== false,
      pricing: {
        ...salePriceUpdate(req.body.pricing),
        commissionType: "percentage",
        commissionValue: defaultCommission
      },
      providerId: p._id
    });

    await auditProviderAction({access,user:req.user,action:"trip.create",targetType:"trip",targetId:trip._id,summary:"Created trip "+trip.titleEn,metadata:{active:trip.active,category:trip.category,vesselName:trip.vesselName||null}});
    res.status(201).json(trip);
  } catch (e) { next(e); }
});

router.patch("/:tripId", requireAuth, requireRole("provider"), async (req, res, next) => {
  try {
    const errors=validateTripPayload(req.body,{partial:true});
    if(errors.length)return res.status(400).json({error:errors[0],errors});
    const access=await requireProviderCapability(req.user,"manage_trips");
    const p=access?.provider;
    if(!p)return res.status(403).json({error:"Trip management permission required"});

    const trip = await Trip.findOne({ _id: req.params.tripId, providerId: p._id });
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    for (const key of ["titleAr","titleEn","vesselName","category","durationMinutes","departureLocation","images","active"]) {
      if (req.body[key] !== undefined) {
        if(key==="images") trip[key]=sanitizeImages(req.body[key]);
        else if(key==="titleAr"||key==="titleEn") trip[key]=cleanText(req.body[key],120);
        else if(key==="vesselName") trip[key]=cleanText(req.body[key],120)||undefined;
        else if(key==="departureLocation") trip[key]={...req.body[key],name:cleanText(req.body[key]?.name,120),address:cleanText(req.body[key]?.address,220),googleMapsUrl:cleanText(req.body[key]?.googleMapsUrl,500)};
        else trip[key]=req.body[key];
      }
    }

    if (req.body.pricing) {
      // Providers own sale prices only. Administrative commission fields are
      // intentionally ignored even if a client tries to submit them.
      for (const [key, value] of Object.entries(salePriceUpdate(req.body.pricing, trip.pricing))) {
        trip.set(`pricing.${key}`, value);
      }
    }

    await trip.save();
    await auditProviderAction({access,user:req.user,action:"trip.update",targetType:"trip",targetId:trip._id,summary:"Updated trip "+trip.titleEn,metadata:{active:trip.active,vesselName:trip.vesselName||null}});
    res.json(trip);
  } catch (e) { next(e); }
});

router.get("/", async (_req, res, next) => {
  try {
    const approvedProviders = await Provider.find({ status: "approved" }).select("_id");
    const providerIds = approvedProviders.map(p => p._id);
    const trips = await Trip.find({ active: true, providerId: { $in: providerIds } })
      .populate("providerId", "businessName");
    res.json(trips.map(trip => tripForAudience(trip)));
  } catch (e) { next(e); }
});

export default router;
