import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateAllowedFields, isBoundedString } from "../middleware/validation.js";
import { uploadTripImage, deleteTripImage } from "../services/media.js";
import { requireProviderCapability } from "../services/providerAccess.js";

const router = express.Router();
const UPLOAD_FIELDS = new Set(["dataUrl"]);
const DELETE_FIELDS = new Set(["publicId"]);

router.post("/trip-image", requireAuth, requireRole("provider"), async (req,res,next)=>{
  try {
    const fieldError=validateAllowedFields(req.body,UPLOAD_FIELDS);
    if(fieldError)return res.status(400).json({error:fieldError});
    if(typeof req.body.dataUrl!=="string")return res.status(400).json({error:"Invalid image payload"});

    const access=await requireProviderCapability(req.user,"manage_trips");
    if(!access)return res.status(403).json({error:"Trip management permission required"});
    const result = await uploadTripImage(req.body.dataUrl, access.provider._id);
    res.status(201).json(result);
  } catch (e) { next(e); }
});

router.delete("/trip-image", requireAuth, requireRole("provider"), async (req,res,next)=>{
  try {
    const fieldError=validateAllowedFields(req.body,DELETE_FIELDS);
    if(fieldError)return res.status(400).json({error:fieldError});
    if(!isBoundedString(req.body.publicId,{min:1,max:300}))return res.status(400).json({error:"Invalid publicId"});

    const access=await requireProviderCapability(req.user,"manage_trips");
    if(!access)return res.status(403).json({error:"Trip management permission required"});
    const publicId = req.body.publicId.trim();
    const prefixes=[`aqaba-seago/trips/${String(access.provider._id)}/`,`aqaba-seago/trips/${String(access.provider.ownerUserId)}/`];
    if(!prefixes.some(prefix=>publicId.startsWith(prefix)))return res.status(403).json({error:"Forbidden media resource"});
    const result = await deleteTripImage(publicId);
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
