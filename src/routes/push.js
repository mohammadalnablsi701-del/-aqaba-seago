import express from "express";
import PushSubscription from "../models/PushSubscription.js";
import NativePushToken from "../models/NativePushToken.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { NATIVE_PUSH_CONTEXT, matchesNativePushContext } from "../../shared/nativePushContext.js";
import { fcmEnabled, configuredMessaging, sendNativePushToUser } from "../services/nativeFcm.js";
import { getVapidPublicKey, isAllowedPushEndpoint, sendWebPushToUser } from "../services/push.js";

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

router.get("/native-status",requireAuth,requireRole("customer"),(_req,res)=>{
  let enabled=false;
  if(fcmEnabled()){
    try{configuredMessaging();enabled=true;}catch{}
  }
  res.json({enabled});
});

router.post("/native-subscribe",requireAuth,requireRole("customer"),async(req,res)=>{
  try{
    if(!fcmEnabled())return res.status(503).json({error:"Native notifications are not available"});
    const token=String(req.body?.token||"").trim();
    const platform=String(req.body?.platform||"").trim().toLowerCase();
    const installationId=String(req.body?.installationId||"").trim();
    if(!token||token.length<16||token.length>4096)return res.status(400).json({error:"Invalid native push token"});
    if(!matchesNativePushContext(req.body))return res.status(400).json({error:"Unsupported native push context"});
    if(!INSTALLATION_ID.test(installationId))return res.status(400).json({error:"Invalid native installation"});

    // Owner-scoped upsert plus the unique installation/token indexes reject collisions.
    // Never delete or reassign another customer's installation based on client input.
    await NativePushToken.findOneAndUpdate(
      {appId:APP_ID,installationId,userId:req.user._id},
      {$set:{...NATIVE_PUSH_CONTEXT,userId:req.user._id,token,installationId,platform,lastUsedAt:new Date()}},
      {upsert:true,new:true,setDefaultsOnInsert:true,runValidators:true}
    );
    res.json({ok:true});
  }catch(e){
    // Mongo duplicate-key errors can contain the full token. Do not pass them to the logger.
    res.status(e?.code===11000?409:503).json({error:e?.code===11000?"Native installation is already registered. Sign out and retry.":"Native registration unavailable"});
  }
});

router.post("/native-unsubscribe",requireAuth,requireRole("customer"),async(req,res)=>{
  try{
    const installationId=String(req.body?.installationId||"").trim();
    if(installationId&&INSTALLATION_ID.test(installationId)){
      await NativePushToken.deleteMany({appId:APP_ID,installationId,userId:req.user._id});
    }
    res.json({ok:true});
  }catch{res.status(503).json({error:"Native unregistration unavailable"});}
});

router.post("/native-test",requireAuth,requireRole("customer"),async(req,res)=>{
  try{res.json(await sendNativePushToUser(req.user._id,{data:{screen:"notifications"}}));}
  catch{res.status(503).json({error:"Native notification test unavailable"});}
});

router.post("/test",requireAuth,async(req,res,next)=>{
  try{
    const result=await sendWebPushToUser(req.user._id,{
      title:"Aqaba SeaGo",
      body:"Push notifications are working.",
      data:{screen:"notifications"}
    });
    res.json(result);
  }catch(e){next(e);}
});

export default router;
