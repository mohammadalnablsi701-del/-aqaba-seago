import express from "express";
import bcrypt from "bcryptjs";
import Provider from "../models/Provider.js";
import User from "../models/User.js";
import {requireAuth,requireRole} from "../middleware/auth.js";

const router=express.Router();
router.use(requireAuth,requireRole("admin"));

const cleanEmail=value=>String(value||"").trim().toLowerCase();
const validEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

router.patch("/providers/:providerId/access",async(req,res,next)=>{
  try{
    const provider=await Provider.findById(req.params.providerId);
    if(!provider)return res.status(404).json({error:"Provider not found"});

    const email=cleanEmail(req.body.email);
    const name=String(req.body.name||provider.businessName||"").trim();
    const password=String(req.body.temporaryPassword||"");
    if(!validEmail(email))return res.status(400).json({error:"Valid email is required"});
    if(password.length<12)return res.status(400).json({error:"Temporary password must be at least 12 characters"});

    const currentOwner=provider.ownerUserId?await User.findById(provider.ownerUserId):null;
    let user=await User.findOne({email});

    if(currentOwner){
      if(user&&String(user._id)!==String(currentOwner._id)){
        return res.status(409).json({error:"Email is already used by another account"});
      }
      user=currentOwner;
      user.email=email;
    }else if(user){
      const otherProvider=await Provider.findOne({ownerUserId:user._id,_id:{$ne:provider._id}}).select("_id businessName");
      if(otherProvider)return res.status(409).json({error:"User is already linked to another provider"});
    }else{
      user=new User({email});
    }

    const existingUser=!user.isNew;
    user.name=name;
    user.role="provider";
    user.isActive=true;
    user.passwordHash=await bcrypt.hash(password,12);
    if(existingUser)user.authVersion=Number(user.authVersion||0)+1;
    await user.save();

    provider.ownerUserId=user._id;
    await provider.save();

    res.json({
      ok:true,
      provider:{id:provider._id,businessName:provider.businessName,status:provider.status},
      user:{id:user._id,name:user.name,email:user.email,isActive:user.isActive}
    });
  }catch(e){
    if(e?.code===11000)return res.status(409).json({error:"Email is already used by another account"});
    next(e);
  }
});

export default router;
