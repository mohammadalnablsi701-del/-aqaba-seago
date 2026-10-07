import express from "express";
import mongoose from "mongoose";
import SupportRequest from "../models/SupportRequest.js";
import Booking from "../models/Booking.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateAllowedFields, isBoundedString } from "../middleware/validation.js";

const router=express.Router();
const SUPPORT_FIELDS=new Set(["subject","message","bookingId"]);

function clean(value,max){return String(value??"").trim().replace(/\s+/g," ").slice(0,max);}

router.post("/",requireAuth,requireRole("customer"),async(req,res,next)=>{
  try{
    const fieldError=validateAllowedFields(req.body,SUPPORT_FIELDS);
    if(fieldError)return res.status(400).json({error:fieldError});
    if(!isBoundedString(req.body.subject,{min:1,max:120})||!isBoundedString(req.body.message,{min:1,max:2000})){
      return res.status(400).json({error:"Subject and message are required and must be valid strings"});
    }
    if(req.body.bookingId!==undefined&&typeof req.body.bookingId!=="string"){
      return res.status(400).json({error:"Invalid bookingId"});
    }

    const subject=clean(req.body.subject,120);
    const message=clean(req.body.message,2000);
    const bookingId=String(req.body.bookingId||"").trim();
    if(bookingId&&!mongoose.isValidObjectId(bookingId)){
      return res.status(400).json({error:"Invalid bookingId"});
    }

    let booking=null;
    if(bookingId){
      booking=await Booking.findOne({_id:bookingId,customerId:req.user._id}).select("_id");
      if(!booking)return res.status(404).json({error:"Booking not found"});
    }
    const row=await SupportRequest.create({
      customerId:req.user._id,
      bookingId:booking?._id,
      bookingReference:booking?"SG-"+String(booking._id).slice(-8).toUpperCase():undefined,
      subject,
      message
    });
    res.status(201).json({
      id:row._id,
      status:row.status,
      bookingReference:row.bookingReference||null,
      createdAt:row.createdAt
    });
  }catch(e){next(e);}
});

router.get("/mine",requireAuth,requireRole("customer"),async(req,res,next)=>{
  try{
    const rows=await SupportRequest.find({customerId:req.user._id}).sort({createdAt:-1}).limit(50);
    res.json(rows);
  }catch(e){next(e);}
});

export default router;
