import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { uploadTripImage, deleteTripImage } from "../services/media.js";

const router = express.Router();

router.post("/trip-image", requireAuth, requireRole("provider"), async (req,res,next)=>{
  try {
    const result = await uploadTripImage(req.body.dataUrl, req.user._id);
    res.status(201).json(result);
  } catch (e) { next(e); }
});

router.delete("/trip-image", requireAuth, requireRole("provider"), async (req,res,next)=>{
  try {
    const publicId = String(req.body.publicId || "");
    const prefix = `aqaba-seago/trips/${String(req.user._id)}/`;
    if (!publicId.startsWith(prefix)) return res.status(403).json({ error: "Forbidden media resource" });
    const result = await deleteTripImage(publicId);
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
