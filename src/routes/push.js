import express from "express";
import PushSubscription from "../models/PushSubscription.js";
import NativePushToken from "../models/NativePushToken.js";
import { requireAuth } from "../middleware/auth.js";
import { getVapidPublicKey, isAllowedPushEndpoint, sendPushToUser } from "../services/push.js";

const router=express.Router();
const APP_ID="com.aqabaseago.app";
const INSTALLATION_ID=/^[A-Za-z0-9_-]{16,128}$/;

router.get("/public-key",(_req,res)=>{
  const key=getVapidPublicKey();
  if(!key)return res.status(503).json({error:"Push notifications are not configured"});
  res.json({publicKey:key});
});

router.post("/subscribe",requireAuth,async(req,res,next)=>{
  try{
    const s=req.body?.subscription;
    if(!s?.endpoint||!s?.keys?.p256dh||!s?.keys?.auth)return res.status(400).json({error:"Invalid push subscription"});
    if(!isAllowedPushEndpoint(s.endpoint))return res.status(400).json({error:"Unsupported push service endpoint"});
    const endpoint=String(s.endpoint);
    await PushSubscription.findOneAndUpdate(
      {endpoint},
      {$set:{userId:req.user._id,endpoint,keys:{p256dh:String(s.keys.p256dh),auth:String(s.keys.auth)},userAgent:String(req.get("user-agent")||"").slice(0,500),lastUsedAt:new Date()}},
      {upsert:true,new:true,setDefaultsOnInsert:true}
    );
    res.json({ok:true});
  }catch(e){next(e);}
});

router.post("/unsubscribe",requireAuth,async(req,res,next)=>{
  try{
    const endpoint=String(req.body?.endpoint||"");
    if(endpoint)await PushSubscription.deleteOne({endpoint,userId:req.user._id});
    res.json({ok:true});
  }catch(e){next(e);}
});

router.post("/native-subscribe",requireAuth,async(req,res,next)=>{
  try{
    const token=String(req.body?.token||"").trim();
    const platform=String(req.body?.platform||"").trim().toLowerCase();
    const installationId=String(req.body?.installationId||"").trim();
    if(!token||token.length<16||token.length>4096)return res.status(400).json({error:"Invalid native push token"});
    if(!["android","ios"].includes(platform))return res.status(400).json({error:"Invalid native push platform"});
    if(!INSTALLATION_ID.test(installationId))return res.status(400).json({error:"Invalid native installation"});

    await NativePushToken.deleteMany({appId:APP_ID,installationId,token:{$ne:token}});
    await NativePushToken.findOneAndUpdate(
      {token},
      {$set:{userId:req.user._id,token,installationId,platform,appId:APP_ID,lastUsedAt:new Date()}},
      {upsert:true,new:true,setDefaultsOnInsert:true}
    );
    res.json({ok:true});
  }catch(e){next(e);}
});

router.post("/native-unsubscribe",requireAuth,async(req,res,next)=>{
  try{
    const installationId=String(req.body?.installationId||"").trim();
    if(installationId&&INSTALLATION_ID.test(installationId)){
      await NativePushToken.deleteMany({appId:APP_ID,installationId,userId:req.user._id});
    }
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
