import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { registerNativePushToken, unregisterNativePushToken } from "./api.js";

const INSTALLATION_KEY="seago_native_installation_id";
let lifecycleHandles=[];

export function isNativeSeaGo(){
  return Capacitor.isNativePlatform();
}

function installationId(){
  let value=localStorage.getItem(INSTALLATION_KEY);
  if(value&&/^[A-Za-z0-9_-]{16,128}$/.test(value))return value;
  value=globalThis.crypto?.randomUUID?.()||`install_${Date.now()}_${Math.random().toString(36).slice(2,18)}`;
  localStorage.setItem(INSTALLATION_KEY,value);
  return value;
}

export async function nativePushPermission(){
  if(!isNativeSeaGo())return {supported:false,receive:"unsupported"};
  const status=await PushNotifications.checkPermissions();
  return {supported:true,receive:status.receive};
}

async function registerToken(value,platform,authToken){
  const token=String(value||"").trim();
  if(!token)return;
  await registerNativePushToken({token,platform,installationId:installationId()},authToken);
}

async function installNativeLifecycle(authToken,platform){
  await Promise.all(lifecycleHandles.map(handle=>handle.remove().catch(()=>{})));
  lifecycleHandles=[];
  lifecycleHandles.push(
    await PushNotifications.addListener("registration",token=>{
      registerToken(token?.value,platform,authToken).catch(()=>{});
    }),
    await PushNotifications.addListener("pushNotificationReceived",()=>{
      window.dispatchEvent(new CustomEvent("seago:native-notification",{detail:{screen:"notifications"}}));
    }),
    await PushNotifications.addListener("pushNotificationActionPerformed",()=>{
      const url=new URL("./?open=notifications",window.location.href);
      if(url.origin===window.location.origin)window.location.assign(url.href);
    })
  );
}

export async function enableNativePush(authToken){
  if(!isNativeSeaGo())throw new Error("Native push is only available in the installed app");
  if(!authToken)throw new Error("Sign in before enabling notifications");

  let permission=await PushNotifications.checkPermissions();
  if(permission.receive==="prompt")permission=await PushNotifications.requestPermissions();
  if(permission.receive!=="granted")throw new Error("Notification permission was not granted");

  const platform=Capacitor.getPlatform();
  const registration=new Promise((resolve,reject)=>{
    const cleanup=[];
    const done=value=>{cleanup.forEach(x=>x.remove());resolve(value);};
    const fail=()=>{cleanup.forEach(x=>x.remove());reject(new Error("Push registration failed"));};
    Promise.all([
      PushNotifications.addListener("registration",done),
      PushNotifications.addListener("registrationError",fail)
    ]).then(handles=>cleanup.push(...handles)).then(()=>PushNotifications.register()).catch(reject);
  });

  const token=await registration;
  await registerToken(token.value,platform,authToken);
  await installNativeLifecycle(authToken,platform);
  return {supported:true,permission:"granted",registered:true,platform};
}

export async function disableNativePush(authToken){
  if(authToken){
    try{await unregisterNativePushToken(installationId(),authToken);}catch{}
  }
  if(isNativeSeaGo()){
    await Promise.all(lifecycleHandles.map(handle=>handle.remove().catch(()=>{})));
    lifecycleHandles=[];
  }
  return {registered:false};
}

export const nativePushInternals={installationId};
