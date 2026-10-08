import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { registerNativePushToken, unregisterNativePushToken } from "./api.js";

export function isNativeSeaGo(){
  return Capacitor.isNativePlatform();
}

export async function nativePushPermission(){
  if(!isNativeSeaGo())return {supported:false,receive:"unsupported"};
  const status=await PushNotifications.checkPermissions();
  return {supported:true,receive:status.receive};
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
    const fail=error=>{cleanup.forEach(x=>x.remove());reject(new Error(error?.error||"Push registration failed"));};
    Promise.all([
      PushNotifications.addListener("registration",done),
      PushNotifications.addListener("registrationError",fail)
    ]).then(handles=>cleanup.push(...handles)).then(()=>PushNotifications.register()).catch(reject);
  });

  const token=await registration;
  await registerNativePushToken({token:token.value,platform},authToken);
  return {supported:true,permission:"granted",registered:true,platform};
}

export async function disableNativePush(deviceToken,authToken){
  if(deviceToken&&authToken)await unregisterNativePushToken(deviceToken,authToken);
  if(isNativeSeaGo())await PushNotifications.removeAllListeners();
  return {registered:false};
}
