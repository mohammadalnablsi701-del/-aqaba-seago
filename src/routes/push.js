import express from "express";
import PushSubscription from "../models/PushSubscription.js";
import { requireAuth } from "../middleware/auth.js";
import { getVapidPublicKey, sendPushToUser } from "../services/push.js";

const router=express.Router();

router.get("/public-key",(_req,res)=>{
  const key=getVapidPublicKey();
  if(!key)return res.status(503).json({error:"Push notifications are not configured"});
  res.json({publicKey:key});
});

router.post("/subscribe",requireAuth,async(req,res,next)=>{
  try{
    const s=req.body?.subscription;
    if(!s?.endpoint||!s?.keys?.p256dh||!s?.keys?.auth)return res.status(400).json({error:"Invalid push subscription"});
    const row=await PushSubscription.findOneAndUpdate(
      {endpoint:String(s.endpoint)},
      {$set:{userId:req.user._id,endpoint:String(s.endpoint),keys:{p256dh:String(s.keys.p256dh),auth:String(s.keys.auth)},userAgent:String(req.get("user-agent")||"").slice(0,500),lastUsedAt:new Date()}},
      {upsert:true,new:true,setDefaultsOnInsert:true}
    );
    res.json({ok:true,id:row._id});
  }catch(e){next(e);}
});

router.post("/unsubscribe",requireAuth,async(req,res,next)=>{
  try{
    const endpoint=String(req.body?.endpoint||"");
    if(endpoint)await PushSubscription.deleteOne({endpoint,userId:req.user._id});
    res.json({ok:true});
  }catch(e){next(e);}
});

router.post("/test",requireAuth,async(req,res,next)=>{
  try{
    const result=await sendPushToUser(req.user._id,{
      title:"Aqaba SeaGo",
      body:"Push notifications are working.",
      data:{screen:"notifications"}
    });
    res.json(result);
  }catch(e){next(e);}
});

export default router;
