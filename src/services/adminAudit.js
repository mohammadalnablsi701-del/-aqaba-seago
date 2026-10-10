import mongoose from "mongoose";
import AdminAuditLog from "../models/AdminAuditLog.js";

export async function withAdminAuditTransaction(work){
  const session=await mongoose.startSession();
  let result;
  try{
    await session.withTransaction(async()=>{result=await work(session);});
    return result;
  }finally{
    await session.endSession();
  }
}

export async function createAdminAuditEvent({req,action,entityType,entityId,entityLabel="",reason,before=null,after=null,metadata={},session}){
  const actor=req?.user;
  if(!actor||actor.role!=="admin")throw Object.assign(new Error("Admin actor is required for audit"),{statusCode:403});
  if(!entityId)throw Object.assign(new Error("Audit entity ID is required"),{statusCode:500});
  const resolvedReason=reason===undefined?(req.adminActionReason||null):(reason||null);
  const payload={
    actorUserId:actor._id,
    actorEmail:String(actor.email||"").trim().toLowerCase(),
    actorName:String(actor.name||"").trim(),
    actorRole:"admin",
    action,
    entityType,
    entityId,
    entityLabel:String(entityLabel||"").trim().slice(0,220),
    reason:resolvedReason,
    before,
    after,
    metadata
  };
  const rows=await AdminAuditLog.create([payload],session?{session}:undefined);
  return rows[0];
}
