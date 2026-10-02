import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { uploadTripImage, deleteTripImage } from "../services/media.js";

const router = express.Router();

router.post("/trip-image", requireAuth, requireRole("provider"), async (req,res,next)=>{
  try {
    const result = await uploadTripImage(req.body.dataUrl);
    res.status(201).json(result);
  } catch (e) { next(e); }
});

router.delete("/trip-image", requireAuth, requireRole("provider"), async (req,res,next)=>{
  try {
    const result = await deleteTripImage(String(req.body.publicId || ""));
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
