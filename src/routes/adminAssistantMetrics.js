import express from "express";
import {requireAuth,requireRole} from "../middleware/auth.js";
import {assistantMetricsSnapshot} from "../services/assistantMetrics.js";

const router=express.Router();
router.use(requireAuth,requireRole("admin"));
// No user/provider identifiers, prompts, recordings or raw model responses exposed.
router.get("/metrics",(_req,res)=>{
  res.set("Cache-Control","no-store");
  res.json(assistantMetricsSnapshot());
});
export default router;
