from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def write(rel, content):
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def replace(rel, old, new, count=None):
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    found = text.count(old)
    expected = 1 if count is None else count
    if found != expected:
        raise SystemExit(f"{rel}: expected {expected} replacement(s), found {found}")
    path.write_text(text.replace(old, new), encoding="utf-8")


write("src/models/NativePushToken.js", '''import mongoose from "mongoose";

export const NATIVE_PUSH_APP_ID = "com.aqabaseago.app";
export const NATIVE_PUSH_FIREBASE_PROJECT_ID = "aqaba-seago-7c92";

const schema=new mongoose.Schema({
  userId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},
  token:{type:String,required:true,unique:true,trim:true},
  installationId:{type:String,trim:true},
  platform:{type:String,enum:["android","ios"],required:true,index:true},
  provider:{type:String,enum:["fcm","apns"],index:true},
  firebaseProjectId:{type:String,trim:true,index:true},
  appId:{type:String,default:NATIVE_PUSH_APP_ID,trim:true,index:true},
  lastUsedAt:{type:Date,default:Date.now}
},{timestamps:true});

schema.pre("validate",function(next){
  if(!this.appId)this.appId=NATIVE_PUSH_APP_ID;
  if(this.platform==="android"){
    if(!this.provider)this.provider="fcm";
    if(this.provider==="fcm"&&!this.firebaseProjectId)this.firebaseProjectId=NATIVE_PUSH_FIREBASE_PROJECT_ID;
  }else if(this.platform==="ios"&&!this.provider){
    this.provider="apns";
  }
  next();
});

schema.path("provider").validate(function(provider){
  if(!provider)return true;
  if(this.platform==="android")return provider==="fcm";
  if(this.platform==="ios")return provider==="apns";
  return false;
},"Native push provider does not match platform");

schema.path("firebaseProjectId").validate(function(projectId){
  if(this.platform!=="android"||this.provider!=="fcm")return true;
  return projectId===NATIVE_PUSH_FIREBASE_PROJECT_ID;
},"Android FCM project does not match Aqaba SeaGo");

schema.index({userId:1,updatedAt:-1});
schema.index({appId:1,installationId:1},{unique:true,sparse:true});
schema.index({userId:1,platform:1,provider:1,firebaseProjectId:1,appId:1});

export default mongoose.model("NativePushToken",schema);
''')

write("src/services/nativePush.js", '''import { existsSync } from "node:fs";
import NativePushToken, {
  NATIVE_PUSH_APP_ID,
  NATIVE_PUSH_FIREBASE_PROJECT_ID
} from "../models/NativePushToken.js";
import {
  credentialFingerprint,
  minimizedPushEnvelope,
  safeProviderStatus
} from "../utils/notificationPrivacy.js";

const PERMANENT_FCM_CODES=new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
  "messaging/invalid-argument"
]);

const TRANSIENT_FCM_CODES=new Set([
  "messaging/internal-error",
  "messaging/server-unavailable",
  "messaging/unknown-error",
  "messaging/quota-exceeded",
  "messaging/message-rate-exceeded",
  "messaging/device-message-rate-exceeded"
]);

function enabled(value){return String(value||"").trim().toLowerCase()==="true";}

export function fcmConfigurationStatus({env=process.env,fileExists=existsSync}={}){
  if(!enabled(env.FCM_ENABLED))return {ready:false,reason:"fcm_disabled"};
  const projectId=String(env.FIREBASE_PROJECT_ID||"").trim();
  if(!projectId)return {ready:false,reason:"fcm_project_unconfigured"};
  if(projectId!==NATIVE_PUSH_FIREBASE_PROJECT_ID)return {ready:false,reason:"fcm_project_mismatch"};
  const credentialPath=String(env.GOOGLE_APPLICATION_CREDENTIALS||"").trim();
  if(!credentialPath||!fileExists(credentialPath))return {ready:false,reason:"fcm_credentials_missing"};
  return {ready:true,projectId,credentialPath};
}

export function classifyFcmFailure(error){
  const code=String(error?.code||"");
  if(PERMANENT_FCM_CODES.has(code))return "permanent";
  if(TRANSIENT_FCM_CODES.has(code))return "transient";
  const status=safeProviderStatus(error?.statusCode||error?.status);
  if(status===429||status>=500)return "transient";
  if(["ETIMEDOUT","ECONNRESET","EAI_AGAIN"].includes(code))return "transient";
  return "transient";
}

async function defaultMessagingClient(projectId){
  const appModule=await import("firebase-admin/app");
  const messagingModule=await import("firebase-admin/messaging");
  const appName=`aqaba-seago-fcm-${projectId}`;
  let app=appModule.getApps().find(item=>item.name===appName);
  if(!app){
    app=appModule.initializeApp({
      credential:appModule.applicationDefault(),
      projectId
    },appName);
  }
  return messagingModule.getMessaging(app);
}

function safeLog(logger,level,payload){
  const method=logger?.[level];
  if(typeof method==="function")method.call(logger,JSON.stringify(payload));
}

function result(overrides={}){
  return {sent:0,failed:0,removed:0,skipped:false,...overrides};
}

export async function sendAndroidFcmToUser(userId,payload={},options={}){
  const config=fcmConfigurationStatus({
    env:options.env||process.env,
    fileExists:options.fileExists||existsSync
  });
  if(!config.ready)return result({skipped:true,reason:config.reason});
  if(!userId)return result({skipped:true,reason:"fcm_user_missing"});

  const tokenModel=options.tokenModel||NativePushToken;
  const logger=options.logger||console;
  let messaging;
  try{
    messaging=await (options.getMessagingClient||defaultMessagingClient)(config.projectId);
  }catch{
    safeLog(logger,"error",{event:"native_push_delivery",channel:"fcm",result:"skipped",code:"fcm_provider_unavailable"});
    return result({skipped:true,reason:"fcm_provider_unavailable"});
  }

  const rows=await tokenModel.find({
    userId,
    platform:"android",
    provider:"fcm",
    firebaseProjectId:NATIVE_PUSH_FIREBASE_PROJECT_ID,
    appId:NATIVE_PUSH_APP_ID
  });
  if(!rows?.length)return result();

  const envelope=minimizedPushEnvelope({
    data:payload?.data,
    notificationId:payload?.notificationId
  });
  const data=Object.fromEntries(Object.entries(envelope.data||{}).map(([key,value])=>[key,String(value)]));
  const summary=result();

  for(const row of rows){
    const token=String(row?.token||"").trim();
    const recipientFingerprint=credentialFingerprint(token);
    if(!token){
      summary.failed++;
      continue;
    }
    try{
      await messaging.send({
        token,
        notification:{title:envelope.title,body:envelope.body},
        data,
        android:{priority:"normal"}
      });
      summary.sent++;
      if(typeof tokenModel.updateOne==="function"){
        await tokenModel.updateOne({_id:row._id,userId,token},{$set:{lastUsedAt:new Date()}}).catch(()=>{});
      }
      safeLog(logger,"log",{event:"native_push_delivery",channel:"fcm",result:"sent",recipientFingerprint});
    }catch(error){
      const failure=classifyFcmFailure(error);
      summary.failed++;
      if(failure==="permanent"){
        try{
          const deletion=await tokenModel.deleteOne({_id:row._id,userId,token});
          summary.removed+=Number(deletion?.deletedCount||0);
        }catch{
          safeLog(logger,"error",{event:"native_push_cleanup",channel:"fcm",result:"failed",code:"token_cleanup_failed",recipientFingerprint});
        }
      }
      safeLog(logger,"warn",{
        event:"native_push_delivery",
        channel:"fcm",
        result:"failed",
        code:failure==="permanent"?"fcm_token_invalid":"fcm_delivery_transient",
        recipientFingerprint
      });
    }
  }
  return summary;
}

export const nativePushInternals={defaultMessagingClient};
''')

write("src/services/notificationChannels.js", '''import { sendPushToUser } from "./push.js";
import { sendAndroidFcmToUser } from "./nativePush.js";

async function settleChannel(name,sender,userId,payload){
  try{
    return await sender(userId,payload);
  }catch{
    return {sent:0,failed:1,skipped:false,errorCode:`${name}_channel_failed`};
  }
}

export async function sendNotificationChannelsToUser(userId,payload={},options={}){
  const webSender=options.webSender||sendPushToUser;
  const nativeSender=options.nativeSender||sendAndroidFcmToUser;
  const [webPush,nativePush]=await Promise.all([
    settleChannel("web_push",webSender,userId,payload),
    settleChannel("native_push",nativeSender,userId,payload)
  ]);
  return {webPush,nativePush};
}
''')

write("src/routes/push.js", '''import express from "express";
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
''')

replace(
    "src/services/notifications.js",
    'import { sendPushToUser } from "./push.js";',
    'import { sendNotificationChannelsToUser } from "./notificationChannels.js";'
)
replace(
    "src/services/notifications.js",
    '  sendPushToUser(userId,push).catch(()=>console.error(JSON.stringify({event:"push_delivery",channel:"web_push",result:"failed",code:"push_delivery_transient"})));',
    '''  void sendNotificationChannelsToUser(userId,push).then(({webPush,nativePush})=>{\n    if(webPush?.failed)console.error(JSON.stringify({event:"push_delivery",channel:"web_push",result:"failed",code:webPush.errorCode||"push_delivery_transient"}));\n    if(nativePush?.failed)console.error(JSON.stringify({event:"push_delivery",channel:"native_fcm",result:"failed",code:nativePush.errorCode||"fcm_delivery_transient"}));\n  }).catch(()=>console.error(JSON.stringify({event:"push_delivery",channel:"dispatch",result:"failed",code:"push_dispatch_failed"})));'''
)

write("customer-app/src/nativePushConfig.js", '''export function nativePushFeatureEnabled(env=import.meta.env){
  return String(env?.VITE_NATIVE_PUSH_ENABLED||"false").trim().toLowerCase()==="true";
}

export function resolvePushChannel({enabled=false,isNative=false,platform="web"}={}){
  if(!isNative)return "web";
  if(platform==="android"&&enabled)return "native-android";
  return "native-disabled";
}
''')

write("customer-app/src/nativePush.js", '''import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { registerNativePushToken, unregisterNativePushToken } from "./api.js";
import { nativePushFeatureEnabled } from "./nativePushConfig.js";

const INSTALLATION_KEY="seago_native_installation_id";
const REGISTERED_KEY="seago_native_push_registered";
let listenerHandles=[];

function installationId(){
  let value=localStorage.getItem(INSTALLATION_KEY);
  if(!value){
    value=(globalThis.crypto?.randomUUID?.()||`install-${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g,"_");
    localStorage.setItem(INSTALLATION_KEY,value);
  }
  return value;
}

export function isNativeSeaGo(){return Capacitor.isNativePlatform();}
export function isAndroidNativeSeaGo(){return isNativeSeaGo()&&Capacitor.getPlatform()==="android";}
export function isNativePushEnabled(){return nativePushFeatureEnabled()&&isAndroidNativeSeaGo();}

export async function nativePushPermission(){
  if(!isNativePushEnabled())return {supported:false,permission:"disabled",subscribed:false,native:isNativeSeaGo()};
  const status=await PushNotifications.checkPermissions();
  return {supported:true,permission:status.receive,subscribed:localStorage.getItem(REGISTERED_KEY)==="1",native:true};
}

async function clearListeners(){
  await Promise.allSettled(listenerHandles.map(handle=>handle.remove()));
  listenerHandles=[];
}

async function registerToken(info,authToken,platform,id){
  const token=String(info?.value||"").trim();
  if(!token)return;
  await registerNativePushToken({token,platform,installationId:id},authToken);
  localStorage.setItem(REGISTERED_KEY,"1");
}

export async function enableNativePush(authToken){
  if(!isNativePushEnabled())return {supported:false,permission:"disabled",subscribed:false,native:isNativeSeaGo()};
  if(!authToken)throw new Error("Authentication is required for push notifications");
  let permissions=await PushNotifications.checkPermissions();
  if(permissions.receive==="prompt")permissions=await PushNotifications.requestPermissions();
  if(permissions.receive!=="granted")throw new Error("Notification permission was not granted");
  await clearListeners();
  const platform=Capacitor.getPlatform();
  const id=installationId();
  listenerHandles.push(await PushNotifications.addListener("registration",info=>{void registerToken(info,authToken,platform,id).catch(()=>{localStorage.removeItem(REGISTERED_KEY);});}));
  listenerHandles.push(await PushNotifications.addListener("registrationError",()=>{localStorage.removeItem(REGISTERED_KEY);}));
  listenerHandles.push(await PushNotifications.addListener("pushNotificationActionPerformed",()=>{}));
  listenerHandles.push(await PushNotifications.addListener("pushNotificationReceived",()=>{}));
  await PushNotifications.register();
  return {supported:true,permission:"granted",subscribed:localStorage.getItem(REGISTERED_KEY)==="1",native:true};
}

export async function disableNativePush(authToken){
  if(!isNativeSeaGo())return {serverRevoked:false,native:false};
  const id=installationId();
  let serverRevoked=false;
  if(authToken){
    try{await unregisterNativePushToken(id,authToken);serverRevoked=true;}catch{}
  }
  localStorage.removeItem(REGISTERED_KEY);
  await clearListeners();
  return {serverRevoked,native:true};
}
''')

replace(
    "customer-app/src/api.js",
    'import { applyCustomerTicketState } from "./ticketLifecycle.js";\n',
    'import { applyCustomerTicketState } from "./ticketLifecycle.js";\nimport { nativePushFeatureEnabled, resolvePushChannel } from "./nativePushConfig.js";\n'
)
replace(
    "customer-app/src/api.js",
    'const API_BASE = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\\\/$/, "");\n',
    '''const API_BASE = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\\/$/, "");\n\nasync function runtimePushContext(){\n  try{\n    const {Capacitor}=await import("@capacitor/core");\n    const isNative=Capacitor.isNativePlatform();\n    const platform=Capacitor.getPlatform();\n    const enabled=nativePushFeatureEnabled();\n    return {isNative,platform,channel:resolvePushChannel({enabled,isNative,platform})};\n  }catch{\n    return {isNative:false,platform:"web",channel:"web"};\n  }\n}\n'''
)
replace(
    "customer-app/src/api.js",
    '''export async function enablePushNotifications(token){\n  if(!(\"serviceWorker\" in navigator)||!(\"PushManager\" in window)||!(\"Notification\" in window))throw new Error(\"Push notifications are not supported on this device/browser\");\n  const permission=await Notification.requestPermission();\n  if(permission!==\"granted\")throw new Error(\"Notification permission was not granted\");\n  const registration=await navigator.serviceWorker.ready;\n  let subscription=await registration.pushManager.getSubscription();\n  if(!subscription){\n    const {publicKey}=await request(\"/api/push/public-key\");\n    subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(publicKey)});\n  }\n  await request(\"/api/push/subscribe\",{method:\"POST\",token,body:JSON.stringify({subscription:subscription.toJSON()})});\n  return {permission,subscribed:true};\n}\n''',
    '''export async function enablePushNotifications(token){\n  const runtime=await runtimePushContext();\n  if(runtime.channel===\"native-android\")return (await import(\"./nativePush.js\")).enableNativePush(token);\n  if(runtime.isNative)throw new Error(\"Native push is disabled for this build\");\n  if(!(\"serviceWorker\" in navigator)||!(\"PushManager\" in window)||!(\"Notification\" in window))throw new Error(\"Push notifications are not supported on this device/browser\");\n  const permission=await Notification.requestPermission();\n  if(permission!==\"granted\")throw new Error(\"Notification permission was not granted\");\n  const registration=await navigator.serviceWorker.ready;\n  let subscription=await registration.pushManager.getSubscription();\n  if(!subscription){\n    const {publicKey}=await request(\"/api/push/public-key\");\n    subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(publicKey)});\n  }\n  await request(\"/api/push/subscribe\",{method:\"POST\",token,body:JSON.stringify({subscription:subscription.toJSON()})});\n  return {permission,subscribed:true};\n}\n'''
)
replace(
    "customer-app/src/api.js",
    '''export async function reconcileExistingPushSubscription(token){\n  if(!token||typeof Notification===\"undefined\"||Notification.permission!==\"granted\")return {reconciled:false};\n  const subscription=await currentWebPushSubscription();\n  if(!subscription)return {reconciled:false};\n  await request(\"/api/push/subscribe\",{method:\"POST\",token,body:JSON.stringify({subscription:subscription.toJSON()})});\n  return {reconciled:true};\n}\n''',
    '''export async function reconcileExistingPushSubscription(token){\n  const runtime=await runtimePushContext();\n  if(runtime.isNative)return {reconciled:false};\n  if(!token||typeof Notification===\"undefined\"||Notification.permission!==\"granted\")return {reconciled:false};\n  const subscription=await currentWebPushSubscription();\n  if(!subscription)return {reconciled:false};\n  await request(\"/api/push/subscribe\",{method:\"POST\",token,body:JSON.stringify({subscription:subscription.toJSON()})});\n  return {reconciled:true};\n}\n'''
)
replace(
    "customer-app/src/api.js",
    '''export async function disablePushNotifications(token,{timeoutMs=1500}={}){\n  const subscription=await currentWebPushSubscription().catch(()=>null);\n  if(!subscription)return {serverRevoked:false,browserUnsubscribed:false,hadSubscription:false};\n\n  let serverRevoked=false;\n  if(token){\n    const controller=typeof AbortController!==\"undefined\"?new AbortController():null;\n    const timeout=controller?setTimeout(()=>controller.abort(),timeoutMs):null;\n    try{\n      await request(\"/api/push/unsubscribe\",{\n        method:\"POST\",token,signal:controller?.signal,\n        body:JSON.stringify({endpoint:subscription.endpoint})\n      });\n      serverRevoked=true;\n    }catch{}\n    finally{if(timeout)clearTimeout(timeout);}\n  }\n\n  let browserUnsubscribed=false;\n  try{browserUnsubscribed=Boolean(await subscription.unsubscribe());}catch{}\n  return {serverRevoked,browserUnsubscribed,hadSubscription:true};\n}\n''',
    '''export async function disablePushNotifications(token,{timeoutMs=1500}={}){\n  const runtime=await runtimePushContext();\n  if(runtime.isNative){\n    if(runtime.platform===\"android\")return (await import(\"./nativePush.js\")).disableNativePush(token);\n    return {serverRevoked:false,native:true};\n  }\n  const subscription=await currentWebPushSubscription().catch(()=>null);\n  if(!subscription)return {serverRevoked:false,browserUnsubscribed:false,hadSubscription:false};\n\n  let serverRevoked=false;\n  if(token){\n    const controller=typeof AbortController!==\"undefined\"?new AbortController():null;\n    const timeout=controller?setTimeout(()=>controller.abort(),timeoutMs):null;\n    try{\n      await request(\"/api/push/unsubscribe\",{\n        method:\"POST\",token,signal:controller?.signal,\n        body:JSON.stringify({endpoint:subscription.endpoint})\n      });\n      serverRevoked=true;\n    }catch{}\n    finally{if(timeout)clearTimeout(timeout);}\n  }\n\n  let browserUnsubscribed=false;\n  try{browserUnsubscribed=Boolean(await subscription.unsubscribe());}catch{}\n  return {serverRevoked,browserUnsubscribed,hadSubscription:true};\n}\n'''
)
replace(
    "customer-app/src/api.js",
    '''export async function pushNotificationStatus(){\n  if(!(\"serviceWorker\" in navigator)||!(\"PushManager\" in window)||!(\"Notification\" in window))return {supported:false,permission:\"unsupported\",subscribed:false};\n  const registration=await navigator.serviceWorker.ready;\n  const subscription=await registration.pushManager.getSubscription();\n  return {supported:true,permission:Notification.permission,subscribed:Boolean(subscription)};\n}\n''',
    '''export async function pushNotificationStatus(){\n  const runtime=await runtimePushContext();\n  if(runtime.channel===\"native-android\")return (await import(\"./nativePush.js\")).nativePushPermission();\n  if(runtime.isNative)return {supported:false,permission:\"disabled\",subscribed:false,native:true};\n  if(!(\"serviceWorker\" in navigator)||!(\"PushManager\" in window)||!(\"Notification\" in window))return {supported:false,permission:\"unsupported\",subscribed:false};\n  const registration=await navigator.serviceWorker.ready;\n  const subscription=await registration.pushManager.getSubscription();\n  return {supported:true,permission:Notification.permission,subscribed:Boolean(subscription)};\n}\n'''
)

replace(
    "customer-app/package.json",
    '    "build": "vite build",\n',
    '    "build": "vite build",\n    "test:native-push": "node scripts/test-native-push-config.mjs",\n'
)
replace(
    "customer-app/package.json",
    '    "mobile:sync": "npm run build && cap sync",\n',
    '    "mobile:sync": "npm run build && cap sync",\n    "mobile:fcm:prepare": "node scripts/prepare-android-fcm.mjs",\n'
)

write("customer-app/scripts/prepare-android-fcm.mjs", '''import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const EXPECTED_FIREBASE_PROJECT_ID="aqaba-seago-7c92";
export const EXPECTED_ANDROID_PACKAGE="com.aqabaseago.app";
export const GOOGLE_SERVICES_PLUGIN_VERSION="4.4.4";

export function validateFirebaseAndroidConfig(config){
  if(!config||typeof config!=="object")throw new Error("Firebase Android config must be a JSON object");
  const projectId=String(config?.project_info?.project_id||"").trim();
  if(projectId!==EXPECTED_FIREBASE_PROJECT_ID)throw new Error("Firebase project_id mismatch");
  const packages=(Array.isArray(config.client)?config.client:[])
    .map(item=>String(item?.client_info?.android_client_info?.package_name||"").trim())
    .filter(Boolean);
  if(!packages.includes(EXPECTED_ANDROID_PACKAGE))throw new Error("Firebase Android package_name mismatch");
  return {projectId,packageName:EXPECTED_ANDROID_PACKAGE};
}

export function decodeFirebaseAndroidConfig(encoded,{required=false}={}){
  const compact=String(encoded||"").replace(/\\s+/g,"");
  if(!compact){
    if(required)throw new Error("FIREBASE_ANDROID_CONFIG_BASE64 is required for a native FCM build");
    return null;
  }
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(compact))throw new Error("FIREBASE_ANDROID_CONFIG_BASE64 is not valid base64");
  let config;
  try{config=JSON.parse(Buffer.from(compact,"base64").toString("utf8"));}
  catch{throw new Error("FIREBASE_ANDROID_CONFIG_BASE64 does not contain valid JSON");}
  validateFirebaseAndroidConfig(config);
  return config;
}

function ensureRootPlugin(text){
  if(text.includes("com.google.gms:google-services"))return text;
  const marker="dependencies {";
  const index=text.indexOf(marker);
  if(index<0)throw new Error("Generated Android root build.gradle has no buildscript dependencies block");
  const insertion=`${marker}\\n        classpath 'com.google.gms:google-services:${GOOGLE_SERVICES_PLUGIN_VERSION}'`;
  return text.slice(0,index)+text.slice(index).replace(marker,insertion,1);
}

function ensureAppPlugin(text){
  if(text.includes("apply plugin: 'com.google.gms.google-services'")||text.includes('apply plugin: "com.google.gms.google-services"'))return text;
  return `${text.trimEnd()}\\n\\ntry {\\n    def servicesJSON = file('google-services.json')\\n    if (servicesJSON.text) {\\n        apply plugin: 'com.google.gms.google-services'\\n    }\\n} catch(Exception e) {\\n    logger.info(\"google-services.json not found, google-services plugin not applied. Push Notifications won't work\")\\n}\\n`;
}

export function ensureGoogleServicesGradle(androidDir){
  const rootGradle=path.join(androidDir,"build.gradle");
  const appGradle=path.join(androidDir,"app","build.gradle");
  if(!fs.existsSync(rootGradle)||!fs.existsSync(appGradle))throw new Error("Generated Android project is missing expected Gradle files");
  fs.writeFileSync(rootGradle,ensureRootPlugin(fs.readFileSync(rootGradle,"utf8")));
  fs.writeFileSync(appGradle,ensureAppPlugin(fs.readFileSync(appGradle,"utf8")));
}

export function prepareAndroidFcm({cwd=process.cwd(),encoded=process.env.FIREBASE_ANDROID_CONFIG_BASE64,required=false}={}){
  const androidDir=path.join(cwd,"android");
  ensureGoogleServicesGradle(androidDir);
  const config=decodeFirebaseAndroidConfig(encoded,{required});
  if(!config)return {configured:false};
  const target=path.join(androidDir,"app","google-services.json");
  fs.writeFileSync(target,`${JSON.stringify(config,null,2)}\\n`,{mode:0o600});
  return {configured:true,target};
}

function main(){
  const required=process.argv.includes("--require-config");
  const result=prepareAndroidFcm({required});
  console.log(JSON.stringify({
    event:"android_fcm_config",
    result:result.configured?"configured":"skipped",
    projectId:EXPECTED_FIREBASE_PROJECT_ID,
    packageName:EXPECTED_ANDROID_PACKAGE
  }));
}

const invoked=process.argv[1]?pathToFileURL(path.resolve(process.argv[1])).href:"";
if(import.meta.url===invoked){
  try{main();}
  catch(error){console.error(JSON.stringify({event:"android_fcm_config",result:"failed",code:String(error?.message||"configuration_failed")}));process.exit(1);}
}
''')

write("customer-app/scripts/test-native-push-config.mjs", '''import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nativePushFeatureEnabled, resolvePushChannel } from "../src/nativePushConfig.js";
import {
  decodeFirebaseAndroidConfig,
  ensureGoogleServicesGradle,
  validateFirebaseAndroidConfig
} from "./prepare-android-fcm.mjs";

const valid={
  project_info:{project_id:"aqaba-seago-7c92"},
  client:[{client_info:{android_client_info:{package_name:"com.aqabaseago.app"}}}]
};

assert.equal(nativePushFeatureEnabled({VITE_NATIVE_PUSH_ENABLED:"false"}),false);
assert.equal(nativePushFeatureEnabled({VITE_NATIVE_PUSH_ENABLED:"true"}),true);
assert.equal(resolvePushChannel({enabled:true,isNative:true,platform:"android"}),"native-android");
assert.equal(resolvePushChannel({enabled:false,isNative:true,platform:"android"}),"native-disabled");
assert.equal(resolvePushChannel({enabled:true,isNative:false,platform:"web"}),"web");
assert.deepEqual(validateFirebaseAndroidConfig(valid),{projectId:"aqaba-seago-7c92",packageName:"com.aqabaseago.app"});
assert.throws(()=>validateFirebaseAndroidConfig({...valid,project_info:{project_id:"wrong-project"}}),/project_id mismatch/);
assert.throws(()=>validateFirebaseAndroidConfig({project_info:valid.project_info,client:[{client_info:{android_client_info:{package_name:"wrong.package"}}}]}),/package_name mismatch/);
assert.throws(()=>decodeFirebaseAndroidConfig("",{required:true}),/required/);
const encoded=Buffer.from(JSON.stringify(valid)).toString("base64");
assert.equal(decodeFirebaseAndroidConfig(encoded,{required:true}).project_info.project_id,"aqaba-seago-7c92");

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"seago-fcm-"));
try{
  fs.mkdirSync(path.join(tmp,"app"),{recursive:true});
  fs.writeFileSync(path.join(tmp,"build.gradle"),"buildscript {\\n    dependencies {\\n        classpath 'com.android.tools.build:gradle:8.13.0'\\n    }\\n}\\n");
  fs.writeFileSync(path.join(tmp,"app","build.gradle"),"android { }\\n");
  ensureGoogleServicesGradle(tmp);
  assert.match(fs.readFileSync(path.join(tmp,"build.gradle"),"utf8"),/com\\.google\\.gms:google-services:4\\.4\\.4/);
  assert.match(fs.readFileSync(path.join(tmp,"app","build.gradle"),"utf8"),/apply plugin: 'com\\.google\\.gms\\.google-services'/);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}

console.log("native push config tests passed");
''')

replace(
    ".env.example",
    "# API protection\nAPI_RATE_LIMIT=300\nAUTH_RATE_LIMIT=25\n",
    '''# API protection\nAPI_RATE_LIMIT=300\nAUTH_RATE_LIMIT=25\n\n# Android FCM server delivery. Keep disabled until Firebase credentials are installed.\nFCM_ENABLED=false\nFIREBASE_PROJECT_ID=aqaba-seago-7c92\n# Path to a secret service-account/application-default credential file on the server.\n# Never commit the JSON itself and never expose Firebase server credentials through VITE_* variables.\nGOOGLE_APPLICATION_CREDENTIALS=<path to secret file>\n'''
)
replace(
    "customer-app/.env.example",
    "VITE_API_BASE_URL=http://localhost:4000\n",
    '''VITE_API_BASE_URL=http://localhost:4000\n\n# Native Android push is opt-in and remains disabled until Firebase Android config and backend credentials are installed.\nVITE_NATIVE_PUSH_ENABLED=false\n'''
)
replace(
    ".gitignore",
    "*.mobileprovision\n",
    "*.mobileprovision\ncustomer-app/android/app/google-services.json\n"
)

replace(
    "customer-app/MOBILE.md",
    '''## Notifications\n\nWeb Push remains available to supported browsers. Native push registration plumbing is present using `@capacitor/push-notifications`, with authenticated API endpoints for storing Android/iOS device tokens. Native push should not be enabled in the UI until the production FCM/APNs credentials and native app configuration are installed.\n''',
    '''## Notifications\n\nWeb Push remains an independent channel and continues to use VAPID. Android native push is prepared for Firebase Cloud Messaging but is disabled by default with `VITE_NATIVE_PUSH_ENABLED=false` and backend `FCM_ENABLED=false`. iOS tokens, if registered by legacy/native plumbing, are identified as `provider=apns` and are never sent through the Android FCM sender.\n\nFor a future Android FCM build, store the real `google-services.json` only as the GitHub Actions secret `FIREBASE_ANDROID_CONFIG_BASE64`. The mobile workflow decodes it after `cap add android`, validates `project_id=aqaba-seago-7c92` and `package_name=com.aqabaseago.app`, and writes it only to the generated `customer-app/android/app/google-services.json`. A requested native-FCM build fails closed when the secret is missing or mismatched. The generated file is gitignored.\n\nThe backend uses Firebase Admin application-default credentials only when explicitly enabled. Configure `GOOGLE_APPLICATION_CREDENTIALS` as a path to a secret file on the server; never put service-account JSON or any Firebase server credential in Git or in a `VITE_*` variable. No Firebase Console registration, service account, private key, or production enablement is part of code preparation.\n'''
)

replace(
    ".github/workflows/mobile-native.yml",
    '''      build_ios:\n        description: "Also build an unsigned iOS simulator app"\n        required: false\n        default: true\n        type: boolean\n''',
    '''      build_ios:\n        description: "Also build an unsigned iOS simulator app"\n        required: false\n        default: true\n        type: boolean\n      native_fcm:\n        description: "Require and validate FIREBASE_ANDROID_CONFIG_BASE64 for this Android artifact (feature flag still remains false)"\n        required: false\n        default: false\n        type: boolean\n'''
)
replace(
    ".github/workflows/mobile-native.yml",
    '''      - name: Install dependencies from lockfile\n        working-directory: customer-app\n        run: npm ci --no-fund\n\n      - name: Build web app\n''',
    '''      - name: Install dependencies from lockfile\n        working-directory: customer-app\n        run: npm ci --no-fund\n\n      - name: Validate native push code/config contract\n        working-directory: customer-app\n        run: npm run test:native-push\n\n      - name: Build web app\n''',
    count=2
)
replace(
    ".github/workflows/mobile-native.yml",
    '''        env:\n          VITE_API_BASE_URL: https://aqaba-seago-api.onrender.com\n        run: npm run build\n''',
    '''        env:\n          VITE_API_BASE_URL: https://aqaba-seago-api.onrender.com\n          VITE_NATIVE_PUSH_ENABLED: "false"\n        run: npm run build\n''',
    count=2
)
replace(
    ".github/workflows/mobile-native.yml",
    '''      - name: Sync Android project\n        working-directory: customer-app\n        run: npx cap sync android\n\n      - name: Verify synced Android web artifact\n''',
    '''      - name: Sync Android project\n        working-directory: customer-app\n        run: npx cap sync android\n\n      - name: Prepare generated Android Google Services integration\n        working-directory: customer-app\n        run: npm run mobile:fcm:prepare\n\n      - name: Inject validated Firebase Android config when explicitly requested\n        if: ${{ github.event_name == 'workflow_dispatch' && inputs.native_fcm }}\n        working-directory: customer-app\n        env:\n          FIREBASE_ANDROID_CONFIG_BASE64: ${{ secrets.FIREBASE_ANDROID_CONFIG_BASE64 }}\n        run: npm run mobile:fcm:prepare -- --require-config\n\n      - name: Verify synced Android web artifact\n'''
)

replace(
    ".github/workflows/mobile-release.yml",
    '''      version_code:\n        description: "Android versionCode (positive integer)"\n        required: true\n        default: "1"\n        type: string\n''',
    '''      version_code:\n        description: "Android versionCode (positive integer)"\n        required: true\n        default: "1"\n        type: string\n      native_fcm:\n        description: "Require and validate FIREBASE_ANDROID_CONFIG_BASE64 for this Android artifact (feature flag still remains false)"\n        required: false\n        default: false\n        type: boolean\n'''
)
replace(
    ".github/workflows/mobile-release.yml",
    '''      - name: Install dependencies from lockfile\n        working-directory: customer-app\n        run: npm ci --no-fund\n\n      - name: Build web app\n''',
    '''      - name: Install dependencies from lockfile\n        working-directory: customer-app\n        run: npm ci --no-fund\n\n      - name: Validate native push code/config contract\n        working-directory: customer-app\n        run: npm run test:native-push\n\n      - name: Build web app\n'''
)
replace(
    ".github/workflows/mobile-release.yml",
    '''        env:\n          VITE_API_BASE_URL: https://aqaba-seago-api.onrender.com\n        run: npm run build\n''',
    '''        env:\n          VITE_API_BASE_URL: https://aqaba-seago-api.onrender.com\n          VITE_NATIVE_PUSH_ENABLED: "false"\n        run: npm run build\n'''
)
replace(
    ".github/workflows/mobile-release.yml",
    '''      - name: Sync Android project\n        working-directory: customer-app\n        run: npx cap sync android\n\n      - name: Verify synced Android release web artifact\n''',
    '''      - name: Sync Android project\n        working-directory: customer-app\n        run: npx cap sync android\n\n      - name: Prepare generated Android Google Services integration\n        working-directory: customer-app\n        run: npm run mobile:fcm:prepare\n\n      - name: Inject validated Firebase Android config when explicitly requested\n        if: ${{ github.event_name == 'workflow_dispatch' && inputs.native_fcm }}\n        working-directory: customer-app\n        env:\n          FIREBASE_ANDROID_CONFIG_BASE64: ${{ secrets.FIREBASE_ANDROID_CONFIG_BASE64 }}\n        run: npm run mobile:fcm:prepare -- --require-config\n\n      - name: Verify synced Android release web artifact\n'''
)

replace(
    "test/notification-push-hardening.test.js",
    '''  assert.match(routeSource,/router\\.post\\(\"\\/native-subscribe\",requireAuth/);\n  assert.match(routeSource,/installationId/);\n  assert.match(routeSource,/deleteMany\\(\\{appId:APP_ID,installationId,token:\\{\\$ne:token\\}\\}\\)/);\n  assert.match(routeSource,/res\\.json\\(\\{ok:true\\}\\)/);\n''',
    '''  assert.match(routeSource,/router\\.post\\(\"\\/native-subscribe\",requireAuth,requireRole\\(\"customer\"\\)/);\n  assert.match(routeSource,/installationId/);\n  assert.match(routeSource,/ownershipFilter=\\{appId:APP_ID,installationId,\\$or:\\[\\{userId:req\\.user\\._id\\},\\{token\\}\\]\\}/);\n  assert.doesNotMatch(routeSource,/deleteMany\\(\\{appId:APP_ID,installationId,token:/);\n  assert.match(routeSource,/res\\.json\\(\\{ok:true\\}\\)/);\n'''
)

write("test/android-fcm-code-prep.test.js", '''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import jwt from "jsonwebtoken";
import pushRouter from "../src/routes/push.js";
import User from "../src/models/User.js";
import NativePushToken, {
  NATIVE_PUSH_APP_ID,
  NATIVE_PUSH_FIREBASE_PROJECT_ID
} from "../src/models/NativePushToken.js";
import { sendAndroidFcmToUser, classifyFcmFailure } from "../src/services/nativePush.js";
import { sendNotificationChannelsToUser } from "../src/services/notificationChannels.js";
import { nativePushFeatureEnabled, resolvePushChannel } from "../customer-app/src/nativePushConfig.js";
import { decodeFirebaseAndroidConfig, validateFirebaseAndroidConfig } from "../customer-app/scripts/prepare-android-fcm.mjs";

const CUSTOMER="507f1f77bcf86cd799439011";
const PROVIDER="507f191e810c19729de860ea";
const ADMIN="507f1f77bcf86cd799439012";
const INSTALLATION="installation_1234567890";
const TOKEN="fcm-test-token-abcdefghijklmnopqrstuvwxyz-0123456789";

function authToken(id){return jwt.sign({sub:id,ver:0},process.env.JWT_SECRET,{expiresIn:"1h"});}
async function startApp(){
  const app=express();app.use(express.json());app.use("/api/push",pushRouter);
  const server=app.listen(0,"127.0.0.1");
  await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  return {server,baseUrl:`http://127.0.0.1:${server.address().port}`};
}
async function post(baseUrl,path,token,body={}){
  const response=await fetch(baseUrl+path,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}

async function withAuthHarness(run){
  const oldSecret=process.env.JWT_SECRET;
  const oldFindById=User.findById;
  const oldUpdate=NativePushToken.findOneAndUpdate;
  const oldDelete=NativePushToken.deleteMany;
  process.env.JWT_SECRET="android-fcm-code-prep-test-secret-123456789";
  const users=new Map([
    [CUSTOMER,{_id:CUSTOMER,role:"customer",isActive:true,authVersion:0}],
    [PROVIDER,{_id:PROVIDER,role:"provider",isActive:true,authVersion:0}],
    [ADMIN,{_id:ADMIN,role:"admin",isActive:true,authVersion:0}]
  ]);
  User.findById=id=>({select:async()=>users.get(String(id))||null});
  try{await run();}
  finally{
    User.findById=oldFindById;NativePushToken.findOneAndUpdate=oldUpdate;NativePushToken.deleteMany=oldDelete;
    if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
  }
}

test("native endpoints are customer-only and Android registration stores explicit FCM metadata",async()=>withAuthHarness(async()=>{
  const writes=[];const deletes=[];
  NativePushToken.findOneAndUpdate=async(filter,update,options)=>{writes.push({filter,update,options});return update.$set;};
  NativePushToken.deleteMany=async filter=>{deletes.push(filter);return {deletedCount:1};};
  const {server,baseUrl}=await startApp();
  try{
    const customer=authToken(CUSTOMER),provider=authToken(PROVIDER),admin=authToken(ADMIN);
    const payload={token:TOKEN,platform:"android",installationId:INSTALLATION};
    assert.equal((await post(baseUrl,"/api/push/native-subscribe",customer,payload)).status,200);
    assert.equal((await post(baseUrl,"/api/push/native-subscribe",provider,payload)).status,403);
    assert.equal((await post(baseUrl,"/api/push/native-subscribe",admin,payload)).status,403);
    assert.equal(writes.length,1);
    assert.deepEqual(writes[0].filter.$or,[{userId:CUSTOMER},{token:TOKEN}]);
    assert.equal(writes[0].update.$set.provider,"fcm");
    assert.equal(writes[0].update.$set.firebaseProjectId,NATIVE_PUSH_FIREBASE_PROJECT_ID);
    assert.equal(writes[0].update.$set.appId,NATIVE_PUSH_APP_ID);
    assert.equal(writes[0].update.$set.platform,"android");
    assert.equal(writes[0].options.runValidators,true);
    assert.equal((await post(baseUrl,"/api/push/native-unsubscribe",provider,{installationId:INSTALLATION})).status,403);
    assert.equal((await post(baseUrl,"/api/push/native-unsubscribe",admin,{installationId:INSTALLATION})).status,403);
    assert.equal((await post(baseUrl,"/api/push/native-unsubscribe",customer,{installationId:INSTALLATION})).status,200);
    assert.equal(deletes.length,1);
    assert.equal(String(deletes[0].userId),CUSTOMER);
  }finally{await new Promise(resolve=>server.close(resolve));}
}));

test("cross-installation duplicate token conflicts fail closed without silent reassignment",async()=>withAuthHarness(async()=>{
  NativePushToken.findOneAndUpdate=async()=>{const error=new Error("duplicate");error.code=11000;throw error;};
  NativePushToken.deleteMany=async()=>({deletedCount:0});
  const {server,baseUrl}=await startApp();
  try{
    const response=await post(baseUrl,"/api/push/native-subscribe",authToken(CUSTOMER),{token:TOKEN,platform:"android",installationId:INSTALLATION});
    assert.equal(response.status,409);
    assert.deepEqual(response.body,{error:"Native push credential conflict"});
  }finally{await new Promise(resolve=>server.close(resolve));}
}));

test("schema defaults Android to FCM metadata and iOS to APNs without an iOS FCM bridge",async()=>{
  const android=new NativePushToken({userId:CUSTOMER,token:TOKEN,installationId:INSTALLATION,platform:"android"});
  await android.validate();
  assert.equal(android.provider,"fcm");
  assert.equal(android.firebaseProjectId,NATIVE_PUSH_FIREBASE_PROJECT_ID);
  assert.equal(android.appId,NATIVE_PUSH_APP_ID);
  const ios=new NativePushToken({userId:CUSTOMER,token:"a".repeat(64),installationId:"installation_ios_12345",platform:"ios"});
  await ios.validate();
  assert.equal(ios.provider,"apns");
  assert.equal(ios.firebaseProjectId,undefined);
});

function fcmEnv(extra={}){return {FCM_ENABLED:"true",FIREBASE_PROJECT_ID:NATIVE_PUSH_FIREBASE_PROJECT_ID,GOOGLE_APPLICATION_CREDENTIALS:"/secret/firebase.json",...extra};}
function modelWith(rows){
  const state={deleted:0,updated:0,filter:null};
  return {state,model:{
    find:async filter=>{state.filter=filter;return rows;},
    deleteOne:async()=>{state.deleted++;return {deletedCount:1};},
    updateOne:async()=>{state.updated++;return {modifiedCount:1};}
  }};
}

test("FCM disabled and missing credentials fail closed without touching tokens",async()=>{
  let finds=0;const tokenModel={find:async()=>{finds++;return [];}};
  const disabled=await sendAndroidFcmToUser(CUSTOMER,{}, {env:{FCM_ENABLED:"false"},tokenModel});
  assert.equal(disabled.skipped,true);assert.equal(disabled.reason,"fcm_disabled");assert.equal(finds,0);
  const missing=await sendAndroidFcmToUser(CUSTOMER,{}, {env:fcmEnv(),fileExists:()=>false,tokenModel});
  assert.equal(missing.skipped,true);assert.equal(missing.reason,"fcm_credentials_missing");assert.equal(finds,0);
});

test("mocked Android FCM send is privacy-minimized and does not require VAPID",async()=>{
  const oldPublic=process.env.VAPID_PUBLIC_KEY,oldPrivate=process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PUBLIC_KEY;delete process.env.VAPID_PRIVATE_KEY;
  const row={_id:"row1",token:TOKEN};const {state,model}=modelWith([row]);let message;
  try{
    const sent=await sendAndroidFcmToUser(CUSTOMER,{title:"Private booking SG-123",body:"Secret details",data:{screen:"tickets",ticketToken:"ticket-secret",authToken:"jwt-secret"}}, {
      env:fcmEnv(),fileExists:()=>true,tokenModel:model,getMessagingClient:async()=>({send:async value=>{message=value;return "mock-id";}}),logger:{log(){},warn(){},error(){}}
    });
    assert.equal(sent.sent,1);assert.equal(state.updated,1);
    assert.equal(state.filter.platform,"android");assert.equal(state.filter.provider,"fcm");
    assert.equal(state.filter.firebaseProjectId,NATIVE_PUSH_FIREBASE_PROJECT_ID);assert.equal(state.filter.appId,NATIVE_PUSH_APP_ID);
    assert.equal(message.notification.title,"Aqaba SeaGo");
    assert.match(message.notification.body,/Open the app to view details/);
    assert.doesNotMatch(JSON.stringify(message),/SG-123|ticket-secret|jwt-secret|Secret details/);
  }finally{
    if(oldPublic===undefined)delete process.env.VAPID_PUBLIC_KEY;else process.env.VAPID_PUBLIC_KEY=oldPublic;
    if(oldPrivate===undefined)delete process.env.VAPID_PRIVATE_KEY;else process.env.VAPID_PRIVATE_KEY=oldPrivate;
  }
});

test("permanent FCM token errors revoke while transient errors preserve token and logs never expose raw token",async()=>{
  const logs=[];const logger={log:value=>logs.push(value),warn:value=>logs.push(value),error:value=>logs.push(value)};
  const permanentModel=modelWith([{_id:"row1",token:TOKEN}]);
  const permanent=await sendAndroidFcmToUser(CUSTOMER,{}, {env:fcmEnv(),fileExists:()=>true,tokenModel:permanentModel.model,getMessagingClient:async()=>({send:async()=>{const e=new Error("provider may echo token");e.code="messaging/registration-token-not-registered";throw e;}}),logger});
  assert.equal(classifyFcmFailure({code:"messaging/registration-token-not-registered"}),"permanent");
  assert.equal(permanentModel.state.deleted,1);assert.equal(permanent.removed,1);
  const transientModel=modelWith([{_id:"row2",token:TOKEN}]);
  const transient=await sendAndroidFcmToUser(CUSTOMER,{}, {env:fcmEnv(),fileExists:()=>true,tokenModel:transientModel.model,getMessagingClient:async()=>({send:async()=>{const e=new Error("temporary");e.code="messaging/internal-error";throw e;}}),logger});
  assert.equal(transientModel.state.deleted,0);assert.equal(transient.failed,1);
  assert.equal(JSON.stringify(logs).includes(TOKEN),false);
  assert.match(JSON.stringify(logs),/[a-f0-9]{16}/);
});

test("Web Push and native FCM channels settle independently",async()=>{
  const result=await sendNotificationChannelsToUser(CUSTOMER,{data:{screen:"notifications"}},{
    webSender:async()=>({sent:1,failed:0,skipped:false}),
    nativeSender:async()=>({sent:0,failed:0,skipped:true,reason:"fcm_disabled"})
  });
  assert.equal(result.webPush.sent,1);assert.equal(result.nativePush.reason,"fcm_disabled");
  const inverse=await sendNotificationChannelsToUser(CUSTOMER,{}, {
    webSender:async()=>{throw new Error("VAPID unavailable");},
    nativeSender:async()=>({sent:1,failed:0,skipped:false})
  });
  assert.equal(inverse.webPush.errorCode,"web_push_channel_failed");assert.equal(inverse.nativePush.sent,1);
});

test("push test endpoint returns independent webPush/nativePush results when FCM is disabled",async()=>withAuthHarness(async()=>{
  const oldEnabled=process.env.FCM_ENABLED;process.env.FCM_ENABLED="false";
  const {server,baseUrl}=await startApp();
  try{
    const response=await post(baseUrl,"/api/push/test",authToken(CUSTOMER));
    assert.equal(response.status,200);
    assert.ok(response.body.webPush);assert.ok(response.body.nativePush);
    assert.equal(response.body.nativePush.skipped,true);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    if(oldEnabled===undefined)delete process.env.FCM_ENABLED;else process.env.FCM_ENABLED=oldEnabled;
  }
}));

test("customer native feature flag selects only Capacitor Android and leaves web as Web Push",()=>{
  assert.equal(nativePushFeatureEnabled({VITE_NATIVE_PUSH_ENABLED:"false"}),false);
  assert.equal(resolvePushChannel({enabled:false,isNative:true,platform:"android"}),"native-disabled");
  assert.equal(resolvePushChannel({enabled:true,isNative:true,platform:"android"}),"native-android");
  assert.equal(resolvePushChannel({enabled:true,isNative:false,platform:"web"}),"web");
  assert.equal(resolvePushChannel({enabled:true,isNative:true,platform:"ios"}),"native-disabled");
});

test("Firebase Android config validation rejects missing, wrong project and wrong package",()=>{
  const valid={project_info:{project_id:NATIVE_PUSH_FIREBASE_PROJECT_ID},client:[{client_info:{android_client_info:{package_name:NATIVE_PUSH_APP_ID}}}]};
  assert.deepEqual(validateFirebaseAndroidConfig(valid),{projectId:NATIVE_PUSH_FIREBASE_PROJECT_ID,packageName:NATIVE_PUSH_APP_ID});
  assert.throws(()=>decodeFirebaseAndroidConfig("",{required:true}),/required/);
  assert.throws(()=>validateFirebaseAndroidConfig({...valid,project_info:{project_id:"wrong"}}),/project_id mismatch/);
  assert.throws(()=>validateFirebaseAndroidConfig({project_info:valid.project_info,client:[{client_info:{android_client_info:{package_name:"wrong.package"}}}]}),/package_name mismatch/);
});

test("repository contains no committed real google-services file or Firebase server secret in VITE config",()=>{
  assert.equal(fs.existsSync(new URL("../customer-app/android/app/google-services.json",import.meta.url)),false);
  const env=fs.readFileSync(new URL("../customer-app/.env.example",import.meta.url),"utf8");
  assert.match(env,/VITE_NATIVE_PUSH_ENABLED=false/);
  assert.doesNotMatch(env,/GOOGLE_APPLICATION_CREDENTIALS|private_key|service_account/);
  const backend=fs.readFileSync(new URL("../.env.example",import.meta.url),"utf8");
  assert.match(backend,/FCM_ENABLED=false/);assert.match(backend,/FIREBASE_PROJECT_ID=aqaba-seago-7c92/);
});
''')

print("FCM code preparation changes applied")
