import { existsSync } from "node:fs";
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
