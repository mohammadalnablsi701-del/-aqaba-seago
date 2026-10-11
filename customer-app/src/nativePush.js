import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { registerNativePushToken, unregisterNativePushToken } from "./api.js";
import { nativePushFeatureEnabled } from "./nativePushConfig.js";

const INSTALLATION_KEY="seago_native_installation_id";
const REGISTERED_KEY="seago_native_push_registered";
let listenerHandles=[];
let lifecycleGeneration=0;

function currentInstallationId(){
  return String(localStorage.getItem(INSTALLATION_KEY)||"").trim();
}

function installationId(){
  let value=currentInstallationId();
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

function safeWarn(logger,message){
  try{logger?.warn?.(message);}catch{}
}

async function registerToken(info,authToken,platform,id,generation){
  if(generation!==lifecycleGeneration)return;
  const token=String(info?.value||"").trim();
  if(!token)return;
  await registerNativePushToken({token,platform,installationId:id},authToken);
  if(generation===lifecycleGeneration)localStorage.setItem(REGISTERED_KEY,"1");
}

export async function enableNativePush(authToken){
  if(!isNativePushEnabled())return {supported:false,permission:"disabled",subscribed:false,native:isNativeSeaGo()};
  if(!authToken)throw new Error("Authentication is required for push notifications");
  let permissions=await PushNotifications.checkPermissions();
  if(permissions.receive==="prompt")permissions=await PushNotifications.requestPermissions();
  if(permissions.receive!=="granted")throw new Error("Notification permission was not granted");
  const generation=++lifecycleGeneration;
  await clearListeners();
  const platform=Capacitor.getPlatform();
  const id=installationId();
  listenerHandles.push(await PushNotifications.addListener("registration",info=>{
    if(generation!==lifecycleGeneration)return;
    void registerToken(info,authToken,platform,id,generation).catch(()=>{
      if(generation===lifecycleGeneration)localStorage.removeItem(REGISTERED_KEY);
    });
  }));
  listenerHandles.push(await PushNotifications.addListener("registrationError",()=>{
    if(generation===lifecycleGeneration)localStorage.removeItem(REGISTERED_KEY);
  }));
  listenerHandles.push(await PushNotifications.addListener("pushNotificationActionPerformed",()=>{}));
  listenerHandles.push(await PushNotifications.addListener("pushNotificationReceived",()=>{}));
  await PushNotifications.register();
  return {supported:true,permission:"granted",subscribed:localStorage.getItem(REGISTERED_KEY)==="1",native:true};
}

export async function disableNativePush(authToken,{
  native=isNativeSeaGo(),
  android=isAndroidNativeSeaGo(),
  pushNotifications=PushNotifications,
  serverUnsubscribe=unregisterNativePushToken,
  logger=console
}={}){
  if(!native)return {serverRevoked:false,localUnregistered:false,hadCredential:false,native:false};

  ++lifecycleGeneration;
  const id=currentInstallationId();
  const hadCredential=Boolean(id||localStorage.getItem(REGISTERED_KEY)==="1");
  let serverRevoked=false;
  if(authToken&&id){
    try{await serverUnsubscribe(id,authToken);serverRevoked=true;}catch{}
  }

  let localUnregistered=false;
  if(android){
    try{
      await pushNotifications.unregister();
      localUnregistered=true;
    }catch{
      safeWarn(logger,"Native push local unregister failed");
    }
  }

  localStorage.removeItem(REGISTERED_KEY);
  if(android)localStorage.removeItem(INSTALLATION_KEY);
  await clearListeners();
  return {serverRevoked,localUnregistered,hadCredential,native:true};
}
