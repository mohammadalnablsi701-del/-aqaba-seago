import express from "express";
import PushSubscription from "../models/PushSubscription.js";
import NativePushToken, {
  NATIVE_PUSH_APP_ID as APP_ID,
  NATIVE_PUSH_FIREBASE_PROJECT_ID as FIREBASE_PROJECT_ID
} from "../models/NativePushToken.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getVapidPublicKey, isAllowedPushEndpoint } from "../services/push.js";
import { sendNotificationChannelsToUser } from "../services/notificationChannels.js";

const router=express.Router();
const INSTALLATION_ID=/^[A-Za-z0-9_-]{16,128}$/;

router.get("/public-key",(req,res)=>{
  const publicKey=getVapidPublicKey();
  if(!publicKey)return res.status(503).json({error:"Push notifications are not configured"});
  res.json({publicKey});
});

router.post("/subscribe",requireAuth,async(req,res,next)=>{
  try{
    const subscription=req.body?.subscription;
    if(!subscription?.endpoint||!subscription?.keys?.p256dh||!subscription?.keys?.auth)return res.status(400).json({error:"Invalid push subscription"});
    if(!isAllowedPushEndpoint(subscription.endpoint))return res.status(400).json({error:"Unsupported push endpoint"});
    await PushSubscription.findOneAndUpdate(
      {endpoint:subscription.endpoint},
      {$set:{userId:req.user._id,endpoint:subscription.endpoint,keys:{p256dh:subscription.keys.p256dh,auth:subscription.keys.auth},userAgent:String(req.headers["user-agent"]||"").slice(0,500)}},
      {upsert:true,new:true,setDefaultsOnInsert:true}
    );
    res.json({ok:true});
  }catch(e){next(e);}
});

router.post("/unsubscribe",requireAuth,async(req,res,next)=>{
  try{
    const endpoint=String(req.body?.endpoint||"").trim();
    if(!endpoint)return res.status(400).json({error:"endpoint is required"});
    await PushSubscription.deleteOne({endpoint,userId:req.user._id});
    res.json({ok:true});
  }catch(e){next(e);}
});

router.post("/native-subscribe",requireAuth,requireRole("customer"),async(req,res,next)=>{
  try{
    const token=String(req.body?.token||"").trim();
    const platform=String(req.body?.platform||"").trim().toLowerCase();
    const installationId=String(req.body?.installationId||"").trim();
    if(token.length<20||token.length>8192)return res.status(400).json({error:"Invalid native push token"});
    if(!["android","ios"].includes(platform))return res.status(400).json({error:"Invalid native push platform"});
    if(!INSTALLATION_ID.test(installationId))return res.status(400).json({error:"Invalid installation id"});

    const provider=platform==="android"?"fcm":"apns";
    const set={
      userId:req.user._id,
      token,
      installationId,
      platform,
      provider,
      appId:APP_ID,
      lastUsedAt:new Date()
    };
    const update={$set:set};
    if(platform==="android")set.firebaseProjectId=FIREBASE_PROJECT_ID;
    else update.$unset={firebaseProjectId:1};

    const ownershipFilter={appId:APP_ID,installationId,$or:[{userId:req.user._id},{token}]};
    try{
      await NativePushToken.findOneAndUpdate(
        ownershipFilter,
        update,
        {upsert:true,new:true,setDefaultsOnInsert:true,runValidators:true}
      );
    }catch(error){
      if(error?.code===11000)return res.status(409).json({error:"Native push credential conflict"});
      throw error;
    }
    res.json({ok:true});
  }catch(e){next(e);}
});

router.post("/native-unsubscribe",requireAuth,requireRole("customer"),async(req,res,next)=>{
  try{
    const installationId=String(req.body?.installationId||"").trim();
    if(!INSTALLATION_ID.test(installationId))return res.status(400).json({error:"Invalid installation id"});
    await NativePushToken.deleteMany({appId:APP_ID,installationId,userId:req.user._id});
    res.json({ok:true});
  }catch(e){next(e);}
});

router.post("/test",requireAuth,async(req,res,next)=>{
  try{
    const channels=await sendNotificationChannelsToUser(req.user._id,{data:{screen:"notifications"}});
    const sent=Number(channels.webPush?.sent||0)+Number(channels.nativePush?.sent||0);
    res.json({...channels,sent});
  }catch(e){next(e);}
});

export default router;
