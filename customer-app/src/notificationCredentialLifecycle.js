import { disablePushNotifications } from "./api.js";
import { disableNativePush, isNativeSeaGo } from "./nativePush.js";

function currentAuthToken(){
  try{return JSON.parse(localStorage.getItem("seago_auth")||"null")?.token||"";}
  catch{return "";}
}

export function revokeCurrentNotificationCredentials(authToken){
  const token=String(authToken||"");
  if(!token)return Promise.resolve([]);
  const tasks=isNativeSeaGo()?[disableNativePush(token)]:[disablePushNotifications(token)];
  return Promise.allSettled(tasks).then(results=>{
    if(results.some(result=>result.status==="rejected"))console.warn("Notification cleanup was incomplete; reconnect before enabling notifications again.");
    return results;
  });
}

export function enableNotificationLogoutGuard(){
  const onClick=event=>{
    if(isNativeSeaGo())return; // App.signOut awaits native revocation before clearing auth.
    const button=event.target?.closest?.(".profile-signout");
    if(!button)return;
    const token=currentAuthToken();
    if(token)void revokeCurrentNotificationCredentials(token);
  };
  document.addEventListener("click",onClick,true);
  return ()=>document.removeEventListener("click",onClick,true);
}

export const notificationCredentialLifecycleInternals={currentAuthToken};
