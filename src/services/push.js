import webpush from "web-push";
import PushSubscription from "../models/PushSubscription.js";
import {
  credentialFingerprint,
  pushFailureCode,
  safeProviderStatus,
  safePushData
} from "../utils/notificationPrivacy.js";

const PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com"
]);
const MAX_DELIVERY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 150;

export function isAllowedPushEndpoint(value){
  try{
    const url=new URL(String(value||""));
    if(url.protocol!=="https:"||url.username||url.password)return false;
    const host=url.hostname.toLowerCase().replace(/\.$/,"");
    return PUSH_HOSTS.has(host);
  }catch{
    return false;
  }
}

function configured(){
  return Boolean(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY);
}

function configure(){
  if(!configured())return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT||"mailto:admin@aqabaseago.local",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  return true;
}

export function getVapidPublicKey(){
  return process.env.VAPID_PUBLIC_KEY||"";
}

function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

export async function deliverWebPush(subscription,payload,{send=webpush.sendNotification,retryDelayMs=RETRY_DELAY_MS}={}){
  const safePayload={
    title:String(payload?.title||"Aqaba SeaGo").slice(0,80),
    body:String(payload?.body||"You have a new SeaGo update.").slice(0,180),
    data:safePushData(payload?.data)
  };
  let lastError;
  let attempts=0;
  for(let attempt=1;attempt<=MAX_DELIVERY_ATTEMPTS;attempt++){
    attempts=attempt;
    try{
      await send(
        {endpoint:subscription.endpoint,keys:subscription.keys},
        JSON.stringify(safePayload)
      );
      return {ok:true,attempts};
    }catch(error){
      lastError=error;
      if(pushFailureCode(error)==="push_subscription_invalid")break;
      if(attempt<MAX_DELIVERY_ATTEMPTS)await wait(retryDelayMs);
    }
  }
  return {
    ok:false,
    attempts,
    code:pushFailureCode(lastError),
    statusCode:safeProviderStatus(lastError?.statusCode||lastError?.status)
  };
}

export async function sendPushToUser(userId,{title,body,data={}}){
  if(!userId||!configure())return {sent:0,failed:0,skipped:true,permanentFailures:0,transientFailures:0};
  const rows=await PushSubscription.find({userId});
  let sent=0,failed=0,permanentFailures=0,transientFailures=0;
  for(const row of rows){
    const fingerprint=credentialFingerprint(row.endpoint);
    if(!isAllowedPushEndpoint(row.endpoint)){
      await PushSubscription.deleteOne({_id:row._id,userId});
      failed++;
      permanentFailures++;
      console.warn(JSON.stringify({event:"push_delivery",channel:"web_push",result:"revoked",code:"push_subscription_invalid",credentialFingerprint:fingerprint}));
      continue;
    }

    const result=await deliverWebPush(row,{title,body,data});
    if(result.ok){
      row.lastUsedAt=new Date();
      await row.save();
      sent++;
      continue;
    }

    failed++;
    if(result.code==="push_subscription_invalid"){
      await PushSubscription.deleteOne({_id:row._id,userId});
      permanentFailures++;
      console.warn(JSON.stringify({event:"push_delivery",channel:"web_push",result:"revoked",code:result.code,statusCode:result.statusCode,credentialFingerprint:fingerprint}));
    }else{
      transientFailures++;
      console.error(JSON.stringify({event:"push_delivery",channel:"web_push",result:"failed",code:"push_delivery_transient",statusCode:result.statusCode,credentialFingerprint:fingerprint}));
    }
  }
  return {sent,failed,skipped:false,permanentFailures,transientFailures};
}
