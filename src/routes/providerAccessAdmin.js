import express from "express";
import bcrypt from "bcryptjs";
import Provider from "../models/Provider.js";
import User from "../models/User.js";
import {requireAuth,requireRole} from "../middleware/auth.js";
import {attachAdminActionReason} from "../services/adminActionReason.js";
import {createAdminAuditEvent,withAdminAuditTransaction} from "../services/adminAudit.js";

const router=express.Router();
router.use(requireAuth,requireRole("admin"));

const cleanEmail=value=>String(value||"").trim().toLowerCase();
const validEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

router.patch("/providers/:providerId/access",async(req,res,next)=>{
  try{
    const email=cleanEmail(req.body.email);
    const suppliedName=String(req.body.name||"").trim();
    const password=String(req.body.temporaryPassword||"");
    if(!validEmail(email))return res.status(400).json({error:"Valid email is required"});
    if(password.length<12)return res.status(400).json({error:"Temporary password must be at least 12 characters"});
    attachAdminActionReason(req);
    const passwordHash=await bcrypt.hash(password,12);

    const result=await withAdminAuditTransaction(async session=>{
      const provider=await Provider.findById(req.params.providerId).session(session);
      if(!provider)throw Object.assign(new Error("Provider not found"),{statusCode:404});
      const name=suppliedName||String(provider.businessName||"").trim();

      const currentOwner=provider.ownerUserId?await User.findById(provider.ownerUserId).session(session):null;
      const before={
        email:currentOwner?.email||null,
        name:currentOwner?.name||null,
        isActive:currentOwner?.isActive??null
      };
      let user=await User.findOne({email}).session(session);

      if(currentOwner){
        if(user&&String(user._id)!==String(currentOwner._id)){
          throw Object.assign(new Error("Email is already used by another account"),{statusCode:409});
        }
        user=currentOwner;
        user.email=email;
      }else if(user){
        const otherProvider=await Provider.findOne({ownerUserId:user._id,_id:{$ne:provider._id}}).session(session).select("_id businessName");
        if(otherProvider)throw Object.assign(new Error("User is already linked to another provider"),{statusCode:409});
      }else{
        user=new User({email});
      }

      const existingUser=!user.isNew;
      const emailChanged=cleanEmail(before.email)!==email;
      const nameChanged=String(before.name||"")!==name;

      user.name=name;
      user.role="provider";
      user.isActive=true;
      user.passwordHash=passwordHash;
      if(existingUser)user.authVersion=Number(user.authVersion||0)+1;
      await user.save({session});

      provider.ownerUserId=user._id;
      await provider.save({session});

      await createAdminAuditEvent({
        req,action:"provider_access_reset",entityType:"provider",entityId:provider._id,
        entityLabel:provider.businessName,reason:req.adminActionReason,
        before,
        after:{email:user.email,name:user.name,isActive:user.isActive},
        metadata:{emailChanged,nameChanged,sessionsInvalidated:existingUser},
        session
      });

      return {provider,user};
    });

    res.json({
      ok:true,
      provider:{id:result.provider._id,businessName:result.provider.businessName,status:result.provider.status},
      user:{id:result.user._id,name:result.user.name,email:result.user.email,isActive:result.user.isActive}
    });
  }catch(e){
    if(e?.code===11000)return res.status(409).json({error:"Email is already used by another account"});
    next(e);
  }
});

export default router;
