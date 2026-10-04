import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { normalizeJordanPhone } from "../services/phoneOtp.js";

const router=express.Router();

function cleanText(value,max=120){
  return String(value??"").trim().replace(/\s+/g," ").slice(0,max);
}
function cleanEmail(value){
  return String(value??"").trim().toLowerCase().slice(0,254);
}
function validEmail(value){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function validPassword(value){
  return typeof value==="string" && value.length>=8 && value.length<=128;
}

router.get("/google/config",(req,res)=>{
  const clientId=String(process.env.GOOGLE_CLIENT_ID||"").trim();
  res.json({enabled:Boolean(clientId),clientId:clientId||null});
});

router.post("/google",async(req,res,next)=>{
  try{
    const clientId=String(process.env.GOOGLE_CLIENT_ID||"").trim();
    if(!clientId)return res.status(503).json({error:"Google sign-in is not configured yet"});
    const credential=String(req.body.credential||"").trim();
    const role=req.body.role==="provider"?"provider":"customer";
    if(!credential)return res.status(400).json({error:"Google credential is required"});

    const response=await fetch("https://oauth2.googleapis.com/tokeninfo?id_token="+encodeURIComponent(credential));
    const profile=await response.json().catch(()=>({}));
    if(!response.ok||profile.aud!==clientId||profile.email_verified!=="true"||!profile.sub||!profile.email){
      return res.status(401).json({error:"Google sign-in could not be verified"});
    }

    const email=cleanEmail(profile.email);
    const name=cleanText(profile.name||profile.given_name||email.split("@")[0],80);
    const googleSub=String(profile.sub);
    let user=await User.findOne({googleSub});
    if(user){
      if(user.role!==role)return res.status(409).json({error:"This Google account is already registered for a different SeaGo account type"});
      if(!user.isActive)return res.status(401).json({error:"Invalid account"});
    }else{
      const emailOwner=await User.findOne({email});
      if(emailOwner){
        return res.status(409).json({
          error:"An account already uses this email. Sign in with its existing method; automatic Google linking is disabled for security."
        });
      }
      user=await User.create({name,email,googleSub,role,isActive:true});
    }
    res.json({user:safe(user),token:sign(user)});
  }catch(e){
    if(e?.code===11000)return res.status(409).json({error:"Google account is already linked"});
    next(e);
  }
});

router.post("/register",async(req,res,next)=>{
  try{
    const name=cleanText(req.body.name,80);
    const email=cleanEmail(req.body.email);
    const password=req.body.password;
    const phone=cleanText(req.body.phone,30);
    const phoneNormalized=phone?normalizeJordanPhone(phone):"";
    const role=req.body.role==="provider"?"provider":"customer";

    if(!name||!email||!password)return res.status(400).json({error:"Name, email and password are required"});
    if(!validEmail(email))return res.status(400).json({error:"Enter a valid email address"});
    if(!validPassword(password))return res.status(400).json({error:"Password must be 8–128 characters"});
    if(!["customer","provider"].includes(role))return res.status(400).json({error:"Invalid role"});
    if(phone && !phoneNormalized)return res.status(400).json({error:"Enter a valid mobile phone number"});
    if(phoneNormalized && await User.exists({role,phoneNormalized}))return res.status(409).json({error:"Phone already registered"});

    const passwordHash=await bcrypt.hash(password,12);
    const user=await User.create({name,email,phone:phone||undefined,phoneNormalized:phoneNormalized||undefined,role,passwordHash});
    res.status(201).json({user:safe(user),token:sign(user)});
  }catch(e){
    if(e?.code===11000)return res.status(409).json({error:"Email already registered"});
    next(e);
  }
});

router.post("/login",async(req,res,next)=>{
  try{
    const email=cleanEmail(req.body.email);
    const password=req.body.password;
    if(!validEmail(email)||typeof password!=="string")return res.status(401).json({error:"Invalid credentials"});
    const user=await User.findOne({email});
    if(!user||!user.passwordHash||!(await bcrypt.compare(password,user.passwordHash)))return res.status(401).json({error:"Invalid credentials"});
    if(!user.isActive)return res.status(401).json({error:"Invalid account"});
    res.json({user:safe(user),token:sign(user)});
  }catch(e){next(e);}
});

router.patch("/phone",requireAuth,async(req,res,next)=>{
  try{
    const phone=normalizeJordanPhone(req.body.phone);
    if(!phone)return res.status(400).json({error:"Enter a valid phone number"});
    const existing=await User.findOne({role:req.user.role,phoneNormalized:phone,_id:{$ne:req.user._id}}).select("_id");
    if(existing)return res.status(409).json({error:"Phone already registered"});
    const user=await User.findByIdAndUpdate(req.user._id,{$set:{phone,phoneNormalized:phone}},{new:true});
    if(!user||!user.isActive)return res.status(401).json({error:"Invalid account"});
    res.json({user:safe(user),token:sign(user)});
  }catch(e){next(e);}
});

router.post("/otp/request",(_req,res)=>{
  res.status(410).json({error:"Phone code sign-in is disabled. Use Google or email instead."});
});

router.post("/otp/verify",(_req,res)=>{
  res.status(410).json({error:"Phone code sign-in is disabled. Use Google or email instead."});
});

function sign(u){
  if(!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  return jwt.sign({sub:u._id.toString(),role:u.role},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||"7d"});
}
function safe(u){
  return{id:u._id,name:u.name,email:u.email,phone:u.phone,role:u.role,isActive:u.isActive};
}

export default router;
