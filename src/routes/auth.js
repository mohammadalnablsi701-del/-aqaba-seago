import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { normalizeJordanPhone, phoneCandidates, sendPhoneOtp, checkPhoneOtp } from "../services/phoneOtp.js";

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

async function findUserByPhoneRole(phoneNormalized,role){
  const candidates=phoneCandidates(phoneNormalized);
  const user=await User.findOne({role,$or:[{phoneNormalized},...candidates.map(phone=>({phone}))]});
  if(user&&!user.phoneNormalized){user.phoneNormalized=phoneNormalized;await user.save();}
  return user;
}

router.post("/otp/request",async(req,res,next)=>{
  try{
    const role=["customer","provider","admin"].includes(req.body.role)?req.body.role:"customer";
    const mode=req.body.mode==="register"?"register":"login";
    const phone=normalizeJordanPhone(req.body.phone);
    if(!phone)return res.status(400).json({error:"Enter a valid phone number"});
    if(mode==="register"&&role==="admin")return res.status(403).json({error:"Admin accounts cannot be created by phone"});
    const existing=await findUserByPhoneRole(phone,role);
    if(mode==="login"&&!existing)return res.status(404).json({error:"No account found for this phone"});
    if(mode==="register"&&existing)return res.status(409).json({error:"Phone already registered"});
    await sendPhoneOtp(phone);
    res.json({ok:true,phone,expiresInSeconds:600});
  }catch(e){next(e);}
});

router.post("/otp/verify",async(req,res,next)=>{
  try{
    const role=["customer","provider","admin"].includes(req.body.role)?req.body.role:"customer";
    const mode=req.body.mode==="register"?"register":"login";
    const phone=normalizeJordanPhone(req.body.phone);
    const code=String(req.body.code||"").trim();
    if(!phone||!/^[0-9]{4,10}$/.test(code))return res.status(400).json({error:"Enter a valid phone and verification code"});
    const approved=await checkPhoneOtp(phone,code);
    if(!approved)return res.status(401).json({error:"Invalid or expired verification code"});
    let user=await findUserByPhoneRole(phone,role);
    if(mode==="register"){
      if(role==="admin")return res.status(403).json({error:"Admin accounts cannot be created by phone"});
      if(user)return res.status(409).json({error:"Phone already registered"});
      const name=cleanText(req.body.name,80);
      if(!name)return res.status(400).json({error:"Name is required"});
      user=await User.create({name,phone,phoneNormalized:phone,role,isActive:true});
    }else if(!user){
      return res.status(404).json({error:"Account not found"});
    }
    if(!user.isActive)return res.status(401).json({error:"Invalid account"});
    res.json({user:safe(user),token:sign(user)});
  }catch(e){next(e);}
});

function sign(u){
  if(!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  return jwt.sign({sub:u._id.toString(),role:u.role},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||"7d"});
}
function safe(u){
  return{id:u._id,name:u.name,email:u.email,phone:u.phone,role:u.role,isActive:u.isActive};
}

export default router;
