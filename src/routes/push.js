import express from "express";
import mongoose from "mongoose";
import PushSubscription from "../models/PushSubscription.js";
import NativePushToken from "../models/NativePushToken.js";
import NativePushLifecycle from "../models/NativePushLifecycle.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { NATIVE_PUSH_CONTEXT, matchesNativePushContext } from "../../shared/nativePushContext.js";
import { fcmEnabled, configuredMessaging, sendNativePushToUser } from "../services/nativeFcm.js";
import { getVapidPublicKey, isAllowedPushEndpoint, sendWebPushToUser } from "../services/push.js";

const router=express.Router();
const APP_ID="com.aqabaseago.app";
const INSTALLATION_ID=/^[A-Za-z0-9_-]{16,128}$/;
const STALE_NATIVE_GENERATION="STALE_NATIVE_PUSH_GENERATION";

function nativeGeneration(value){
  const generation=Number(value);
  return Number.isSafeInteger(generation)&&generation>=1?generation:null;
}
function staleNativeGeneration(){
  const error=new Error("stale native push lifecycle generation");
  error.code=STALE_NATIVE_GENERATION;
  return error;
}
async function nativeTransaction(work){
  for(let attempt=0;attempt<3;attempt++){
    const session=await mongoose.startSession();
    try{
      let result;
      await session.withTransaction(async()=>{result=await work(session);});
      return result;
    }catch(error){
      const lifecycleInsertRace=error?.code===11000&&error?.keyPattern?.appId&&error?.keyPattern?.installationId&&error?.keyPattern?.userId;
      const transient=typeof error?.hasErrorLabel==="function"&&error.hasErrorLabel("TransientTransactionError");
      if(attempt<2&&(lifecycleInsertRace||transient))continue;
      throw error;
    }finally{await session.endSession();}
  }
  throw new Error("Native push transaction unavailable");
}

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
    const generation=nativeGeneration(req.body?.lifecycleGeneration);
    if(!token||token.length<16||token.length>4096)return res.status(400).json({error:"Invalid native push token"});
    if(!matchesNativePushContext(req.body))return res.status(400).json({error:"Unsupported native push context"});
    if(!INSTALLATION_ID.test(installationId))return res.status(400).json({error:"Invalid native installation"});
    if(generation===null)return res.status(400).json({error:"Invalid native lifecycle generation"});

    await nativeTransaction(async session=>{
      const owner={appId:APP_ID,installationId,userId:req.user._id};
      const fence=await NativePushLifecycle.findOne(owner).session(session).lean();
      if(fence&&(fence.generation>generation||(fence.generation===generation&&fence.state==="revoked")))throw staleNativeGeneration();
      await NativePushLifecycle.findOneAndUpdate(
        owner,
        {$set:{generation,state:"active"}},
        {upsert:true,new:true,setDefaultsOnInsert:true,runValidators:true,session}
      );
      // Owner-scoped upsert plus unique installation/token indexes reject cross-account collisions.
      // The lifecycle row is written in the same transaction so a stale subscribe cannot resurrect after revoke.
      await NativePushToken.findOneAndUpdate(
        owner,
        {$set:{...NATIVE_PUSH_CONTEXT,userId:req.user._id,token,installationId,platform,lastUsedAt:new Date()}},
        {upsert:true,new:true,setDefaultsOnInsert:true,runValidators:true,session}
      );
    });
    res.json({ok:true});
  }catch(e){
    if(e?.code===STALE_NATIVE_GENERATION)return res.status(409).json({error:"Native registration is stale. Retry after session refresh."});
    // Mongo duplicate-key errors can contain the full token. Do not pass them to the logger.
    res.status(e?.code===11000?409:503).json({error:e?.code===11000?"Native installation is already registered. Sign out and retry.":"Native registration unavailable"});
  }
});

router.post("/native-unsubscribe",requireAuth,requireRole("customer"),async(req,res)=>{
  try{
    const installationId=String(req.body?.installationId||"").trim();
    const generation=nativeGeneration(req.body?.lifecycleGeneration);
    if(!installationId||!INSTALLATION_ID.test(installationId))return res.status(400).json({error:"Invalid native installation"});
    if(generation===null)return res.status(400).json({error:"Invalid native lifecycle generation"});
    await nativeTransaction(async session=>{
      const owner={appId:APP_ID,installationId,userId:req.user._id};
      const fence=await NativePushLifecycle.findOne(owner).session(session).lean();
      if(fence&&fence.generation>generation)return;
      await NativePushLifecycle.findOneAndUpdate(
        owner,
        {$set:{generation,state:"revoked"}},
        {upsert:true,new:true,setDefaultsOnInsert:true,runValidators:true,session}
      );
      await NativePushToken.deleteMany(owner).session(session);
    });
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

export const nativePushRouteInternals={nativeGeneration,STALE_NATIVE_GENERATION};
export default router;
