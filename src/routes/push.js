import express from "express";
import mongoose from "mongoose";
import PushSubscription from "../models/PushSubscription.js";
import NativePushToken, {
  NATIVE_PUSH_APP_ID as APP_ID,
  NATIVE_PUSH_FIREBASE_PROJECT_ID as FIREBASE_PROJECT_ID
} from "../models/NativePushToken.js";
import NativePushInstallationState from "../models/NativePushInstallationState.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getVapidPublicKey, isAllowedPushEndpoint } from "../services/push.js";
import { sendNotificationChannelsToUser } from "../services/notificationChannels.js";

const router=express.Router();
const INSTALLATION_ID=/^[A-Za-z0-9_-]{16,128}$/;
const MAX_ADVANCEABLE_EPOCH=Number.MAX_SAFE_INTEGER-1;

class NativePushLifecycleError extends Error{
  constructor(status,message,code){
    super(message);
    this.status=status;
    this.code=code;
  }
}

function sameId(left,right){return String(left||"")===String(right||"");}
function parseLifecycleEpoch(value){
  const epoch=Number(value);
  return Number.isSafeInteger(epoch)&&epoch>=1&&epoch<=MAX_ADVANCEABLE_EPOCH?epoch:null;
}
function ownershipConflict(){return new NativePushLifecycleError(409,"Native push installation ownership conflict","NATIVE_PUSH_OWNERSHIP_CONFLICT");}
function staleLifecycle(){return new NativePushLifecycleError(410,"Native push lifecycle is stale","NATIVE_PUSH_LIFECYCLE_STALE");}

async function withLifecycleTransaction(work,{duplicateRetries=2}={}){
  let lastError;
  for(let attempt=0;attempt<=duplicateRetries;attempt++){
    const session=await mongoose.startSession();
    try{
      let output;
      await session.withTransaction(async()=>{output=await work(session);});
      return output;
    }catch(error){
      lastError=error;
      if(error instanceof NativePushLifecycleError)throw error;
      if(error?.code!==11000||attempt===duplicateRetries)throw error;
    }finally{
      await session.endSession();
    }
  }
  throw lastError;
}

async function existingInstallationState(installationId,session){
  return NativePushInstallationState.findOne({appId:APP_ID,installationId},null,{session});
}

async function legacyInstallationToken(installationId,session){
  return NativePushToken.findOne({appId:APP_ID,installationId},null,{session});
}

async function subscribeNativeInstallation({userId,token,platform,installationId,lifecycleEpoch}){
  return withLifecycleTransaction(async session=>{
    const now=new Date();
    let state=await existingInstallationState(installationId,session);

    if(!state){
      if(lifecycleEpoch!==1)throw staleLifecycle();
      const legacyToken=await legacyInstallationToken(installationId,session);
      if(legacyToken&&!sameId(legacyToken.userId,userId))throw ownershipConflict();
      state=await NativePushInstallationState.findOneAndUpdate(
        {appId:APP_ID,installationId,userId,currentEpoch:1},
        {
          $set:{active:true,lastSubscribedAt:now},
          $unset:{revokedAt:1}
        },
        {upsert:true,new:true,setDefaultsOnInsert:true,runValidators:true,session}
      );
    }else{
      if(!sameId(state.userId,userId))throw ownershipConflict();
      if(Number(state.currentEpoch)!==lifecycleEpoch)throw staleLifecycle();
      state=await NativePushInstallationState.findOneAndUpdate(
        {_id:state._id,userId,currentEpoch:lifecycleEpoch},
        {$set:{active:true,lastSubscribedAt:now},$unset:{revokedAt:1}},
        {new:true,runValidators:true,session}
      );
      if(!state)throw staleLifecycle();
    }

    const provider=platform==="android"?"fcm":"apns";
    const set={
      userId,
      token,
      installationId,
      platform,
      provider,
      appId:APP_ID,
      lastUsedAt:now
    };
    const update={$set:set};
    if(platform==="android")set.firebaseProjectId=FIREBASE_PROJECT_ID;
    else update.$unset={firebaseProjectId:1};

    await NativePushToken.findOneAndUpdate(
      {appId:APP_ID,installationId,userId},
      update,
      {upsert:true,new:true,setDefaultsOnInsert:true,runValidators:true,session}
    );
    return {lifecycleEpoch:Number(state.currentEpoch)};
  });
}

async function revokeNativeInstallation({userId,installationId,lifecycleEpoch}){
  return withLifecycleTransaction(async session=>{
    const now=new Date();
    let state=await existingInstallationState(installationId,session);

    if(!state){
      if(lifecycleEpoch!==1)throw staleLifecycle();
      const legacyToken=await legacyInstallationToken(installationId,session);
      if(legacyToken&&!sameId(legacyToken.userId,userId))throw ownershipConflict();
      const created=await NativePushInstallationState.create([{
        userId,
        installationId,
        appId:APP_ID,
        currentEpoch:2,
        active:false,
        revokedAt:now
      }],{session});
      state=created[0];
      await NativePushToken.deleteMany({appId:APP_ID,installationId,userId},{session});
      return {lifecycleEpoch:Number(state.currentEpoch)};
    }

    if(!sameId(state.userId,userId))throw ownershipConflict();

    if(Number(state.currentEpoch)===lifecycleEpoch){
      const advanced=await NativePushInstallationState.findOneAndUpdate(
        {_id:state._id,userId,currentEpoch:lifecycleEpoch},
        {$inc:{currentEpoch:1},$set:{active:false,revokedAt:now}},
        {new:true,runValidators:true,session}
      );
      if(!advanced)throw staleLifecycle();
      await NativePushToken.deleteMany({appId:APP_ID,installationId,userId},{session});
      return {lifecycleEpoch:Number(advanced.currentEpoch)};
    }

    if(Number(state.currentEpoch)===lifecycleEpoch+1&&state.active===false){
      await NativePushToken.deleteMany({appId:APP_ID,installationId,userId},{session});
      return {lifecycleEpoch:Number(state.currentEpoch)};
    }

    throw staleLifecycle();
  });
}

function sendNativeLifecycleError(res,error){
  if(error instanceof NativePushLifecycleError){
    return res.status(error.status).json({error:error.message,code:error.code});
  }
  if(error?.code===11000){
    return res.status(409).json({error:"Native push credential conflict",code:"NATIVE_PUSH_CREDENTIAL_CONFLICT"});
  }
  return null;
}

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
    const lifecycleEpoch=parseLifecycleEpoch(req.body?.lifecycleEpoch);
    if(token.length<20||token.length>8192)return res.status(400).json({error:"Invalid native push token"});
    if(!["android","ios"].includes(platform))return res.status(400).json({error:"Invalid native push platform"});
    if(!INSTALLATION_ID.test(installationId))return res.status(400).json({error:"Invalid installation id"});
    if(!lifecycleEpoch)return res.status(400).json({error:"Invalid native push lifecycle epoch"});

    const result=await subscribeNativeInstallation({
      userId:req.user._id,
      token,
      platform,
      installationId,
      lifecycleEpoch
    });
    res.json({ok:true,lifecycleEpoch:result.lifecycleEpoch});
  }catch(error){
    if(sendNativeLifecycleError(res,error))return;
    next(error);
  }
});

router.post("/native-unsubscribe",requireAuth,requireRole("customer"),async(req,res,next)=>{
  try{
    const installationId=String(req.body?.installationId||"").trim();
    const lifecycleEpoch=parseLifecycleEpoch(req.body?.lifecycleEpoch);
    if(!INSTALLATION_ID.test(installationId))return res.status(400).json({error:"Invalid installation id"});
    if(!lifecycleEpoch)return res.status(400).json({error:"Invalid native push lifecycle epoch"});

    const result=await revokeNativeInstallation({
      userId:req.user._id,
      installationId,
      lifecycleEpoch
    });
    res.json({ok:true,revoked:true,lifecycleEpoch:result.lifecycleEpoch});
  }catch(error){
    if(sendNativeLifecycleError(res,error))return;
    next(error);
  }
});

router.post("/test",requireAuth,async(req,res,next)=>{
  try{
    const channels=await sendNotificationChannelsToUser(req.user._id,{data:{screen:"notifications"}});
    const sent=Number(channels.webPush?.sent||0)+Number(channels.nativePush?.sent||0);
    res.json({...channels,sent});
  }catch(e){next(e);}
});

export const nativePushLifecycleInternals={
  parseLifecycleEpoch,
  subscribeNativeInstallation,
  revokeNativeInstallation,
  withLifecycleTransaction
};

export default router;
