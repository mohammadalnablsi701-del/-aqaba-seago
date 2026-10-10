import express from "express";
import mongoose from "mongoose";
import AdminAuditLog,{ADMIN_AUDIT_ACTIONS,ADMIN_AUDIT_ENTITY_TYPES} from "../models/AdminAuditLog.js";
import {requireAuth,requireRole} from "../middleware/auth.js";

const router=express.Router();
const ACTIONS=new Set(ADMIN_AUDIT_ACTIONS);
const ENTITY_TYPES=new Set(ADMIN_AUDIT_ENTITY_TYPES);
const QUERY_KEYS=new Set(["limit","page","entityType","entityId","action"]);

router.use(requireAuth,requireRole("admin"));

function positiveInt(value,fallback,{max=100}={}){
  if(value===undefined)return fallback;
  const raw=String(value).trim();
  if(!/^\d+$/.test(raw))throw Object.assign(new Error("Invalid pagination value"),{statusCode:400});
  const parsed=Number(raw);
  if(!Number.isSafeInteger(parsed)||parsed<1||parsed>max)throw Object.assign(new Error("Invalid pagination value"),{statusCode:400});
  return parsed;
}

router.get("/audit",async(req,res,next)=>{
  try{
    if(Object.keys(req.query).some(key=>!QUERY_KEYS.has(key))){
      return res.status(400).json({error:"Invalid audit query"});
    }
    const limit=positiveInt(req.query.limit,50,{max:100});
    const page=positiveInt(req.query.page,1,{max:100000});
    const filter={};

    if(req.query.entityType!==undefined){
      const entityType=String(req.query.entityType).trim();
      if(!ENTITY_TYPES.has(entityType))return res.status(400).json({error:"Invalid audit entityType"});
      filter.entityType=entityType;
    }
    if(req.query.entityId!==undefined){
      const entityId=String(req.query.entityId).trim();
      if(!/^[a-f0-9]{24}$/i.test(entityId))return res.status(400).json({error:"Invalid audit entityId"});
      filter.entityId=new mongoose.Types.ObjectId(entityId);
    }
    if(req.query.action!==undefined){
      const action=String(req.query.action).trim();
      if(!ACTIONS.has(action))return res.status(400).json({error:"Invalid audit action"});
      filter.action=action;
    }

    const [items,total]=await Promise.all([
      AdminAuditLog.find(filter).sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).lean(),
      AdminAuditLog.countDocuments(filter)
    ]);
    res.json({items,page,limit,total,pages:Math.max(1,Math.ceil(total/limit))});
  }catch(error){next(error);}
});

export default router;
