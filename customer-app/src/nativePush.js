import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { registerNativePushToken, unregisterNativePushToken, nativePushStatus } from "./api.js";
import { createNativePushController } from "./nativePushController.js";

export function isNativeSeaGo(){return Capacitor.isNativePlatform();}
const controller=createNativePushController({
  plugin:PushNotifications,storage:localStorage,
  enabled:import.meta.env.VITE_NATIVE_PUSH_ENABLED === "true",
  platform:Capacitor.getPlatform(),
  api:{register:registerNativePushToken,unregister:unregisterNativePushToken,status:nativePushStatus},
  notify:detail=>window.dispatchEvent(new CustomEvent("seago:native-push-status",{detail})),
  onReceive:()=>window.dispatchEvent(new CustomEvent("seago:native-notification")),
  onTap:()=>{
    const url=new URL("./?open=notifications",window.location.href);
    if(url.origin===window.location.origin)window.location.assign(url.href);
  }
});
export const enableNativePush=token=>controller.enable(token);
export const disableNativePush=token=>controller.disable(token);
export const nativePushPermission=async()=>controller.status();
export const syncNativePushAuth=token=>controller.setAuth(token);
export const resumeNativePush=()=>controller.resume();
