import express from "express";
import InAppNotification from "../models/InAppNotification.js";
import { requireAuth } from "../middleware/auth.js";
const router=express.Router();

function toCustomerNotificationDto(row){
  return {
    _id:String(row._id),
    type:row.type,
    title:row.title,
    body:row.body,
    readAt:row.readAt||null,
    createdAt:row.createdAt
  };
}

router.get("/",requireAuth,async(req,res,next)=>{
  try{
    const rows=await InAppNotification.find({userId:req.user._id})
      .select("_id type title body readAt createdAt")
      .sort({createdAt:-1})
      .limit(100)
      .lean();
    const unread=await InAppNotification.countDocuments({userId:req.user._id,readAt:null});
    res.json({unread,items:rows.map(toCustomerNotificationDto)});
  }catch(e){next(e);}
});

router.patch("/:id/read",requireAuth,async(req,res,next)=>{
  try{
    const row=await InAppNotification.findOneAndUpdate(
      {_id:req.params.id,userId:req.user._id},
      {$set:{readAt:new Date()}},
      {new:true}
    ).select("_id type title body readAt createdAt").lean();
    if(!row)return res.status(404).json({error:"Notification not found"});
    res.json(toCustomerNotificationDto(row));
  }catch(e){next(e);}
});

router.post("/read-all",requireAuth,async(req,res,next)=>{
  try{
    await InAppNotification.updateMany({userId:req.user._id,readAt:null},{$set:{readAt:new Date()}});
    res.json({ok:true});
  }catch(e){next(e);}
});

export const notificationRouteInternals={toCustomerNotificationDto};
export default router;
