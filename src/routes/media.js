import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { uploadTripImage, deleteTripImage } from "../services/media.js";
import { requireProviderCapability } from "../services/providerAccess.js";

const router = express.Router();

router.post("/trip-image", requireAuth, requireRole("provider"), async (req,res,next)=>{
  try {
    const access=await requireProviderCapability(req.user,"manage_trips");
    if(!access)return res.status(403).json({error:"Trip management permission required"});
    const result = await uploadTripImage(req.body.dataUrl, access.provider._id);
    res.status(201).json(result);
  } catch (e) { next(e); }
});

router.delete("/trip-image", requireAuth, requireRole("provider"), async (req,res,next)=>{
  try {
    const access=await requireProviderCapability(req.user,"manage_trips");
    if(!access)return res.status(403).json({error:"Trip management permission required"});
    const publicId = String(req.body.publicId || "");
    const prefixes=[`aqaba-seago/trips/${String(access.provider._id)}/`,`aqaba-seago/trips/${String(access.provider.ownerUserId)}/`];
    if(!prefixes.some(prefix=>publicId.startsWith(prefix)))return res.status(403).json({error:"Forbidden media resource"});
    const result = await deleteTripImage(publicId);
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
