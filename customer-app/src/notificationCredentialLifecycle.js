import { disablePushNotifications } from "./api.js";
import { disableNativePush, isNativeSeaGo } from "./nativePush.js";

function currentAuthToken(){
  try{return JSON.parse(localStorage.getItem("seago_auth")||"null")?.token||"";}
  catch{return "";}
}

export function revokeCurrentNotificationCredentials(authToken){
  const token=String(authToken||"");
  if(!token)return Promise.resolve([]);
  const tasks=[disablePushNotifications(token)];
  if(isNativeSeaGo())tasks.push(disableNativePush(token));
  return Promise.allSettled(tasks);
}

export function enableNotificationLogoutGuard(){
  const onClick=event=>{
    const button=event.target?.closest?.(".profile-signout");
    if(!button)return;
    const token=currentAuthToken();
    if(token)void revokeCurrentNotificationCredentials(token);
  };
  document.addEventListener("click",onClick,true);
  return ()=>document.removeEventListener("click",onClick,true);
}

export const notificationCredentialLifecycleInternals={currentAuthToken};
