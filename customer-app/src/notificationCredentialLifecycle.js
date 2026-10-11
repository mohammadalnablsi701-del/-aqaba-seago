import { disablePushNotifications } from "./api.js";
import { disableNativePush, isAndroidNativeSeaGo } from "./nativePush.js";

function currentAuthToken(){
  try{return JSON.parse(localStorage.getItem("seago_auth")||"null")?.token||"";}
  catch{return "";}
}

export function revokeCurrentNotificationCredentials(authToken,{
  disableNotifications=disablePushNotifications,
  nativeCleanup=disableNativePush,
  androidNative=isAndroidNativeSeaGo()
}={}){
  const token=String(authToken||"");
  if(token)return Promise.allSettled([disableNotifications(token)]);
  if(androidNative)return Promise.allSettled([nativeCleanup("")]);
  return Promise.resolve([]);
}

export function enableNotificationLogoutGuard(){
  const onClick=event=>{
    const button=event.target?.closest?.(".profile-signout");
    if(!button)return;
    void revokeCurrentNotificationCredentials(currentAuthToken());
  };
  document.addEventListener("click",onClick,true);
  return ()=>document.removeEventListener("click",onClick,true);
}

export const notificationCredentialLifecycleInternals={currentAuthToken};
